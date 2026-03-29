// packages/brain-graph/src/ops.ts
import { Hono } from 'hono';
import { STATS_QUERIES } from './queries';

interface Env {
  BRAIN_DB: D1Database;
  OPS_KV: KVNamespace;
}

interface CycleData {
  id: string;
  name: string;
  starts: string;
  ends: string;
  status: string;
  issues: { total: number; done: number; in_progress: number; todo: number };
  next: { id: string; name: string; starts: string };
}

const DEFAULT_CYCLE: CycleData = {
  id: 'ops-01',
  name: 'Brain Foundation Audit',
  starts: '2026-03-23',
  ends: '2026-03-31',
  status: 'active',
  issues: { total: 15, done: 12, in_progress: 1, todo: 2 },
  next: { id: 'ops-02', name: 'Skill Inventory & Gap Analysis', starts: '2026-04-01' },
};

const ops = new Hono<{ Bindings: Env }>();

// GET /ops/status — current OPS cycle info
ops.get('/status', async (c) => {
  try {
    let cycleData = await c.env.OPS_KV.get<CycleData>('ops:current-cycle', 'json');
    if (!cycleData) {
      // Seed with default data
      await c.env.OPS_KV.put('ops:current-cycle', JSON.stringify(DEFAULT_CYCLE));
      cycleData = DEFAULT_CYCLE;
    }

    const today = new Date();
    const endsDate = new Date(cycleData.ends + 'T23:59:59Z');
    const daysRemaining = Math.max(0, Math.ceil((endsDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)));

    const completionPct = cycleData.issues.total > 0
      ? Math.round((cycleData.issues.done / cycleData.issues.total) * 100)
      : 0;

    return c.json({
      cycle: {
        id: cycleData.id,
        name: cycleData.name,
        starts: cycleData.starts,
        ends: cycleData.ends,
        days_remaining: daysRemaining,
        status: cycleData.status,
      },
      issues: {
        ...cycleData.issues,
        completion_pct: completionPct,
      },
      next_cycle: cycleData.next,
    });
  } catch (e) {
    return c.json({ error: 'Failed to get OPS status', details: String(e) }, 500);
  }
});

// POST /ops/status — update cycle status
ops.post('/status', async (c) => {
  try {
    const body = await c.req.json<CycleData>();
    await c.env.OPS_KV.put('ops:current-cycle', JSON.stringify(body));

    const today = new Date();
    const endsDate = new Date(body.ends + 'T23:59:59Z');
    const daysRemaining = Math.max(0, Math.ceil((endsDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)));

    const completionPct = body.issues.total > 0
      ? Math.round((body.issues.done / body.issues.total) * 100)
      : 0;

    return c.json({
      ok: true,
      cycle: {
        id: body.id,
        name: body.name,
        starts: body.starts,
        ends: body.ends,
        days_remaining: daysRemaining,
        status: body.status,
      },
      issues: {
        ...body.issues,
        completion_pct: completionPct,
      },
      next_cycle: body.next,
    });
  } catch (e) {
    return c.json({ error: 'Failed to update OPS status', details: String(e) }, 500);
  }
});

