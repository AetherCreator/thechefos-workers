import { Hono } from 'hono';
import { runMigrations } from './schema';
import { migrateBrainToD1 } from './migrate';
import { buildNodeQuery, buildCountQuery, buildGraphQuery, NodeRow, ConnectionRow } from './queries';

export interface Env {
  BRAIN_DB: D1Database;
}

const app = new Hono<{ Bindings: Env }>();

// CORS — allow Claude.ai artifacts, web_fetch, and all browser origins
app.use('*', async (c, next) => {
  if (c.req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-github-token',
        'Access-Control-Max-Age': '86400',
      },
    });
  }
  await next();
  c.res.headers.set('Access-Control-Allow-Origin', '*');
  c.res.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  c.res.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-github-token');
});

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

// ---------------------------------------------------------------------------
// Clue 7: Pattern Detection + OPS
// ---------------------------------------------------------------------------

// GET /patterns/scan — detect cross-domain pattern candidates from D1
app.get('/patterns/scan', async (c) => {
  const db = c.env.BRAIN_DB;
  try {
    // Strategy 1: Find node types that span multiple domains
    const typeDomainResult = await db.prepare(`
      SELECT type, COUNT(DISTINCT domain) as domain_count, COUNT(*) as node_count,
             GROUP_CONCAT(DISTINCT domain) as domains
      FROM brain_nodes
      GROUP BY type
      HAVING domain_count >= 2
      ORDER BY domain_count DESC, node_count DESC
    `).all<{ type: string; domain_count: number; node_count: number; domains: string }>();

    // Strategy 2: Find domains that share the same node types (domain overlap)
    const domainOverlapResult = await db.prepare(`
      SELECT a.domain as domain_a, b.domain as domain_b, COUNT(DISTINCT a.type) as shared_types
      FROM brain_nodes a
      JOIN brain_nodes b ON a.type = b.type AND a.domain < b.domain
      GROUP BY a.domain, b.domain
      HAVING shared_types >= 2
      ORDER BY shared_types DESC
    `).all<{ domain_a: string; domain_b: string; shared_types: number }>();

    // Strategy 3: Check existing patterns in brain_patterns table
    const existingPatterns = await db.prepare(
      "SELECT * FROM brain_patterns ORDER BY first_seen DESC"
    ).all<{ id: string; name: string; domains: string; node_ids: string; status: string; first_seen: string; graduated_at: string | null }>();

    // Build candidates from type-domain analysis
    const candidates = typeDomainResult.results.map((row) => {
      const domains = row.domains.split(',');
      // Score: domain spread * 3 + log of node count, capped
      const score = row.domain_count * 3 + Math.min(Math.floor(Math.log2(row.node_count + 1)) * 2, 8);
      return {
        name: `cross-domain-${row.type}`,
        type: row.type,
        domains,
        domain_count: row.domain_count,
        node_count: row.node_count,
        score,
        status: 'candidate' as const,
        source: 'type_domain_scan',
      };
    });

    // Get total scanned + graduated count
    const [totalResult, graduatedResult] = await Promise.all([
      db.prepare('SELECT COUNT(*) as total FROM brain_nodes').first<{ total: number }>(),
      db.prepare("SELECT COUNT(*) as count FROM brain_patterns WHERE status = 'graduated'").first<{ count: number }>(),
    ]);

    return c.json({
      candidates: candidates.filter((p) => p.score >= 5),
      domain_overlaps: domainOverlapResult.results,
      existing_patterns: existingPatterns.results.map((p) => ({
        ...p,
        domains: JSON.parse(p.domains || '[]'),
        node_ids: JSON.parse(p.node_ids || '[]'),
      })),
      graduated_count: graduatedResult?.count || 0,
      total_nodes_scanned: totalResult?.total || 0,
      scanned_at: new Date().toISOString(),
    });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 500);
  }
});

