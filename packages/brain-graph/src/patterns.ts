// packages/brain-graph/src/patterns.ts
import { Hono } from 'hono';

interface Env {
  BRAIN_DB: D1Database;
}

interface PatternCandidate {
  id: string;
  name: string;
  domains: string[];
  contributing_nodes: string[];
  score: number;
  detection_method: 'tag_cluster' | 'domain_bridge';
  first_seen: string;
}

interface PatternRow {
  id: string;
  name: string;
  domains: string;
  node_ids: string;
  status: string;
  first_seen: string;
  graduated_at: string | null;
}

const patterns = new Hono<{ Bindings: Env }>();

// GET /patterns/scan — run pattern detection
patterns.get('/scan', async (c) => {
  const startTime = Date.now();
  const db = c.env.BRAIN_DB;
  const today = new Date().toISOString().split('T')[0];

  try {
    // Get already-graduated pattern IDs to exclude
    const graduated = await db.prepare(
      `SELECT id, node_ids FROM brain_patterns WHERE status = 'graduated'`,
    ).all<PatternRow>();
    const graduatedIds = new Set(graduated.results.map((p) => p.id));

    const candidates: PatternCandidate[] = [];

    // 1. Tag clustering: find tags appearing in 3+ nodes across 2+ domains
    const allNodes = await db.prepare(
      `SELECT id, title, domain, tags FROM brain_nodes WHERE tags != '[]'`,
    ).all<{ id: string; title: string; domain: string; tags: string }>();

    const tagMap = new Map<string, { nodes: string[]; domains: Set<string>; titles: string[] }>();
    for (const node of allNodes.results) {
      let tags: string[];
      try {
        tags = JSON.parse(node.tags);
      } catch {
        continue;
      }
      for (const tag of tags) {
        const entry = tagMap.get(tag) ?? { nodes: [], domains: new Set(), titles: [] };
        entry.nodes.push(node.id);
        entry.domains.add(node.domain);
        entry.titles.push(node.title);
        tagMap.set(tag, entry);
      }
    }

    for (const [tag, entry] of tagMap) {
      if (entry.nodes.length >= 3 && entry.domains.size >= 2) {
        const domains = Array.from(entry.domains);
        const score = entry.nodes.length * domains.length;
        const id = `auto-tag-${simpleHash(tag)}`;
        if (!graduatedIds.has(id)) {
          candidates.push({
            id,
            name: `${tag} (cross-domain)`,
            domains,
            contributing_nodes: entry.nodes,
            score,
            detection_method: 'tag_cluster',
            first_seen: today,
          });
        }
      }
    }

    // 2. Domain bridging: find domain pairs with 3+ cross-connections
    const connections = await db.prepare(`
      SELECT bc.source_id, bc.target_id, ns.domain as source_domain, nt.domain as target_domain
      FROM brain_connections bc
      JOIN brain_nodes ns ON bc.source_id = ns.id
      JOIN brain_nodes nt ON bc.target_id = nt.id
      WHERE ns.domain != nt.domain
    `).all<{ source_id: string; target_id: string; source_domain: string; target_domain: string }>();

    const bridgeMap = new Map<string, { nodes: Set<string>; count: number }>();
    for (const conn of connections.results) {
      const pairKey = [conn.source_domain, conn.target_domain].sort().join(':');
      const entry = bridgeMap.get(pairKey) ?? { nodes: new Set(), count: 0 };
      entry.nodes.add(conn.source_id);
      entry.nodes.add(conn.target_id);
      entry.count++;
      bridgeMap.set(pairKey, entry);
    }

    for (const [pairKey, entry] of bridgeMap) {
      if (entry.count >= 3) {
        const domains = pairKey.split(':');
        const nodeIds = Array.from(entry.nodes);
        const score = nodeIds.length * domains.length;
        const id = `auto-bridge-${simpleHash(pairKey)}`;
        if (!graduatedIds.has(id)) {
          candidates.push({
            id,
            name: `${domains.join('–')} bridge`,
            domains,
            contributing_nodes: nodeIds,
            score,
            detection_method: 'domain_bridge',
            first_seen: today,
          });
        }
      }
    }

    // Sort by score descending
    candidates.sort((a, b) => b.score - a.score);

    return c.json({
      candidates,
      total_candidates: candidates.length,
      graduated_count: graduated.results.length,
      scan_time_ms: Date.now() - startTime,
    });
  } catch (e) {
    return c.json({ error: 'Pattern scan failed', details: String(e) }, 500);
  }
});

