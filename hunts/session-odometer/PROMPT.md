# Hunt: session-odometer
## Objective
Wire the odometer model into brain-graph Worker so `mileage check N%` auto-computes burn.

## D1 State (already done — do NOT re-run migrations)
- `usage_odometer` table exists with singleton row (current_pct=0)
- `session_usage` table has new columns: `burn_pct REAL`, `baseline_pct REAL`

## Changes Required

### 1. packages/brain-graph/src/schema.ts
Add to `runMigrations` batch:
```ts
db.prepare(`
  CREATE TABLE IF NOT EXISTS usage_odometer (
    id TEXT PRIMARY KEY DEFAULT 'singleton',
    current_pct REAL NOT NULL DEFAULT 0,
    last_updated TEXT NOT NULL,
    last_session_id TEXT,
    last_reset TEXT
  )
`),
db.prepare(`ALTER TABLE session_usage ADD COLUMN IF NOT EXISTS burn_pct REAL`),
db.prepare(`ALTER TABLE session_usage ADD COLUMN IF NOT EXISTS baseline_pct REAL`),
```

### 2. packages/brain-graph/src/index.ts
Add these routes in the Session Usage Tracking section:

#### GET /session/odometer
Returns current odometer state.
```ts
app.get('/session/odometer', async (c) => {
  const row = await c.env.BRAIN_DB
    .prepare('SELECT * FROM usage_odometer WHERE id = ?')
    .bind('singleton')
    .first();
  return c.json(row ?? { id: 'singleton', current_pct: 0 });
});
```

#### POST /session/odometer/reset
Resets odometer to 0 for new weekly window.
```ts
app.post('/session/odometer/reset', async (c) => {
  const now = new Date().toISOString();
  await c.env.BRAIN_DB
    .prepare('UPDATE usage_odometer SET current_pct=0, last_updated=?, last_reset=? WHERE id=?')
    .bind(now, now, 'singleton')
    .run();
  return c.json({ ok: true, reset_at: now });
});
```

#### Update POST /session/usage — odometer integration
Replace the existing insert logic with:
```ts
app.post('/session/usage', async (c) => {
  const db = c.env.BRAIN_DB;
  const body = await c.req.json();

  // validation (keep existing surface/session_type checks)

  // 1. Read odometer baseline
  const odometer = await db
    .prepare('SELECT current_pct FROM usage_odometer WHERE id = ?')
    .bind('singleton')
    .first<{ current_pct: number }>();

  const baseline_pct = odometer?.current_pct ?? 0;
  const usage_pct = body.usage_pct ?? null;
  const burn_pct = usage_pct !== null ? Math.max(0, usage_pct - baseline_pct) : null;

  // Handle reset flag
  if (body.reset) {
    await db.prepare('UPDATE usage_odometer SET current_pct=0, last_updated=?, last_reset=? WHERE id=?')
      .bind(new Date().toISOString(), new Date().toISOString(), 'singleton').run();
  }

  const id = `sess-${body.date}-${Date.now().toString(36)}`;
  const now = new Date().toISOString();

  await db.prepare(
    `INSERT INTO session_usage 
     (id, date, surface, session_type, msg_count, usage_pct, baseline_pct, burn_pct, mcp_count, retry_loops, note, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    id, body.date, body.surface, body.session_type,
    body.msg_count ?? null, usage_pct, baseline_pct, burn_pct,
    body.mcp_count ?? null, body.retry_loops ?? 0, body.note ?? null, now
  ).run();

  // 2. Update odometer to new reading (unless reset)
  if (!body.reset && usage_pct !== null) {
    await db.prepare(
      'UPDATE usage_odometer SET current_pct=?, last_updated=?, last_session_id=? WHERE id=?'
    ).bind(usage_pct, now, id, 'singleton').run();
  }

  // 3. Flags
  const flags: string[] = [];
  if (burn_pct !== null && burn_pct >= 8) flags.push('high-burn — consider fresh context next time');
  if (usage_pct !== null && usage_pct >= 85) flags.push('approaching limit — fresh session strongly recommended');

  return c.json({ ok: true, id, burn_pct, baseline_pct, usage_pct, flags });
});
```

#### Update GET /session/usage/summary — add burn stats
Add to the parallel queries:
```ts
db.prepare(`
  SELECT session_type,
         AVG(burn_pct) as avg_burn,
         MAX(burn_pct) as max_burn,
         SUM(burn_pct) as total_burn
  FROM session_usage
  WHERE burn_pct IS NOT NULL
  GROUP BY session_type
  ORDER BY avg_burn DESC
`).all(),
```
Include result as `burn_by_type` in response.

### 3. packages/router/src/index.ts
Add before the existing session/usage routes:
```ts
app.get('/api/session/odometer', (c) => forward(c.req.raw, c.env.BRAIN_GRAPH, '/api/brain/graph'))
app.post('/api/session/odometer/reset', (c) => forward(c.req.raw, c.env.BRAIN_GRAPH, '/api/brain/graph'))
```

## Pass Condition
```
POST api.thechefos.app/api/session/usage
{ "date":"2026-03-30","surface":"chat","session_type":"mixed","usage_pct":91 }

Response includes:
- burn_pct: number (non-null)
- baseline_pct: number
- flags: array

GET api.thechefos.app/api/session/odometer
→ current_pct updated to 91
```

## Notes
- D1 is already migrated. schema.ts update is for future idempotent re-runs only.
- Burn can't go negative — clamp to 0 (handles reset edge case)
- `body.reset = true` + `usage_pct = 0` = weekly reset flow
- Do NOT break existing session_usage rows that have null burn_pct
