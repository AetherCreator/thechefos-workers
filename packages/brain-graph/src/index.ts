// packages/brain-graph/src/index.ts
import { Hono } from 'hono';
import { runMigrations } from './schema';
import { migrateBrainToD1 } from './migrate';
import { buildQuerySQL, buildGraphSQL, STATS_QUERIES } from './queries';
import type { NodeRow, ConnectionRow } from './queries';
import { patterns } from './patterns';
import { ops } from './ops';

export interface Env {
  BRAIN_DB: D1Database;
  OPS_KV: KVNamespace;
}

const app = new Hono<{ Bindings: Env }>();

// POST /migrate — create tables
app.post('/migrate', async (c) => {
  try {
    const result = await runMigrations(c.env.BRAIN_DB);
    return c.json({ ok: true, ...result });
  } catch (e) {
    return c.json({ error: 'Migration failed', details: String(e) }, 500);
  }
});

// POST /migrate/brain — GitHub → D1 migration
app.post('/migrate/brain', async (c) => {
  const githubToken = c.req.header('x-github-token');
  if (!githubToken) {
    return c.json({ error: 'Missing x-github-token header' }, 400);
  }

  try {
    const result = await migrateBrainToD1(c.env.BRAIN_DB, githubToken);
    return c.json({ ok: true, ...result });
  } catch (e) {
    return c.json({ error: 'Brain migration failed', details: String(e) }, 500);
  }
});

// GET /query — structured brain queries
app.get('/query', async (c) => {
  const params = {
    domain: c.req.query('domain'),
    type: c.req.query('type'),
    tag: c.req.query('tag'),
    sort: c.req.query('sort') as 'updated_at' | 'created_at' | 'connection_count' | undefined,
    order: c.req.query('order') as 'asc' | 'desc' | undefined,
    limit: c.req.query('limit') ? parseInt(c.req.query('limit')!, 10) : undefined,
    offset: c.req.query('offset') ? parseInt(c.req.query('offset')!, 10) : undefined,
    insights_only: c.req.query('insights_only') === 'true',
  };

  try {
    const { sql, bindings, countSql, countBindings } = buildQuerySQL(params);

    const [nodesResult, countResult] = await Promise.all([
      c.env.BRAIN_DB.prepare(sql).bind(...bindings).all<NodeRow>(),
      c.env.BRAIN_DB.prepare(countSql).bind(...countBindings).first<{ total: number }>(),
    ]);

    return c.json({
      nodes: nodesResult.results,
      total: countResult?.total ?? 0,
      limit: Math.min(params.limit ?? 20, 100),
      offset: params.offset ?? 0,
    });
  } catch (e) {
    return c.json({ error: 'Query failed', details: String(e) }, 500);
  }
});

// GET /node/:id — single node metadata
app.get('/node/:id', async (c) => {
  const id = c.req.param('id');

  try {
    const node = await c.env.BRAIN_DB.prepare('SELECT * FROM brain_nodes WHERE id = ?')
      .bind(id)
      .first<NodeRow>();

    if (!node) {
      return c.json({ error: 'Node not found' }, 404);
    }

    // Also fetch connections for this node
    const connections = await c.env.BRAIN_DB.prepare(
      'SELECT * FROM brain_connections WHERE source_id = ? OR target_id = ?',
    )
      .bind(id, id)
      .all<ConnectionRow>();

    return c.json({ node, connections: connections.results });
  } catch (e) {
    return c.json({ error: 'Failed to fetch node', details: String(e) }, 500);
  }
});