// POST /patterns/graduate — promote a candidate pattern to graduated
app.post('/patterns/graduate', async (c) => {
  const db = c.env.BRAIN_DB;
  try {
    const body = await c.req.json<{
      name: string;
      domains: string[];
      node_ids?: string[];
    }>();

    if (!body.name || !body.domains || body.domains.length < 2) {
      return c.json({ error: 'name and domains (2+ required) are required' }, 400);
    }

    const id = `pattern-${body.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
    const now = new Date().toISOString();

    // Check if pattern already exists
    const existing = await db.prepare('SELECT * FROM brain_patterns WHERE id = ?')
      .bind(id)
      .first();

    if (existing) {
      // Update to graduated
      await db.prepare(
        "UPDATE brain_patterns SET status = 'graduated', graduated_at = ? WHERE id = ?"
      ).bind(now, id).run();
    } else {
      // Insert as graduated
      await db.prepare(
        `INSERT INTO brain_patterns (id, name, domains, node_ids, status, first_seen, graduated_at)
         VALUES (?, ?, ?, ?, 'graduated', ?, ?)`
      ).bind(
        id,
        body.name,
        JSON.stringify(body.domains),
        JSON.stringify(body.node_ids || []),
        now,
        now,
      ).run();
    }

    return c.json({
      success: true,
      pattern: {
        id,
        name: body.name,
        domains: body.domains,
        node_ids: body.node_ids || [],
        status: 'graduated',
        graduated_at: now,
      },
    });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 500);
  }
});

// GET /ops/vitals — comprehensive system health stats
app.get('/ops/vitals', async (c) => {
  const db = c.env.BRAIN_DB;
  try {
    const [
      totalResult,
      domainResult,
      typeResult,
      connResult,
      insightResult,
      patternResult,
      recent7dResult,
      oldestResult,
      newestResult,
      topConnectedResult,
      isolatedResult,
    ] = await Promise.all([
      db.prepare('SELECT COUNT(*) as total FROM brain_nodes').first<{ total: number }>(),
      db.prepare('SELECT domain, COUNT(*) as count FROM brain_nodes GROUP BY domain ORDER BY count DESC').all<{ domain: string; count: number }>(),
      db.prepare('SELECT type, COUNT(*) as count FROM brain_nodes GROUP BY type ORDER BY count DESC').all<{ type: string; count: number }>(),
      db.prepare('SELECT COUNT(*) as total FROM brain_connections').first<{ total: number }>(),
      db.prepare('SELECT COUNT(*) as count FROM brain_nodes WHERE is_insight = 1').first<{ count: number }>(),
      db.prepare('SELECT status, COUNT(*) as count FROM brain_patterns GROUP BY status').all<{ status: string; count: number }>(),
      db.prepare("SELECT COUNT(*) as count FROM brain_nodes WHERE updated_at >= date('now', '-7 days')").first<{ count: number }>(),
      db.prepare('SELECT MIN(created_at) as oldest FROM brain_nodes').first<{ oldest: string }>(),
      db.prepare('SELECT MAX(updated_at) as newest FROM brain_nodes').first<{ newest: string }>(),
      db.prepare('SELECT id, title, domain, connection_count FROM brain_nodes ORDER BY connection_count DESC LIMIT 5').all<{ id: string; title: string; domain: string; connection_count: number }>(),
      db.prepare('SELECT COUNT(*) as count FROM brain_nodes WHERE connection_count = 0').first<{ count: number }>(),
    ]);

    const totalNodes = totalResult?.total || 0;
    const totalConnections = connResult?.total || 0;
    const insightCount = insightResult?.count || 0;
    const isolatedCount = isolatedResult?.count || 0;

    const byDomain: Record<string, number> = {};
    let leastCovered = '';
    let leastCount = Infinity;
    for (const row of domainResult.results) {
      byDomain[row.domain] = row.count;
      if (row.count < leastCount) {
        leastCount = row.count;
        leastCovered = row.domain;
      }
    }

    const byType: Record<string, number> = {};
    for (const row of typeResult.results) {
      byType[row.type] = row.count;
    }

    const patternsByStatus: Record<string, number> = {};
    for (const row of patternResult.results) {
      patternsByStatus[row.status] = row.count;
    }

    return c.json({
      brain: {
        total_nodes: totalNodes,
        total_connections: totalConnections,
        insight_count: insightCount,
        insight_ratio: totalNodes > 0 ? Math.round((insightCount / totalNodes) * 100) / 100 : 0,
        avg_connections: totalNodes > 0 ? Math.round((totalConnections / totalNodes) * 100) / 100 : 0,
        isolated_nodes: isolatedCount,
        isolation_pct: totalNodes > 0 ? Math.round((isolatedCount / totalNodes) * 100) : 0,
      },
      domains: {
        count: domainResult.results.length,
        distribution: byDomain,
        least_covered: leastCovered,
        least_covered_count: leastCount === Infinity ? 0 : leastCount,
      },
      types: {
        count: typeResult.results.length,
        distribution: byType,
      },
      patterns: {
        by_status: patternsByStatus,
        candidates: patternsByStatus['candidate'] || 0,
        graduated: patternsByStatus['graduated'] || 0,
      },
      activity: {
        nodes_last_7d: recent7dResult?.count || 0,
        oldest_node: oldestResult?.oldest || null,
        newest_node: newestResult?.newest || null,
      },
      top_connected: topConnectedResult.results,
      health: {
        status: totalNodes > 0 ? 'healthy' : 'empty',
        node_count_ok: totalNodes >= 100,
        domains_ok: domainResult.results.length >= 5,
        has_insights: insightCount > 0,
        has_connections: totalConnections > 0,
      },
      generated_at: new Date().toISOString(),
    });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 500);
  }
});


// ---------------------------------------------------------------------------
// Session Usage Tracking + Odometer
// ---------------------------------------------------------------------------

interface OdometerRow {
  id: string;
  current_pct: number;
  last_updated: string;
  session_current_pct: number;
  session_last_updated: string;
  session_last_id: string | null;
  weekly_current_pct: number;
  weekly_reset_at: string;
  weekly_last_updated: string | null;
}

interface SessionUsageBody {
  date: string;
  surface: string;
  session_type: string;
  usage_pct?: number;
  msg_count?: number;
  mcp_count?: number;
  retry_loops?: number;
  note?: string;
}

export interface SessionUsageRow {
  id: string;
  date: string;
  surface: string;
  session_type: string;
  msg_count: number | null;
  usage_pct: number | null;
  baseline_pct: number | null;
  burn_pct: number | null;
  mcp_count: number | null;
  retry_loops: number;
  note: string | null;
  created_at: string;
}

// GET /session/odometer — current odometer state with auto-reset logic
app.get('/session/odometer', async (c) => {
  const db = c.env.BRAIN_DB;
  const row = await db.prepare('SELECT * FROM usage_odometer WHERE id = ?')
    .bind('singleton').first<OdometerRow>();
  if (!row) return c.json({ error: 'Odometer not initialized' }, 500);

  const now = new Date();
  const lastUpdated = new Date(row.session_last_updated || row.last_updated);
  const hoursSinceLast = (now.getTime() - lastUpdated.getTime()) / 3_600_000;
  const windowRolled = hoursSinceLast >= 5;

  return c.json({
    session: {
      current_pct: windowRolled ? 0 : row.session_current_pct,
      window_rolled: windowRolled,
      hours_since_last: Math.round(hoursSinceLast * 10) / 10,
      last_updated: row.session_last_updated || row.last_updated,
    },
    weekly: {
      current_pct: row.weekly_current_pct,
      reset_at: row.weekly_reset_at,
    },
  });
});

// POST /session/odometer/weekly-reset — reset weekly counter
app.post('/session/odometer/weekly-reset', async (c) => {
  const now = new Date().toISOString();
  await c.env.BRAIN_DB.prepare(
    'UPDATE usage_odometer SET weekly_current_pct=0, weekly_reset_at=?, weekly_last_updated=? WHERE id=?'
  ).bind(now, now, 'singleton').run();
  return c.json({ ok: true, reset_at: now });
});

// POST /session/usage — log a session with full odometer logic
app.post('/session/usage', async (c) => {
  const db = c.env.BRAIN_DB;
  try {
    const body = await c.req.json<SessionUsageBody>();

    // Validation
    const validSurfaces = ['chat', 'code', 'dispatch'];
    const validTypes = ['infra', 'code-gen', 'planning', 'mixed'];
    if (!body.date || !body.surface || !body.session_type)
      return c.json({ error: 'date, surface, session_type required' }, 400);
    if (!validSurfaces.includes(body.surface))
      return c.json({ error: `surface must be one of: ${validSurfaces.join(', ')}` }, 400);
    if (!validTypes.includes(body.session_type))
      return c.json({ error: `session_type must be one of: ${validTypes.join(', ')}` }, 400);

    // 1. Read odometer
    const odometer = await db.prepare('SELECT * FROM usage_odometer WHERE id = ?')
      .bind('singleton').first<OdometerRow>();

    const now = new Date();
    const usage_pct: number | null = body.usage_pct ?? null;

    // 2. Passive 5hr reset — infer from silence
    const lastUpdated = new Date(
      odometer?.session_last_updated || odometer?.last_updated || now.toISOString()
    );
    const hoursSinceLast = (now.getTime() - lastUpdated.getTime()) / 3_600_000;
    const windowRolled = hoursSinceLast >= 5;
    const baseline_pct = windowRolled ? 0 : (odometer?.session_current_pct ?? 0);

    // 3. Compute burn (clamp to 0 — can't burn negative)
    const burn_pct = usage_pct !== null ? Math.max(0, usage_pct - baseline_pct) : null;

    // 4. Insert session row
    const id = `sess-${body.date}-${Date.now().toString(36)}`;
    const nowIso = now.toISOString();

    await db.prepare(
      `INSERT INTO session_usage
       (id, date, surface, session_type, msg_count, usage_pct, baseline_pct, burn_pct,
        mcp_count, retry_loops, note, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      id, body.date, body.surface, body.session_type,
      body.msg_count ?? null, usage_pct, baseline_pct, burn_pct,
      body.mcp_count ?? null, body.retry_loops ?? 0, body.note ?? null, nowIso
    ).run();

    // 5. Update odometer — session window
    const newSessionPct = usage_pct ?? baseline_pct;

    // 6. Weekly accumulation — add burn to weekly total
    const newWeeklyPct = (odometer?.weekly_current_pct ?? 0) + (burn_pct ?? 0);

    await db.prepare(
      `UPDATE usage_odometer SET
         session_current_pct=?, session_last_updated=?, session_last_id=?,
         weekly_current_pct=?, weekly_last_updated=?
       WHERE id=?`
    ).bind(newSessionPct, nowIso, id, newWeeklyPct, nowIso, 'singleton').run();

    // 7. Flags
    const flags: string[] = [];
    if (windowRolled) flags.push('5hr window rolled — baseline reset to 0%');
    if (burn_pct !== null && burn_pct >= 8) flags.push('high-burn session — consider fresh context next time');
    if (usage_pct !== null && usage_pct >= 85) flags.push('approaching session limit — fresh session recommended');
    if (newWeeklyPct >= 80) flags.push('weekly usage high — monitor toward limit');

    return c.json({
      ok: true, id,
      burn_pct,
      baseline_pct,
      usage_pct,
      window_rolled: windowRolled,
      hours_since_last: Math.round(hoursSinceLast * 10) / 10,
      weekly_total_pct: Math.round(newWeeklyPct * 10) / 10,
      flags,
    });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 500);
  }
});

