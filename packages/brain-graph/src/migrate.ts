// packages/brain-graph/src/migrate.ts

const REPO_OWNER = 'AetherCreator';
const REPO_NAME = 'SuperClaude';
const GITHUB_API = 'https://api.github.com';
const BATCH_SIZE = 50;

interface GitTreeItem {
  path: string;
  type: string;
  sha: string;
}

interface MigrationResult {
  nodes_inserted: number;
  connections_created: number;
  errors: string[];
}

interface ParsedNode {
  id: string;
  title: string;
  domain: string;
  type: string;
  tags: string[];
  created_at: string;
  updated_at: string;
  is_insight: number;
  summary: string;
  connections: string[];
}

function domainFromPath(path: string): string {
  if (path.includes('00-inbox')) return 'inbox';
  if (path.includes('00-session')) return 'session';
  if (path.includes('01-daily')) return 'daily';
  if (path.includes('02-personal/family')) return 'family';
  if (path.includes('02-personal')) return 'personal';
  if (path.includes('03-professional/chef')) return 'chef';
  if (path.includes('03-professional')) return 'professional';
  if (path.includes('04-projects')) return 'projects';
  if (path.includes('05-knowledge/connections')) return 'connections';
  if (path.includes('05-knowledge/patterns')) return 'patterns';
  if (path.includes('05-knowledge/learning')) return 'learning';
  if (path.includes('05-knowledge/trajectories')) return 'trajectories';
  if (path.includes('05-knowledge')) return 'knowledge';
  if (path.includes('06-meta')) return 'meta';
  return 'brain';
}

function inferType(content: string, path: string): string {
  const lower = content.toLowerCase();
  if (path.includes('patterns') || lower.includes('## pattern')) return 'pattern';
  if (path.includes('connections') || lower.includes('## connection')) return 'connection';
  if (path.includes('trajectories')) return 'trajectory';
  if (path.includes('learning')) return 'learning';
  if (lower.includes('## insight') || lower.includes('# insight')) return 'insight';
  if (lower.includes('## technique') || lower.includes('# technique')) return 'technique';
  if (lower.includes('## decision') || lower.includes('# decision')) return 'decision';
  if (lower.includes('## reflection') || lower.includes('# reflection')) return 'reflection';
  if (path.includes('01-daily')) return 'daily';
  if (path.includes('00-session')) return 'session';
  return 'note';
}