// GET /ops/vitals — comprehensive system health
ops.get('/vitals', async (c) => {
  try {
    const db = c.env.BRAIN_DB;
    const kv = c.env.OPS_KV;

    // Brain stats from D1
    const [totalRes, domainRes, typeRes, connRes, avgRes, insightCountRes, insightRatioRes, topRes] = await Promise.all([
      db.prepare(STATS_QUERIES.totalNodes).first<{ total: number }>(),
      db.prepare(STATS_QUERIES.byDomain).all<{ domain: string; count: number }>(),
      db.prepare(STATS_QUERIES.byType).all<{ type: string; count: number }>(),
      db.prepare(STATS_QUERIES.totalConnections).first<{ total: number }>(),
      db.prepare(STATS_QUERIES.avgConnections).first<{ avg: number }>(),
      db.prepare(`SELECT COUNT(*) as count FROM brain_nodes WHERE is_insight = 1`).first<{ count: number }>(),
      db.prepare(STATS_QUERIES.insightRatio).first<{ ratio: number }>(),
      db.prepare(STATS_QUERIES.mostConnected).all<{ id: string; title: string; connections: number }>(),
    ]);

    // Nodes updated in last 7 days
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const recentRes = await db.prepare(
      `SELECT COUNT(*) as count FROM brain_nodes WHERE updated_at >= ?`,
    ).bind(sevenDaysAgo).first<{ count: number }>();

    // Domain distribution for imbalance analysis
    const byDomain: Record<string, number> = {};
    let minDomain = { name: '', count: Infinity };
    let maxDomain = { name: '', count: 0 };
    for (const row of domainRes.results) {
      byDomain[row.domain] = row.count;
      if (row.count < minDomain.count) minDomain = { name: row.domain, count: row.count };
      if (row.count > maxDomain.count) maxDomain = { name: row.domain, count: row.count };
    }

    const imbalanceRatio = minDomain.count > 0 ? Math.round(maxDomain.count / minDomain.count) : 0;

    // Pattern counts
    const [candidateCount, graduatedCount] = await Promise.all([
      db.prepare(`SELECT COUNT(*) as count FROM brain_patterns WHERE status = 'candidate'`).first<{ count: number }>(),
      db.prepare(`SELECT COUNT(*) as count FROM brain_patterns WHERE status = 'graduated'`).first<{ count: number }>(),
    ]);

    // KV data: session + ops
    const [cycleData, lastSession, sessionsCount] = await Promise.all([
      kv.get<CycleData>('ops:current-cycle', 'json'),
      kv.get('session:last'),
      kv.get('session:count-7d'),
    ]);

    // Skills data from KV (best-effort)
    const skillsData = await kv.get<{ total: number; synced: number; orphaned: number; dormant: number }>('skills:summary', 'json');

    const today = new Date();
    let opsCompletion = 0;
    let daysRemaining = 0;
    if (cycleData) {
      const endsDate = new Date(cycleData.ends + 'T23:59:59Z');
      daysRemaining = Math.max(0, Math.ceil((endsDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)));
      opsCompletion = cycleData.issues.total > 0
        ? Math.round((cycleData.issues.done / cycleData.issues.total) * 100)
        : 0;
    }

    return c.json({
      brain: {
        total_nodes: totalRes?.total ?? 0,
        by_domain: byDomain,
        total_connections: connRes?.total ?? 0,
        avg_connection_density: Math.round((avgRes?.avg ?? 0) * 100) / 100,
        insight_count: insightCountRes?.count ?? 0,
        insight_ratio: Math.round((insightRatioRes?.ratio ?? 0) * 100) / 100,
        nodes_updated_last_7d: recentRes?.count ?? 0,
        most_connected: topRes.results,
        least_covered_domain: minDomain.name,
        domain_imbalance: imbalanceRatio > 1
          ? `${maxDomain.name} has ${imbalanceRatio}x more nodes than ${minDomain.name}`
          : 'balanced',
      },
      skills: skillsData ?? { total: 0, synced: 0, orphaned: 0, dormant: 0 },
      session: {
        last_session: lastSession ?? null,
        surface: 'chat',
        sessions_last_7d: parseInt(sessionsCount ?? '0', 10),
      },
      ops: {
        current_cycle: cycleData?.id ?? 'none',
        completion_pct: opsCompletion,
        days_remaining: daysRemaining,
      },
      patterns: {
        candidates: candidateCount?.count ?? 0,
        graduated: graduatedCount?.count ?? 0,
      },
    });
  } catch (e) {
    return c.json({ error: 'Vitals query failed', details: String(e) }, 500);
  }
});

export { ops };