// GET /session/usage — list sessions with optional filters
app.get('/session/usage', async (c) => {
  const db = c.env.BRAIN_DB;
  try {
    const surface = c.req.query('surface');
    const session_type = c.req.query('session_type');
    const since = c.req.query('since');
    const limit = Math.min(parseInt(c.req.query('limit') || '50', 10), 200);

    let sql = 'SELECT * FROM session_usage WHERE 1=1';
    const bindings: (string | number)[] = [];

    if (surface) { sql += ' AND surface = ?'; bindings.push(surface); }
    if (session_type) { sql += ' AND session_type = ?'; bindings.push(session_type); }
    if (since) { sql += ' AND date >= ?'; bindings.push(since); }

    sql += ' ORDER BY date DESC, created_at DESC LIMIT ?';
    bindings.push(limit);

    const rows = await db.prepare(sql).bind(...bindings).all<SessionUsageRow>();
    return c.json({ sessions: rows.results, total: rows.results.length });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 500);
  }
});

// GET /session/usage/summary — aggregated stats for pattern analysis
app.get('/session/usage/summary', async (c) => {
  const db = c.env.BRAIN_DB;
  try {
    const [
      byTypeResult,
      bySurfaceResult,
      avgByTypeResult,
      retryCorrelationResult,
      totalResult,
      burnByTypeResult,
      odometerResult,
    ] = await Promise.all([
      db.prepare(`
        SELECT session_type,
               COUNT(*) as count,
               AVG(usage_pct) as avg_usage_pct,
               AVG(msg_count) as avg_msgs,
               SUM(retry_loops) as total_retries
        FROM session_usage
        WHERE usage_pct IS NOT NULL
        GROUP BY session_type
        ORDER BY avg_usage_pct DESC
      `).all<{ session_type: string; count: number; avg_usage_pct: number; avg_msgs: number; total_retries: number }>(),

      db.prepare(`
        SELECT surface,
               COUNT(*) as count,
               AVG(usage_pct) as avg_usage_pct
        FROM session_usage
        WHERE usage_pct IS NOT NULL
        GROUP BY surface
      `).all<{ surface: string; count: number; avg_usage_pct: number }>(),

      db.prepare(`
        SELECT session_type,
               AVG(CASE WHEN mcp_count > 2 THEN usage_pct ELSE NULL END) as avg_high_mcp_usage,
               AVG(CASE WHEN mcp_count <= 2 THEN usage_pct ELSE NULL END) as avg_low_mcp_usage
        FROM session_usage
        WHERE usage_pct IS NOT NULL AND mcp_count IS NOT NULL
        GROUP BY session_type
      `).all<{ session_type: string; avg_high_mcp_usage: number | null; avg_low_mcp_usage: number | null }>(),

      db.prepare(`
        SELECT
          AVG(CASE WHEN retry_loops = 1 THEN usage_pct ELSE NULL END) as avg_usage_with_retries,
          AVG(CASE WHEN retry_loops = 0 THEN usage_pct ELSE NULL END) as avg_usage_no_retries,
          COUNT(CASE WHEN retry_loops = 1 THEN 1 END) as sessions_with_retries
        FROM session_usage
        WHERE usage_pct IS NOT NULL
      `).first<{ avg_usage_with_retries: number | null; avg_usage_no_retries: number | null; sessions_with_retries: number }>(),

      db.prepare('SELECT COUNT(*) as total FROM session_usage').first<{ total: number }>(),

      // Burn by session type
      db.prepare(`
        SELECT session_type,
          COUNT(*) as count,
          AVG(burn_pct) as avg_burn,
          MAX(burn_pct) as max_burn,
          SUM(burn_pct) as total_burn,
          AVG(usage_pct) as avg_close_pct
        FROM session_usage
        WHERE burn_pct IS NOT NULL
        GROUP BY session_type ORDER BY avg_burn DESC
      `).all<{ session_type: string; count: number; avg_burn: number; max_burn: number; total_burn: number; avg_close_pct: number }>(),

      // Current odometer state
      db.prepare('SELECT * FROM usage_odometer WHERE id = ?').bind('singleton').first(),
    ]);

    return c.json({
      total_sessions: totalResult?.total || 0,
      by_type: byTypeResult.results,
      by_surface: bySurfaceResult.results,
      mcp_impact: avgByTypeResult.results,
      retry_impact: retryCorrelationResult,
      burn_by_type: burnByTypeResult.results,
      odometer: odometerResult,
      hypothesis_status: totalResult?.total && totalResult.total >= 5
        ? 'accumulating_data'
        : 'insufficient_data',
      generated_at: new Date().toISOString(),
    });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 500);
  }
});

