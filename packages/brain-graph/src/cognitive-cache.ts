// packages/brain-graph/src/cognitive-cache.ts
// Clues 1-3: Brain Compression Query Engine, Template Generator, GitHub Push

import type { NodeRow, ConnectionRow } from './queries';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Pattern {
  id: string;
  name: string;
  domains: string;
  node_ids: string;
  status: string;
  first_seen: string;
  graduated_at: string | null;
}

export interface DomainCount {
  domain: string;
  count: number;
}

export interface CacheData {
  topConnected: NodeRow[];
  hotNodes: NodeRow[];
  activePatterns: Pattern[];
  recentDecisions: NodeRow[];
  crossDomain: CrossDomainResult[];
  domainDistribution: DomainCount[];
  totalNodes: number;
}

export interface CrossDomainResult {
  source_id: string;
  target_id: string;
  relationship: string;
  source_domain: string;
  target_domain: string;
  source_title: string;
  target_title: string;
}

export interface PushResult {
  repo: string;
  success: boolean;
  sha?: string;
  error?: string;
}

// ---------------------------------------------------------------------------
// Clue 1: Brain Compression Query Engine
// ---------------------------------------------------------------------------

export async function getTopConnectedNodes(db: D1Database, limit: number = 5): Promise<NodeRow[]> {
  const result = await db.prepare(
    'SELECT * FROM brain_nodes ORDER BY connection_count DESC LIMIT ?'
  ).bind(limit).all<NodeRow>();
  return result.results;
}

export async function getHotNodes(db: D1Database, days: number = 7): Promise<NodeRow[]> {
  const result = await db.prepare(
    `SELECT * FROM brain_nodes WHERE updated_at > datetime('now', '-' || ? || ' days') ORDER BY connection_count DESC`
  ).bind(days).all<NodeRow>();
  return result.results;
}

export async function getActivePatterns(db: D1Database): Promise<Pattern[]> {
  const result = await db.prepare(
    "SELECT * FROM brain_patterns WHERE status = 'candidate' OR status = 'graduated' ORDER BY status DESC, first_seen DESC"
  ).all<Pattern>();
  return result.results;
}

export async function getRecentDecisions(db: D1Database, limit: number = 5): Promise<NodeRow[]> {
  const result = await db.prepare(
    "SELECT * FROM brain_nodes WHERE type = 'decision' ORDER BY updated_at DESC LIMIT ?"
  ).bind(limit).all<NodeRow>();
  return result.results;
}

export async function getCrossDomainConnections(db: D1Database): Promise<CrossDomainResult[]> {
  const result = await db.prepare(`
    SELECT c.source_id, c.target_id, c.relationship,
           s.domain as source_domain, t.domain as target_domain,
           s.title as source_title, t.title as target_title
    FROM brain_connections c
    JOIN brain_nodes s ON c.source_id = s.id
    JOIN brain_nodes t ON c.target_id = t.id
    WHERE s.domain != t.domain
    ORDER BY s.connection_count DESC
    LIMIT 20
  `).all<CrossDomainResult>();
  return result.results;
}

export async function getDomainDistribution(db: D1Database): Promise<DomainCount[]> {
  const result = await db.prepare(
    'SELECT domain, COUNT(*) as count FROM brain_nodes GROUP BY domain ORDER BY count DESC'
  ).all<DomainCount>();
  return result.results;
}

// ---------------------------------------------------------------------------
// Clue 2: CLAUDE.md Template Generator
// ---------------------------------------------------------------------------

function truncate(text: string | null, maxLen: number): string {
  if (!text) return '';
  return text.length > maxLen ? text.slice(0, maxLen - 1) + '…' : text;
}