// GET /stats — domain distribution, type breakdown, connection density
app.get('/stats', async (c) => {
  try {
    const [totalRes, domainRes, typeRes, connRes, avgRes, insightRes, topRes] = await Promise.all([
      c.env.BRAIN_DB.prepare(STATS_QUERIES.totalNodes).first<{ total: number }>(),
      c.env.BRAIN_DB.prepare(STATS_QUERIES.byDomain).all<{ domain: string; count: number }>(),
      c.env.BRAIN_DB.prepare(STATS_QUERIES.byType).all<{ type: string; count: number }>(),
      c.env.BRAIN_DB.prepare(STATS_QUERIES.totalConnections).first<{ total: number }>(),
      c.env.BRAIN_DB.prepare(STATS_QUERIES.avgConnections).first<{ avg: number }>(),
      c.env.BRAIN_DB.prepare(STATS_QUERIES.insightRatio).first<{ ratio: number }>(),
      c.env.BRAIN_DB.prepare(STATS_QUERIES.mostConnected).all<{ id: string; title: string; connections: number }>(),
    ]);

    const byDomain: Record<string, number> = {};
    for (const row of domainRes.results) {
      byDomain[row.domain] = row.count;
    }

    const byType: Record<string, number> = {};
    for (const row of typeRes.results) {
      byType[row.type] = row.count;
    }

    return c.json({
      total_nodes: totalRes?.total ?? 0,
      by_domain: byDomain,
      by_type: byType,
      total_connections: connRes?.total ?? 0,
      avg_connections: Math.round((avgRes?.avg ?? 0) * 100) / 100,
      insight_ratio: Math.round((insightRes?.ratio ?? 0) * 100) / 100,
      most_connected: topRes.results,
    });
  } catch (e) {
    return c.json({ error: 'Stats query failed', details: String(e) }, 500);
  }
});

// GET /graph — connection map
app.get('/graph', async (c) => {
  const params = {
    node_id: c.req.query('node_id'),
    domain: c.req.query('domain'),
    min_connections: c.req.query('min_connections')
      ? parseInt(c.req.query('min_connections')!, 10)
      : undefined,
  };

  try {
    const { nodesSql, nodesBindings, edgesSql, edgesBindings } = buildGraphSQL(params);

    const [nodesResult, edgesResult] = await Promise.all([
      c.env.BRAIN_DB.prepare(nodesSql).bind(...nodesBindings).all(),
      c.env.BRAIN_DB.prepare(edgesSql).bind(...edgesBindings).all(),
    ]);

    return c.json({
      nodes: nodesResult.results,
      edges: edgesResult.results,
    });
  } catch (e) {
    return c.json({ error: 'Graph query failed', details: String(e) }, 500);
  }
});

// POST /connect — create a connection
app.post('/connect', async (c) => {
  const body = await c.req.json<{ source_id: string; target_id: string; relationship?: string }>();

  if (!body.source_id || !body.target_id) {
    return c.json({ error: 'Missing source_id or target_id' }, 400);
  }

  const relationship = body.relationship ?? 'connects_to';
  const now = new Date().toISOString();

  try {
    // Insert connection and update counts
    await c.env.BRAIN_DB.batch([
      c.env.BRAIN_DB.prepare(
        `INSERT OR IGNORE INTO brain_connections (source_id, target_id, relationship, created_at) VALUES (?, ?, ?, ?)`,
      ).bind(body.source_id, body.target_id, relationship, now),
      c.env.BRAIN_DB.prepare(
        `UPDATE brain_nodes SET connection_count = connection_count + 1 WHERE id = ?`,
      ).bind(body.source_id),
      c.env.BRAIN_DB.prepare(
        `UPDATE brain_nodes SET connection_count = connection_count + 1 WHERE id = ?`,
      ).bind(body.target_id),
    ]);

    return c.json({ ok: true, source_id: body.source_id, target_id: body.target_id, relationship });
  } catch (e) {
    return c.json({ error: 'Failed to create connection', details: String(e) }, 500);
  }
});

// Pattern detection routes
app.route('/patterns', patterns);

// OPS status routes
app.route('/ops', ops);

