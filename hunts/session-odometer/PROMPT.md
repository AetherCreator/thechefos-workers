# Hunt: session-odometer
## Objective
Wire the passive-inference odometer model into brain-graph Worker.
`mileage check N%` auto-computes session burn and weekly accumulation.
No manual resets ever required for the 5hr window.

## Core Innovation: Passive 5hr Reset
If >= 5 hours have elapsed since the last mileage check, the 5hr window
has rolled over by definition. Baseline = 0. No hooks, no crons, no triggers.
Silence IS the reset signal.

## D1 State (already migrated — do NOT re-run CREATE TABLE)
- `usage_odometer` singleton row exists (current_pct=0)
- `session_usage` has `burn_pct REAL` and `baseline_pct REAL` columns
- Existing rows with NULL burn_pct must not be broken

## Schema Changes

### packages/brain-graph/src/schema.ts
Update usage_odometer in runMigrations to match final shape:
```sql
CREATE TABLE IF NOT EXISTS usage_odometer (
  id TEXT PRIMARY KEY DEFAULT 'singleton',
  -- 5hr session window
  session_current_pct REAL NOT NULL DEFAULT 0,
  session_last_updated TEXT NOT NULL,
  session_last_id TEXT,
  -- weekly accumulation
  weekly_current_pct REAL NOT NULL DEFAULT 0,
  weekly_reset_at TEXT NOT NULL,
  weekly_last_updated TEXT
)
```

Run this migration against live D1 to rename/add columns:
```sql
-- Add new columns to existing odometer row
ALTER TABLE usage_odometer ADD COLUMN session_current_pct REAL DEFAULT 0;
ALTER TABLE usage_odometer ADD COLUMN session_last_updated TEXT;
ALTER TABLE usage_odometer ADD COLUMN session_last_id TEXT;
ALTER TABLE usage_odometer ADD COLUMN weekly_current_pct REAL DEFAULT 0;
ALTER TABLE usage_odometer ADD COLUMN weekly_reset_at TEXT;
ALTER TABLE usage_odometer ADD COLUMN weekly_last_updated TEXT;

-- Seed from existing current_pct
UPDATE usage_odometer
SET
  session_current_pct = current_pct,
  session_last_updated = last_updated,
  weekly_current_pct = 0,
  weekly_reset_at = datetime('now', 'weekday 1', 'start of day')
WHERE id = 'singleton';
```

## New Endpoints — packages/brain-graph/src/index.ts

### GET /session/odometer
Returns current odometer state with auto-reset logic applied.
```ts
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
```

### POST /session/odometer/weekly-reset
Called by Cloudflare Cron or manually. Resets weekly counter.
```ts
app.post('/session/odometer/weekly-reset', async (c) => {
  const now = new Date().toISOString();
  await c.env.BRAIN_DB.prepare(
    'UPDATE usage_odometer SET weekly_current_pct=0, weekly_reset_at=?, weekly_last_updated=? WHERE id=?'
  ).bind(now, now, 'singleton').run();
  return c.json({ ok: true, reset_at: now });
});
```

### Update POST /session/usage — full odometer logic
Replace existing handler with:

```ts
app.post('/session/usage', async (c) => {
  const db = c.env.BRAIN_DB;
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
});
```

### Update GET /session/usage/summary — add burn + weekly stats
Add to parallel queries:
```ts
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
`).all(),

// Current odometer state
db.prepare('SELECT * FROM usage_odometer WHERE id = ?').bind('singleton').first(),
```
Include as `burn_by_type` and `odometer` in response.

## Router Changes — packages/router/src/index.ts
Add before existing session routes:
```ts
app.get('/api/session/odometer', (c) => forward(c.req.raw, c.env.BRAIN_GRAPH, '/api/brain/graph'))
app.post('/api/session/odometer/weekly-reset', (c) => forward(c.req.raw, c.env.BRAIN_GRAPH, '/api/brain/graph'))
```

## Weekly Cron — packages/brain-graph/wrangler.toml
Add cron trigger for weekly reset (Monday 5am UTC):
```toml
[triggers]
crons = ["0 5 * * 1"]
```

Add scheduled handler in index.ts:
```ts
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
```

## Pass Conditions
```
# Test passive reset
POST /api/session/usage { date, surface:"chat", session_type:"planning", usage_pct:65 }
→ if last check was >5hrs ago: window_rolled=true, baseline_pct=0, burn_pct=65
→ if last check was <5hrs ago: window_rolled=false, baseline_pct=previous, burn_pct=delta

# Test weekly accumulation
GET /api/session/odometer
→ weekly.current_pct increases with each session burn
→ session.window_rolled reflects time-gap correctly

# Test cron reset
POST /api/session/odometer/weekly-reset
→ weekly_current_pct = 0
```

## Type Reference
```ts
interface OdometerRow {
  id: string;
  current_pct: number;         // legacy — keep for compat
  last_updated: string;        // legacy — keep for compat
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
```

## Notes
- Legacy `current_pct` + `last_updated` columns stay — backward compat for existing rows
- Burn can never be negative — clamped to 0
- Weekly accumulation is additive burn, not the raw % reading
- No manual reset command needed for session window — ever
- Weekly cron fires Monday 5am UTC — adjust in wrangler.toml if billing cycle differs