export function generateCognitiveCache(data: CacheData): string {
  const date = new Date().toISOString().split('T')[0];
  const lines: string[] = [];

  lines.push('<!-- COGNITIVE-CACHE-START -->');
  lines.push(`## 🧠 Tyler's Cognitive Context (auto-generated ${date})`);
  lines.push('<!-- This section is auto-generated daily from brain/ graph. Do not edit manually. -->');
  lines.push('');

  // Mental Models (top connected)
  if (data.topConnected.length > 0) {
    lines.push('### Mental Models (top by connection density)');
    for (const node of data.topConnected.slice(0, 5)) {
      lines.push(`- **${node.title}**: ${truncate(node.summary, 100)} [${node.domain}]`);
    }
    lines.push('');
  }

  // Active Patterns
  if (data.activePatterns.length > 0) {
    lines.push('### Active Patterns');
    for (const p of data.activePatterns.slice(0, 5)) {
      const domains = (() => { try { return JSON.parse(p.domains).join(', '); } catch { return p.domains; } })();
      lines.push(`- ${p.name}: spans ${domains} [${p.status}]`);
    }
    lines.push('');
  }

  // Recent Decisions
  if (data.recentDecisions.length > 0) {
    lines.push('### Recent Decisions (last 7 days)');
    for (const d of data.recentDecisions.slice(0, 5)) {
      const dateStr = d.updated_at.split('T')[0];
      lines.push(`- ${d.title}: ${truncate(d.summary, 80)} [${dateStr}]`);
    }
    lines.push('');
  }

  // Cross-Domain Bridges
  if (data.crossDomain.length > 0) {
    lines.push('### Cross-Domain Bridges');
    const seen = new Set<string>();
    for (const c of data.crossDomain) {
      const key = [c.source_domain, c.target_domain].sort().join('→');
      if (seen.has(key)) continue;
      seen.add(key);
      lines.push(`- ${c.source_domain} → ${c.target_domain}: ${c.source_title} ↔ ${c.target_title}`);
      if (seen.size >= 5) break;
    }
    lines.push('');
  }

  // Brain Health
  const hotCount = data.hotNodes.length;
  const patternCount = data.activePatterns.length;
  const strongest = data.domainDistribution[0];
  const weakest = data.domainDistribution[data.domainDistribution.length - 1];

  lines.push('### Brain Health');
  lines.push(`- Nodes: ${data.totalNodes} | Hot (7d): ${hotCount} | Patterns: ${patternCount}`);
  if (strongest && weakest) {
    lines.push(`- Strongest: ${strongest.domain} (${strongest.count}) | Weakest: ${weakest.domain} (${weakest.count})`);
  }
  lines.push('');

  // How Tyler Thinks — static section from MAP
  lines.push('### How Tyler Thinks');
  lines.push('- Native mental model: ratio-based scaling (baker\'s % = portfolio allocation = game stat curves)');
  lines.push('- Decision protocol: feel-first, instruments verify');
  lines.push('- Learning sequence: rhythm before tempo');
  lines.push('- Information architecture: progressive disclosure (router + on-demand detail)');
  lines.push('- Teaching method: let them fail once, then explain why');
  lines.push('<!-- COGNITIVE-CACHE-END -->');

  const output = lines.join('\n');

  // Hard cap at 8K characters
  if (output.length > 8000) {
    return output.slice(0, 7990) + '\n<!-- COGNITIVE-CACHE-END -->';
  }

  return output;
}

// ---------------------------------------------------------------------------
// Clue 3: GitHub Push to All Repos
// ---------------------------------------------------------------------------

const TARGET_REPOS = [
  { repo: 'AetherCreator/SuperClaude', path: 'CLAUDE.md' },
  { repo: 'AetherCreator/thechefos-workers', path: 'CLAUDE.md' },
  { repo: 'AetherCreator/chefos', path: 'CLAUDE.md' },
  { repo: 'AetherCreator/aether-chronicles', path: 'CLAUDE.md' },
];

const START_MARKER = '<!-- COGNITIVE-CACHE-START -->';
const END_MARKER = '<!-- COGNITIVE-CACHE-END -->';