// ---------------------------------------------------------------------------
// Dashboard + Health
// ---------------------------------------------------------------------------

// GET /dashboard — aggregated view for brain dashboard
app.get('/dashboard', async (c) => {
  try {
    const db = c.env.BRAIN_DB;

    // Run all queries in parallel
    const [
      totalResult,
      domainResult,
      connResult,
      insightResult,
      recentNodesResult,
      topConnectedResult,
      patternsResult,
      recentCountResult,
    ] = await Promise.all([
      db.prepare('SELECT COUNT(*) as total FROM brain_nodes').first<{ total: number }>(),
      db.prepare('SELECT domain, COUNT(*) as count FROM brain_nodes GROUP BY domain').all<{ domain: string; count: number }>(),
      db.prepare('SELECT COUNT(*) as total FROM brain_connections').first<{ total: number }>(),
      db.prepare('SELECT COUNT(*) as count FROM brain_nodes WHERE is_insight = 1').first<{ count: number }>(),
      db.prepare('SELECT * FROM brain_nodes ORDER BY updated_at DESC LIMIT 5').all<NodeRow>(),
      db.prepare('SELECT * FROM brain_nodes ORDER BY connection_count DESC LIMIT 5').all<NodeRow>(),
      db.prepare("SELECT * FROM brain_patterns WHERE status = 'candidate' ORDER BY first_seen DESC LIMIT 3").all<{ id: string; name: string; domains: string; node_ids: string; status: string; first_seen: string; graduated_at: string | null }>(),
      db.prepare("SELECT COUNT(*) as count FROM brain_nodes WHERE updated_at >= date('now', '-7 days')").first<{ count: number }>(),
    ]);

    const totalNodes = totalResult?.total || 0;
    const totalConnections = connResult?.total || 0;
    const insightCount = insightResult?.count || 0;

    const byDomain: Record<string, number> = {};
    let leastCovered = '';
    let leastCount = Infinity;
    for (const row of domainResult.results) {
      byDomain[row.domain] = row.count;
      if (row.count < leastCount) {
        leastCount = row.count;
        leastCovered = row.domain;
      }
    }

    const graduatedCount = await db.prepare("SELECT COUNT(*) as count FROM brain_patterns WHERE status = 'graduated'").first<{ count: number }>();

    return c.json({
      vitals: {
        total_nodes: totalNodes,
        by_domain: byDomain,
        total_connections: totalConnections,
        insight_ratio: totalNodes > 0 ? Math.round((insightCount / totalNodes) * 100) / 100 : 0,
        least_covered: leastCovered,
        nodes_last_7d: recentCountResult?.count || 0,
      },
      ops: {
        cycle: 'ops-01',
        name: 'Brain Foundation Audit',
        completion_pct: 80,
        days_remaining: 2,
      },
      patterns: {
        candidates: patternsResult.results.map((p) => ({
          id: p.id,
          name: p.name,
          domains: JSON.parse(p.domains || '[]'),
          node_ids: JSON.parse(p.node_ids || '[]'),
          status: p.status,
          first_seen: p.first_seen,
        })),
        graduated_count: graduatedCount?.count || 0,
      },
      session: null,
      recent_nodes: recentNodesResult.results,
      top_connected: topConnectedResult.results,
      generated_at: new Date().toISOString(),
    });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 500);
  }
});

// Health check
app.get('/health', (c) =>
  c.json({ status: 'ok', worker: 'superclaude-brain-graph' }),
);

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return app.fetch(request, env);
  },
  async scheduled(_event: ScheduledEvent, env: Env): Promise<void> {
    const now = new Date().toISOString();
    await env.BRAIN_DB.prepare(
      'UPDATE usage_odometer SET weekly_current_pct=0, weekly_reset_at=?, weekly_last_updated=? WHERE id=?'
    ).bind(now, now, 'singleton').run();
  },
};