function parseNode(path: string, content: string): ParsedNode {
  const filename = path.split('/').pop() ?? path;
  const id = filename.replace(/\.md$/, '');

  // Extract title from first # heading
  const titleMatch = content.match(/^#\s+(.+)$/m);
  const title = titleMatch ? titleMatch[1].trim() : id;

  // Extract Date field
  const dateMatch = content.match(/^Date:\s*(.+)$/m);
  const dateStr = dateMatch ? dateMatch[1].trim() : new Date().toISOString().split('T')[0];

  // Extract Domain field (fallback to path-based)
  const domainMatch = content.match(/^Domain:\s*(.+)$/m);
  const domain = domainMatch ? domainMatch[1].trim() : domainFromPath(path);

  // Extract Tags
  const tagsMatch = content.match(/^Tags:\s*(.+)$/m);
  const tags = tagsMatch
    ? tagsMatch[1].split(',').map(t => t.trim()).filter(Boolean)
    : [];

  // Extract "Connects to:" references
  const connections: string[] = [];
  const connectsSection = content.match(/## Connections[\s\S]*?(?=\n## |\n$|$)/);
  if (connectsSection) {
    const connectMatches = connectsSection[0].matchAll(/Connects to:\s*(.+)/g);
    for (const m of connectMatches) {
      // Extract the path/identifier from the connection reference
      const ref = m[1].trim();
      // Try to extract a node id from paths like brain/05-knowledge/foo or skills/bar
      const pathMatch = ref.match(/(?:brain\/[\w-]+\/)?([^\s(]+)/);
      if (pathMatch) {
        const connId = pathMatch[1].replace(/\.md$/, '').split('/').pop() ?? '';
        if (connId) connections.push(connId);
      }
    }
  }

  // Also look for inline "Connects to:" outside a ## Connections section
  const inlineConnects = content.matchAll(/- Connects to:\s*(.+)/g);
  for (const m of inlineConnects) {
    const ref = m[1].trim();
    const pathMatch = ref.match(/(?:brain\/[\w-]+\/)?([^\s(]+)/);
    if (pathMatch) {
      const connId = pathMatch[1].replace(/\.md$/, '').split('/').pop() ?? '';
      if (connId && !connections.includes(connId)) connections.push(connId);
    }
  }

  const type = inferType(content, path);

  // Determine if insight: connections span 2+ domains or content mentions insight/pattern/cross-domain
  const insightKeywords = /\b(insight|pattern|cross-domain|cross domain|interdisciplinary|bridge|synthesis)\b/i;
  const is_insight = (connections.length >= 2 || insightKeywords.test(content)) ? 1 : 0;

  // Summary: first 200 chars of content after frontmatter
  const bodyStart = content.indexOf('\n## ');
  const bodyText = bodyStart > -1 ? content.slice(bodyStart) : content;
  const cleanBody = bodyText.replace(/^#+\s+.+$/gm, '').replace(/\n+/g, ' ').trim();
  const summary = cleanBody.slice(0, 200);

  return {
    id,
    title,
    domain,
    type,
    tags,
    created_at: dateStr,
    updated_at: dateStr,
    is_insight,
    summary,
    connections,
  };
}

export async function migrateBrainToD1(
  db: D1Database,
  githubToken: string,
): Promise<MigrationResult> {
  const errors: string[] = [];
  const headers = {
    Authorization: `Bearer ${githubToken}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'SuperClaude-Brain-Graph',
    'X-GitHub-Api-Version': '2022-11-28',
  };

  // 1. Fetch brain/ tree recursively
  const treeRes = await fetch(
    `${GITHUB_API}/repos/${REPO_OWNER}/${REPO_NAME}/git/trees/main?recursive=1`,
    { headers },
  );
  if (!treeRes.ok) {
    throw new Error(`Failed to fetch tree: ${treeRes.status} ${await treeRes.text()}`);
  }
  const treeData = (await treeRes.json()) as { tree: GitTreeItem[] };

  // Filter to brain/**/*.md files (exclude index/meta files at brain root)
  const brainFiles = treeData.tree.filter(
    (item) =>
      item.type === 'blob' &&
      item.path.startsWith('brain/') &&
      item.path.endsWith('.md') &&
      !item.path.endsWith('.gitkeep') &&
      // Exclude root-level brain index files
      item.path.split('/').length > 2,
  );

  // 2. Fetch and parse each node
  const parsedNodes: ParsedNode[] = [];

  for (const file of brainFiles) {
    try {
      const fileRes = await fetch(
        `${GITHUB_API}/repos/${REPO_OWNER}/${REPO_NAME}/contents/${file.path}`,
        { headers },
      );
      if (!fileRes.ok) {
        errors.push(`Failed to fetch ${file.path}: ${fileRes.status}`);
        continue;
      }
      const fileData = (await fileRes.json()) as { content: string };
      const content = decodeBase64Content(fileData.content);
      parsedNodes.push(parseNode(file.path, content));
    } catch (e) {
      errors.push(`Error parsing ${file.path}: ${String(e)}`);
    }
  }

  // 3. Batch insert nodes (chunks of 50)
  let nodesInserted = 0;
  for (let i = 0; i < parsedNodes.length; i += BATCH_SIZE) {
    const batch = parsedNodes.slice(i, i + BATCH_SIZE);
    const stmts = batch.map((node) =>
      db
        .prepare(
          `INSERT OR REPLACE INTO brain_nodes (id, title, domain, type, tags, created_at, updated_at, connection_count, is_insight, summary)
           VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
        )
        .bind(
          node.id,
          node.title,
          node.domain,
          node.type,
          JSON.stringify(node.tags),
          node.created_at,
          node.updated_at,
          node.is_insight,
          node.summary,
        ),
    );
    await db.batch(stmts);
    nodesInserted += batch.length;
  }

  // 4. Insert connections (best-effort matching)
  const nodeIds = new Set(parsedNodes.map((n) => n.id));
  const now = new Date().toISOString();
  let connectionsCreated = 0;

  const connStmts: D1PreparedStatement[] = [];
  for (const node of parsedNodes) {
    for (const targetId of node.connections) {
      // Best-effort: only create if target exists, or create anyway for partial graph
      connStmts.push(
        db
          .prepare(
            `INSERT OR IGNORE INTO brain_connections (source_id, target_id, relationship, created_at)
             VALUES (?, ?, 'connects_to', ?)`,
          )
          .bind(node.id, targetId, now),
      );
    }
  }

  // Batch connection inserts
  for (let i = 0; i < connStmts.length; i += BATCH_SIZE) {
    const batch = connStmts.slice(i, i + BATCH_SIZE);
    const results = await db.batch(batch);
    connectionsCreated += results.filter((r) => r.meta.changes > 0).length;
  }

  // 5. Update connection_count on each node
  await db.batch([
    db.prepare(`
      UPDATE brain_nodes SET connection_count = (
        SELECT COUNT(*) FROM brain_connections
        WHERE brain_connections.source_id = brain_nodes.id
           OR brain_connections.target_id = brain_nodes.id
      )
    `),
  ]);

  return {
    nodes_inserted: nodesInserted,
    connections_created: connectionsCreated,
    errors,
  };
}

function decodeBase64Content(encoded: string): string {
  const cleaned = encoded.replace(/\n/g, '');
  return decodeURIComponent(escape(atob(cleaned)));
}