export async function getFileContent(
  token: string,
  repo: string,
  path: string
): Promise<{ content: string; sha: string } | null> {
  const resp = await fetch(`https://api.github.com/repos/${repo}/contents/${path}`, {
    headers: {
      Authorization: `token ${token}`,
      Accept: 'application/vnd.github.v3+json',
      'User-Agent': 'superclaude-brain-graph',
    },
  });

  if (resp.status === 404) return null;
  if (!resp.ok) throw new Error(`GitHub GET ${repo}/${path}: ${resp.status} ${resp.statusText}`);

  const data = await resp.json() as { content: string; sha: string };
  const content = atob(data.content.replace(/\n/g, ''));
  return { content, sha: data.sha };
}

export async function putFileContent(
  token: string,
  repo: string,
  path: string,
  content: string,
  sha: string | null,
  message: string
): Promise<string> {
  const body: Record<string, string> = {
    message,
    content: btoa(unescape(encodeURIComponent(content))),
  };
  if (sha) body.sha = sha;

  const resp = await fetch(`https://api.github.com/repos/${repo}/contents/${path}`, {
    method: 'PUT',
    headers: {
      Authorization: `token ${token}`,
      Accept: 'application/vnd.github.v3+json',
      'User-Agent': 'superclaude-brain-graph',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`GitHub PUT ${repo}/${path}: ${resp.status} ${errText}`);
  }

  const data = await resp.json() as { content: { sha: string } };
  return data.content.sha;
}

function spliceCache(existing: string, cacheMarkdown: string): string {
  const startIdx = existing.indexOf(START_MARKER);
  const endIdx = existing.indexOf(END_MARKER);

  if (startIdx !== -1 && endIdx !== -1) {
    // Replace existing section
    return existing.slice(0, startIdx) + cacheMarkdown + existing.slice(endIdx + END_MARKER.length);
  }

  // Append at end
  return existing.trimEnd() + '\n\n' + cacheMarkdown + '\n';
}

export async function pushCognitiveCache(
  githubToken: string,
  cacheMarkdown: string
): Promise<PushResult[]> {
  const results: PushResult[] = [];
  const commitMsg = `chore: update cognitive cache (${new Date().toISOString().split('T')[0]})`;

  for (const { repo, path } of TARGET_REPOS) {
    try {
      const existing = await getFileContent(githubToken, repo, path);
      let newContent: string;
      let sha: string | null = null;

      if (existing) {
        newContent = spliceCache(existing.content, cacheMarkdown);
        sha = existing.sha;
      } else {
        // File doesn't exist — create with just the cache section
        newContent = `# ${repo.split('/')[1]}\n\n${cacheMarkdown}\n`;
      }

      const newSha = await putFileContent(githubToken, repo, path, newContent, sha, commitMsg);
      results.push({ repo, success: true, sha: newSha });
    } catch (e) {
      results.push({ repo, success: false, error: (e as Error).message });
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Full Pipeline: Query → Generate → Push
// ---------------------------------------------------------------------------

export async function generateAndPushCognitiveCache(
  db: D1Database,
  githubToken: string
): Promise<{ repos: PushResult[]; cache_size: number; generated_at: string }> {
  // Run all queries in parallel
  const [topConnected, hotNodes, activePatterns, recentDecisions, crossDomain, domainDistribution, totalResult] =
    await Promise.all([
      getTopConnectedNodes(db, 5),
      getHotNodes(db, 7),
      getActivePatterns(db),
      getRecentDecisions(db, 5),
      getCrossDomainConnections(db),
      getDomainDistribution(db),
      db.prepare('SELECT COUNT(*) as total FROM brain_nodes').first<{ total: number }>(),
    ]);

  const cacheData: CacheData = {
    topConnected,
    hotNodes,
    activePatterns,
    recentDecisions,
    crossDomain,
    domainDistribution,
    totalNodes: totalResult?.total || 0,
  };

  const cacheMarkdown = generateCognitiveCache(cacheData);
  const repos = await pushCognitiveCache(githubToken, cacheMarkdown);

  return {
    repos,
    cache_size: cacheMarkdown.length,
    generated_at: new Date().toISOString(),
  };
}
