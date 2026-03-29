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

// Health check
app.get('/health', (c) => c.json({ status: 'ok', worker: 'superclaude-brain-graph' }));

export default app;
