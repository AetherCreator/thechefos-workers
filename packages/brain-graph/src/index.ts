import { Hono } from 'hono';
import { runMigrations } from './schema';
import { migrateBrainToD1 } from './migrate';
import { buildNodeQuery, buildCountQuery, buildGraphQuery, NodeRow, ConnectionRow } from './queries';

export interface Env {
  BRAIN_DB: D1Database;
}

const app = new Hono<{ Bindings: Env }>();

// POST /migrate — create tables
app.post('/migrate', async (c) => {
  try {
    await runMigrations(c.env.BRAIN_DB);
    return c.json({ success: true, message: 'Schema migration complete — 3 tables created' });
  } catch (e) {
    return c.json({ success: false, error: (e as Error).message }, 500);
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
    return c.json({ success: true, ...result });
  } catch (e) {
    return c.json({ success: false, error: (e as Error).message }, 500);
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
    const { sql, bindings } = buildNodeQuery(params);
    const { sql: countSql, bindings: countBindings } = buildCountQuery(params);

    const [nodesResult, countResult] = await Promise.all([
      c.env.BRAIN_DB.prepare(sql).bind(...bindings).all<NodeRow>(),
      c.env.BRAIN_DB.prepare(countSql).bind(...countBindings).first<{ total: number }>(),
    ]);

    return c.json({
      nodes: nodesResult.results,
      total: countResult?.total || 0,
      limit: Math.min(params.limit || 20, 100),
      offset: params.offset || 0,
    });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 500);
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

    const connections = await c.env.BRAIN_DB.prepare(
      'SELECT * FROM brain_connections WHERE source_id = ? OR target_id = ?',
    )
      .bind(id, id)
      .all<ConnectionRow>();

    return c.json({ node, connections: connections.results });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 500);
  }
});

// GET /stats — domain distribution, type breakdown, connection density, insight ratio
app.get('/stats', async (c) => {
  try {
    const [
      totalResult,
      domainResult,
      typeResult,
      connResult,
      insightResult,
      mostConnected,
    ] = await Promise.all([
      c.env.BRAIN_DB.prepare('SELECT COUNT(*) as total FROM brain_nodes').first<{ total: number }>(),
      c.env.BRAIN_DB.prepare('SELECT domain, COUNT(*) as count FROM brain_nodes GROUP BY domain').all<{ domain: string; count: number }>(),
      c.env.BRAIN_DB.prepare('SELECT type, COUNT(*) as count FROM brain_nodes GROUP BY type').all<{ type: string; count: number }>(),
      c.env.BRAIN_DB.prepare('SELECT COUNT(*) as total FROM brain_connections').first<{ total: number }>(),
      c.env.BRAIN_DB.prepare('SELECT COUNT(*) as count FROM brain_nodes WHERE is_insight = 1').first<{ count: number }>(),
      c.env.BRAIN_DB.prepare('SELECT id, title, connection_count as connections FROM brain_nodes ORDER BY connection_count DESC LIMIT 10').all<{ id: string; title: string; connections: number }>(),
    ]);

    const totalNodes = totalResult?.total || 0;
    const totalConnections = connResult?.total || 0;
    const insightCount = insightResult?.count || 0;

    const byDomain: Record<string, number> = {};
    for (const row of domainResult.results) {
      byDomain[row.domain] = row.count;
    }

    const byType: Record<string, number> = {};
    for (const row of typeResult.results) {
      byType[row.type] = row.count;
    }

    return c.json({
      total_nodes: totalNodes,
      by_domain: byDomain,
      by_type: byType,
      total_connections: totalConnections,
      avg_connections: totalNodes > 0 ? Math.round((totalConnections / totalNodes) * 100) / 100 : 0,
      insight_ratio: totalNodes > 0 ? Math.round((insightCount / totalNodes) * 100) / 100 : 0,
      most_connected: mostConnected.results,
    });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 500);
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
    const { nodesSql, nodeBindings, edgesSql, edgeBindings } = buildGraphQuery(params);

    const [nodesResult, edgesResult] = await Promise.all([
      c.env.BRAIN_DB.prepare(nodesSql).bind(...nodeBindings).all<NodeRow>(),
      c.env.BRAIN_DB.prepare(edgesSql).bind(...edgeBindings).all<ConnectionRow>(),
    ]);

    return c.json({
      nodes: nodesResult.results,
      edges: edgesResult.results,
    });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 500);
  }
});

// POST /connect — create a connection
app.post('/connect', async (c) => {
  try {
    const body = await c.req.json<{
      source_id: string;
      target_id: string;
      relationship?: string;
    }>();

    if (!body.source_id || !body.target_id) {
      return c.json({ error: 'source_id and target_id are required' }, 400);
    }

    const relationship = body.relationship || 'connects_to';
    const now = new Date().toISOString();

    await c.env.BRAIN_DB.prepare(
      `INSERT OR IGNORE INTO brain_connections (source_id, target_id, relationship, created_at)
       VALUES (?, ?, ?, ?)`,
    )
      .bind(body.source_id, body.target_id, relationship, now)
      .run();

    // Update connection counts on both nodes
    await c.env.BRAIN_DB.batch([
      c.env.BRAIN_DB.prepare(
        `UPDATE brain_nodes SET connection_count = (
          SELECT COUNT(*) FROM brain_connections WHERE source_id = ? OR target_id = ?
        ) WHERE id = ?`,
      ).bind(body.source_id, body.source_id, body.source_id),
      c.env.BRAIN_DB.prepare(
        `UPDATE brain_nodes SET connection_count = (
          SELECT COUNT(*) FROM brain_connections WHERE source_id = ? OR target_id = ?
        ) WHERE id = ?`,
      ).bind(body.target_id, body.target_id, body.target_id),
    ]);

    return c.json({ success: true, source_id: body.source_id, target_id: body.target_id, relationship });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 500);
  }
});

// Health check
app.get('/health', (c) =>
  c.json({ status: 'ok', worker: 'superclaude-brain-graph' }),
);

export default app;
