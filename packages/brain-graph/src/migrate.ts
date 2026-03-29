interface GitHubTreeItem {
  path: string;
  type: string;
  sha: string;
}

interface GitHubTreeResponse {
  tree: GitHubTreeItem[];
  truncated: boolean;
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

const DOMAIN_MAP: Record<string, string> = {
  '00-inbox': 'inbox',
  '00-session': 'session',
  '01-daily': 'daily',
  '02-personal': 'personal',
  '03-professional': 'professional',
  '04-projects': 'projects',
  '05-knowledge': 'knowledge',
  '06-meta': 'meta',
};

function inferDomain(path: string): string {
  for (const [dir, domain] of Object.entries(DOMAIN_MAP)) {
    if (path.includes(dir)) return domain;
  }
  if (path.includes('meta/')) return 'meta';
  return 'unknown';
}

function inferType(content: string, path: string): string {
  const lower = content.toLowerCase();
  if (path.includes('patterns/') || lower.includes('## pattern')) return 'pattern';
  if (path.includes('connections/') || lower.includes('## connection')) return 'connection';
  if (path.includes('learning/') || lower.includes('## learning')) return 'learning';
  if (path.includes('trajectories/') || lower.includes('## trajectory')) return 'trajectory';
  if (lower.includes('## insight') || lower.includes('cross-domain')) return 'insight';
  if (lower.includes('## technique')) return 'technique';
  if (lower.includes('## state:') || path.includes('state-')) return 'state';
  if (path.includes('daily/') || /\d{4}-\d{2}-\d{2}/.test(path.split('/').pop() || '')) return 'daily';
  return 'note';
}

function parseNode(path: string, content: string): ParsedNode {
  const filename = path.split('/').pop() || '';
  const id = filename.replace(/\.md$/, '');

  // Parse title from first heading
  const titleMatch = content.match(/^#\s+(.+)/m);
  const title = titleMatch ? titleMatch[1].trim() : id;

  // Parse frontmatter-style fields
  const domainMatch = content.match(/^Domain:\s*(.+)/mi);
  const domain = domainMatch ? domainMatch[1].trim().toLowerCase() : inferDomain(path);

  const tagsMatch = content.match(/^Tags:\s*(.+)/mi);
  const tags = tagsMatch
    ? tagsMatch[1].split(',').map((t: string) => t.trim()).filter(Boolean)
    : [];

  const dateMatch = content.match(/^Date:\s*(.+)/mi);
  const dateFromFilename = id.match(/^(\d{4}-\d{2}-\d{2})/);
  const dateStr = dateMatch
    ? dateMatch[1].trim()
    : dateFromFilename
      ? dateFromFilename[1]
      : '2026-01-01';

  const nodeType = inferType(content, path);

  // Parse connections
  const connections: string[] = [];
  const connectsRegex = /Connects to:\s*(.+)/gi;
  let match;
  while ((match = connectsRegex.exec(content)) !== null) {
    const ref = match[1].trim();
    // Extract the node reference — could be a path or name
    const refParts = ref.split('/');
    const refId = refParts[refParts.length - 1]
      .replace(/\.md$/, '')
      .replace(/[()]/g, '')
      .trim();
    if (refId) connections.push(refId);
  }

  // Determine insight status
  const lower = content.toLowerCase();
  const isInsight =
    connections.length >= 2 ||
    lower.includes('insight') ||
    lower.includes('cross-domain') ||
    lower.includes('pattern') ||
    nodeType === 'insight' ||
    nodeType === 'pattern'
      ? 1
      : 0;

  // Summary: first 200 chars of content body (after title line)
  const bodyStart = content.indexOf('\n');
  const body = bodyStart >= 0 ? content.slice(bodyStart + 1).trim() : '';
  const summary = body.slice(0, 200).replace(/\n/g, ' ').trim();

  return {
    id,
    title: title.slice(0, 500),
    domain,
    type: nodeType,
    tags,
    created_at: dateStr,
    updated_at: dateStr,
    is_insight: isInsight,
    summary,
    connections,
  };
}

export async function migrateBrainToD1(
  db: D1Database,
  githubToken: string,
): Promise<{ nodes_inserted: number; connections_created: number; errors: string[] }> {
  const errors: string[] = [];
  const owner = 'AetherCreator';
  const repo = 'SuperClaude';

  // 1. Fetch brain/ tree
  const treeRes = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/git/trees/main?recursive=1`,
    {
      headers: {
        Authorization: `token ${githubToken}`,
        Accept: 'application/vnd.github.v3+json',
        'User-Agent': 'superclaude-brain-graph',
      },
    },
  );

  if (!treeRes.ok) {
    throw new Error(`GitHub tree fetch failed: ${treeRes.status} ${await treeRes.text()}`);
  }

  const treeData = (await treeRes.json()) as GitHubTreeResponse;
  const brainFiles = treeData.tree.filter(
    (item) =>
      item.type === 'blob' &&
      item.path.startsWith('brain/') &&
      item.path.endsWith('.md') &&
      !item.path.includes('GRAPH-INDEX') &&
      !item.path.includes('GRAPH-LOG') &&
      !item.path.includes('OPS-BOARD') &&
      !item.path.includes('SEMANTIC-INDEX') &&
      !item.path.includes('PROJECT-CONTEXT-INDEX') &&
      !item.path.includes('README.md'),
  );

  // 2. Fetch and parse each node
  const nodes: ParsedNode[] = [];
  for (const file of brainFiles) {
    try {
      const contentRes = await fetch(
        `https://api.github.com/repos/${owner}/${repo}/contents/${file.path}`,
        {
          headers: {
            Authorization: `token ${githubToken}`,
            Accept: 'application/vnd.github.v3.raw',
            'User-Agent': 'superclaude-brain-graph',
          },
        },
      );
      if (!contentRes.ok) {
        errors.push(`Failed to fetch ${file.path}: ${contentRes.status}`);
        continue;
      }
      const content = await contentRes.text();
      nodes.push(parseNode(file.path, content));
    } catch (e) {
      errors.push(`Error parsing ${file.path}: ${(e as Error).message}`);
    }
  }

  // 3. Clear existing data
  await db.batch([
    db.prepare('DELETE FROM brain_connections'),
    db.prepare('DELETE FROM brain_nodes'),
  ]);

  // 4. Batch insert nodes (chunks of 50)
  let nodesInserted = 0;
  for (let i = 0; i < nodes.length; i += 50) {
    const chunk = nodes.slice(i, i + 50);
    const stmts = chunk.map((node) =>
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
    nodesInserted += chunk.length;
  }

  // 5. Build a set of valid node IDs for connection matching
  const nodeIds = new Set(nodes.map((n) => n.id));

  // 6. Insert connections (best-effort matching)
  let connectionsCreated = 0;
  const connectionStmts: D1PreparedStatement[] = [];
  const now = new Date().toISOString();

  for (const node of nodes) {
    for (const connRef of node.connections) {
      // Try exact match, or find a node whose ID contains the reference
      let targetId: string | null = null;
      if (nodeIds.has(connRef)) {
        targetId = connRef;
      } else {
        // Fuzzy match: find node IDs that contain the reference
        const normalized = connRef.toLowerCase().replace(/\s+/g, '-');
        for (const nid of nodeIds) {
          if (nid.toLowerCase().includes(normalized) || normalized.includes(nid.toLowerCase())) {
            targetId = nid;
            break;
          }
        }
      }

      if (targetId && targetId !== node.id) {
        connectionStmts.push(
          db
            .prepare(
              `INSERT OR IGNORE INTO brain_connections (source_id, target_id, relationship, created_at)
               VALUES (?, ?, 'connects_to', ?)`,
            )
            .bind(node.id, targetId, now),
        );
      }
    }
  }

  // Batch insert connections in chunks of 50
  for (let i = 0; i < connectionStmts.length; i += 50) {
    const chunk = connectionStmts.slice(i, i + 50);
    const results = await db.batch(chunk);
    for (const r of results) {
      if (r.meta.changes > 0) connectionsCreated++;
    }
  }

  // 7. Update connection_count on each node
  await db.exec(`
    UPDATE brain_nodes SET connection_count = (
      SELECT COUNT(*) FROM brain_connections
      WHERE brain_connections.source_id = brain_nodes.id
         OR brain_connections.target_id = brain_nodes.id
    )
  `);

  return { nodes_inserted: nodesInserted, connections_created: connectionsCreated, errors };
}