// POST /patterns/graduate — promote candidate to graduated
patterns.post('/graduate', async (c) => {
  const body = await c.req.json<{ pattern_id: string; name: string; description?: string }>();
  if (!body.pattern_id || !body.name) {
    return c.json({ error: 'Missing pattern_id or name' }, 400);
  }

  const now = new Date().toISOString();
  // Generate permanent ID from name if auto-generated
  const permanentId = body.pattern_id.startsWith('auto-')
    ? slugify(body.name)
    : body.pattern_id;

  try {
    // Check if pattern already exists
    const existing = await c.env.BRAIN_DB.prepare(
      'SELECT id FROM brain_patterns WHERE id = ?',
    ).bind(permanentId).first();

    if (existing) {
      // Update existing
      await c.env.BRAIN_DB.prepare(
        `UPDATE brain_patterns SET name = ?, status = 'graduated', graduated_at = ? WHERE id = ?`,
      ).bind(body.name, now, permanentId).run();
    } else {
      // Insert new graduated pattern
      await c.env.BRAIN_DB.prepare(
        `INSERT INTO brain_patterns (id, name, domains, node_ids, status, first_seen, graduated_at)
         VALUES (?, ?, '[]', '[]', 'graduated', ?, ?)`,
      ).bind(permanentId, body.name, now, now).run();
    }

    return c.json({ ok: true, id: permanentId, status: 'graduated' });
  } catch (e) {
    return c.json({ error: 'Graduate failed', details: String(e) }, 500);
  }
});

// GET /patterns/list — list all patterns
patterns.get('/list', async (c) => {
  const status = c.req.query('status');
  const limit = Math.min(parseInt(c.req.query('limit') ?? '20', 10), 100);
  const offset = parseInt(c.req.query('offset') ?? '0', 10);

  try {
    let sql = 'SELECT * FROM brain_patterns';
    const bindings: unknown[] = [];

    if (status) {
      sql += ' WHERE status = ?';
      bindings.push(status);
    }

    sql += ' ORDER BY first_seen DESC LIMIT ? OFFSET ?';
    bindings.push(limit, offset);

    const countSql = status
      ? 'SELECT COUNT(*) as total FROM brain_patterns WHERE status = ?'
      : 'SELECT COUNT(*) as total FROM brain_patterns';
    const countBindings = status ? [status] : [];

    const [results, countResult] = await Promise.all([
      c.env.BRAIN_DB.prepare(sql).bind(...bindings).all<PatternRow>(),
      c.env.BRAIN_DB.prepare(countSql).bind(...countBindings).first<{ total: number }>(),
    ]);

    return c.json({
      patterns: results.results.map((p) => ({
        ...p,
        domains: JSON.parse(p.domains),
        node_ids: JSON.parse(p.node_ids),
      })),
      total: countResult?.total ?? 0,
      limit,
      offset,
    });
  } catch (e) {
    return c.json({ error: 'List patterns failed', details: String(e) }, 500);
  }
});

// POST /patterns/archive — demote graduated to archived
patterns.post('/archive', async (c) => {
  const body = await c.req.json<{ pattern_id: string }>();
  if (!body.pattern_id) {
    return c.json({ error: 'Missing pattern_id' }, 400);
  }

  try {
    await c.env.BRAIN_DB.prepare(
      `UPDATE brain_patterns SET status = 'archived' WHERE id = ?`,
    ).bind(body.pattern_id).run();

    return c.json({ ok: true, id: body.pattern_id, status: 'archived' });
  } catch (e) {
    return c.json({ error: 'Archive failed', details: String(e) }, 500);
  }
});

function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

function slugify(str: string): string {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export { patterns };