// GET /dashboard — aggregated dashboard data (single call)
app.get('/dashboard', async (c) => {
  const db = c.env.BRAIN_DB;
  const kv = c.env.OPS_KV;

  try {
    // Parallel: stats, recent nodes, top connected, patterns, KV reads
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    const [
      totalRes, domainRes, connRes, insightRatioRes,
      recentNodes, topConnected, recentCountRes,
      cycleData, sessionState,
      allNodes, graduatedCount,
    ] = await Promise.all([
      db.prepare(STATS_QUERIES.totalNodes).first<{ total: number }>(),
      db.prepare(STATS_QUERIES.byDomain).all<{ domain: string; count: number }>(),
      db.prepare(STATS_QUERIES.totalConnections).first<{ total: number }>(),
      db.prepare(STATS_QUERIES.insightRatio).first<{ ratio: number }>(),
      db.prepare('SELECT id, title, domain, type, updated_at, connection_count, summary FROM brain_nodes ORDER BY updated_at DESC LIMIT 5').all<NodeRow>(),
      db.prepare('SELECT id, title, domain, type, updated_at, connection_count, summary FROM brain_nodes ORDER BY connection_count DESC LIMIT 5').all<NodeRow>(),
      db.prepare('SELECT COUNT(*) as count FROM brain_nodes WHERE updated_at >= ?').bind(sevenDaysAgo).first<{ count: number }>(),
      kv.get('ops:current-cycle', 'json') as Promise<{ id: string; name: string; starts: string; ends: string; status: string; issues: { total: number; done: number; in_progress: number; todo: number }; next: { id: string; name: string; starts: string } } | null>,
      kv.get('session:execution-state', 'json') as Promise<Record<string, unknown> | null>,
      db.prepare("SELECT id, title, domain, tags FROM brain_nodes WHERE tags != '[]'").all<{ id: string; title: string; domain: string; tags: string }>(),
      db.prepare("SELECT COUNT(*) as count FROM brain_patterns WHERE status = 'graduated'").first<{ count: number }>(),
    ]);

    // Domain distribution
    const byDomain: Record<string, number> = {};
    let leastCovered = '';
    let leastCount = Infinity;
    for (const row of domainRes.results) {
      byDomain[row.domain] = row.count;
      if (row.count < leastCount) {
        leastCount = row.count;
        leastCovered = row.domain;
      }
    }

    // Lightweight pattern scan (tag clustering only, top 3)
    const tagMap = new Map<string, { nodes: string[]; domains: Set<string> }>();
    for (const node of allNodes.results) {
      let tags: string[];
      try { tags = JSON.parse(node.tags); } catch { continue; }
      for (const tag of tags) {
        const entry = tagMap.get(tag) ?? { nodes: [], domains: new Set() };
        entry.nodes.push(node.id);
        entry.domains.add(node.domain);
        tagMap.set(tag, entry);
      }
    }
    const candidates: { name: string; domains: string[]; score: number; node_count: number }[] = [];
    for (const [tag, entry] of tagMap) {
      if (entry.nodes.length >= 3 && entry.domains.size >= 2) {
        candidates.push({
          name: `${tag} (cross-domain)`,
          domains: Array.from(entry.domains),
          score: entry.nodes.length * entry.domains.size,
          node_count: entry.nodes.length,
        });
      }
    }
    candidates.sort((a, b) => b.score - a.score);

    // OPS cycle
    const today = new Date();
    let opsData = { cycle: '', name: '', completion_pct: 0, days_remaining: 0 };
    if (cycleData) {
      const endsDate = new Date(cycleData.ends + 'T23:59:59Z');
      const daysRemaining = Math.max(0, Math.ceil((endsDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)));
      const completionPct = cycleData.issues.total > 0 ? Math.round((cycleData.issues.done / cycleData.issues.total) * 100) : 0;
      opsData = { cycle: cycleData.id, name: cycleData.name, completion_pct: completionPct, days_remaining: daysRemaining };
    }

    return c.json({
      vitals: {
        total_nodes: totalRes?.total ?? 0,
        by_domain: byDomain,
        total_connections: connRes?.total ?? 0,
        insight_ratio: Math.round((insightRatioRes?.ratio ?? 0) * 100) / 100,
        least_covered: leastCovered,
        nodes_last_7d: recentCountRes?.count ?? 0,
      },
      ops: opsData,
      patterns: {
        candidates: candidates.slice(0, 3),
        graduated_count: graduatedCount?.count ?? 0,
      },
      session: sessionState ?? null,
      recent_nodes: recentNodes.results,
      top_connected: topConnected.results,
      generated_at: new Date().toISOString(),
    });
  } catch (e) {
    return c.json({ error: 'Dashboard aggregation failed', details: String(e) }, 500);
  }
});

// Health check
app.get('/health', (c) => c.json({ status: 'ok', worker: 'superclaude-brain-graph' }));

export default app;
