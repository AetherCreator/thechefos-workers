# 🏛️ The Archivist — Clue Caches

Complete execution specs for all 4 CODE clues. Code reads this before starting any clue.

---

## Clue 1 — Temporal Foundation (D1 Schema)

### What to build
Add temporal validity columns to `brain_nodes` in D1.

### New function in `schema.ts`:

```typescript
export async function runTemporalMigration(db: D1Database): Promise<void> {
  const alters = [
    `ALTER TABLE brain_nodes ADD COLUMN valid_from TEXT`,
    `ALTER TABLE brain_nodes ADD COLUMN valid_to TEXT`,
    `ALTER TABLE brain_nodes ADD COLUMN status TEXT DEFAULT 'active'`,
    `ALTER TABLE brain_nodes ADD COLUMN confidence REAL DEFAULT 1.0`,
    `ALTER TABLE brain_nodes ADD COLUMN superseded_by TEXT`,
  ];
  for (const sql of alters) {
    try { await db.prepare(sql).run(); }
    catch (e) { if (!(e as Error).message.includes('duplicate column')) throw e; }
  }
  await db.prepare(
    `UPDATE brain_nodes SET valid_from = created_at, status = 'active' WHERE valid_from IS NULL`
  ).run();
  await db.batch([
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_nodes_status ON brain_nodes(status)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_nodes_valid_from ON brain_nodes(valid_from)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_nodes_confidence ON brain_nodes(confidence)`),
  ]);
}
```

### New endpoints in `index.ts`:

```typescript
// POST /migrate/temporal
app.post('/migrate/temporal', async (c) => {
  try {
    await runTemporalMigration(c.env.BRAIN_DB);
    return c.json({ success: true, message: 'Temporal columns added + backfilled' });
  } catch (e) {
    return c.json({ success: false, error: (e as Error).message }, 500);
  }
});

// POST /node/supersede — mark old node replaced by new
app.post('/node/supersede', async (c) => {
  const { old_id, new_id } = await c.req.json<{ old_id: string; new_id: string }>();
  const now = new Date().toISOString();
  await c.env.BRAIN_DB.prepare(
    `UPDATE brain_nodes SET status = 'superseded', valid_to = ?, superseded_by = ? WHERE id = ?`
  ).bind(now, new_id, old_id).run();
  return c.json({ success: true, superseded: old_id, by: new_id });
});
```

### Update `/query` endpoint in `index.ts`:
- Default: add `AND (status = 'active' OR status IS NULL)` to WHERE clause
- New param `include_superseded=true`: skip status filter
- New param `as_of=YYYY-MM-DD`: add `AND valid_from <= ? AND (valid_to IS NULL OR valid_to >= ?)`
- Update `buildNodeQuery()` in `queries.ts` accordingly

### State machine:
```
active → superseded (via POST /node/supersede, sets valid_to + superseded_by)
active → historical (manual, set valid_to = now via direct update)
```

### Files to modify:
- `packages/brain-graph/src/schema.ts` — add `runTemporalMigration()`
- `packages/brain-graph/src/index.ts` — add endpoints, update query
- `packages/brain-graph/src/queries.ts` — update `buildNodeQuery()` with status/temporal params

### Don't clobber:
- Existing `runMigrations()` — keep it, add new function alongside
- All existing endpoints — extend, don't replace
- Existing data in brain_nodes — migration backfills, doesn't delete

### Done when:
- [ ] POST /migrate/temporal returns 200
- [ ] GET /query returns only active nodes by default
- [ ] GET /query?include_superseded=true returns all
- [ ] GET /query?as_of=2026-01-15 filters temporally
- [ ] POST /node/supersede works
- [ ] All existing endpoints unchanged

---

## Clue 2 — Sharpen the Search (Vectorize Filtering)

### What to build
Add metadata filtering to Vectorize queries in brain-search Worker.

### New helper functions in `packages/brain-search/src/index.ts`:

```typescript
function detectNodeType(content: string): string {
  const lower = content.toLowerCase();
  if (lower.includes('## decision') || lower.includes('decided') || lower.includes('chose')) return 'decision';
  if (lower.includes('## insight') || lower.includes('## connections')) return 'insight';
  if (lower.includes('## pattern') || lower.includes('cross-domain')) return 'pattern';
  if (lower.includes('active-state') || lower.includes('## current')) return 'state';
  if (lower.includes('## log') || lower.includes('session log')) return 'log';
  return 'reference';
}

function computeRecencyTier(path: string, content: string): string {
  const dateMatch = content.match(/Date:\s*(\d{4}-\d{2}-\d{2})/i)
    || content.match(/(\d{4}-\d{2}-\d{2})/);
  if (dateMatch) {
    const daysAgo = (Date.now() - new Date(dateMatch[1]).getTime()) / 86_400_000;
    if (daysAgo <= 30) return 'current';
    if (daysAgo <= 90) return 'recent';
    return 'archive';
  }
  if (path.includes('00-session')) return 'current';
  return 'recent';
}
```

### Update vector metadata in BOTH ingest endpoints:

```typescript
// In /api/brain/ingest and the /api/brain/index loop:
const vector: VectorizeVector = {
  id: pathToVectorId(file.path),
  values: embedding.data[idx],
  metadata: {
    path: file.path,
    domain: domainFromPath(file.path),
    node_type: detectNodeType(content),
    status: 'active',
    recency_tier: computeRecencyTier(file.path, content),
    preview: stripFrontmatter(content).slice(0, 200),
  },
};
```

### Update search to accept filters:

```typescript
app.post('/api/brain/search', async (c) => {
  const body = await c.req.json<{
    query: string; limit?: number;
    domain?: string; node_type?: string; status?: string; recency_tier?: string;
  }>();
  const query = body.query?.trim();
  if (!query) return c.json({ error: 'Missing query' }, 400);

  const filter: Record<string, string> = {};
  if (body.domain) filter.domain = body.domain;
  if (body.node_type) filter.node_type = body.node_type;
  if (body.status) filter.status = body.status;
  if (body.recency_tier) filter.recency_tier = body.recency_tier;

  return await performSearch(c.env, query, Math.min(body.limit ?? 5, 20),
    Object.keys(filter).length > 0 ? filter : undefined);
});
```

### Update `performSearch()`:

```typescript
async function performSearch(
  env: Env, query: string, limit: number,
  filter?: Record<string, string>
): Promise<Response> {
  const embedding = await env.AI.run(EMBEDDING_MODEL, { text: [query] }) as { data: number[][] };
  const queryOpts: VectorizeQueryOptions = { topK: limit, returnMetadata: 'all' };
  if (filter) queryOpts.filter = filter;
  const matches = await env.VECTORIZE.query(embedding.data[0], queryOpts);
  // ... rest unchanged
}
```

### Also update GET variant with query string params:
```typescript
app.get('/api/brain/search', async (c) => {
  // ... existing query param parsing ...
  const filter: Record<string, string> = {};
  if (c.req.query('domain')) filter.domain = c.req.query('domain')!;
  if (c.req.query('node_type')) filter.node_type = c.req.query('node_type')!;
  // ... pass filter to performSearch
});
```

### After deploy: Re-index all nodes
```
POST /api/brain/index?offset=0&limit=20
# repeat with incrementing offset until done=true
```

### Files to modify:
- `packages/brain-search/src/index.ts` — add helpers, update metadata, update search

### Don't clobber:
- `domainFromPath()` — keep it, add new functions alongside
- Existing search logic flow — extend `performSearch()`, don't rewrite

### Done when:
- [ ] Ingest stores new metadata (domain, node_type, status, recency_tier)
- [ ] `{"query": "sourdough", "domain": "chef"}` returns only chef nodes
- [ ] `{"query": "decision", "node_type": "decision"}` returns decision nodes
- [ ] Unfiltered search works exactly as before
- [ ] Full re-index completes

---

## Clue 3 — L1 Essential State Generator

### What to build
New endpoint on brain-graph Worker that auto-generates ~200-token essential state.

### New endpoint in `packages/brain-graph/src/index.ts`:

```typescript
app.get('/l1/generate', async (c) => {
  const db = c.env.BRAIN_DB;
  const token = c.env.GITHUB_TOKEN;

  const nodes = await db.prepare(`
    SELECT *,
      CASE
        WHEN updated_at >= date('now', '-7 days') THEN 1.0
        WHEN updated_at >= date('now', '-30 days') THEN 0.7
        WHEN updated_at >= date('now', '-90 days') THEN 0.4
        ELSE 0.1
      END as recency_weight
    FROM brain_nodes
    WHERE status = 'active' OR status IS NULL
    ORDER BY
      recency_weight DESC,
      connection_count DESC
    LIMIT 30
  `).all<NodeRow & { recency_weight: number }>();

  // Domain-diverse selection (max 4 per domain, 15 total)
  const selected: typeof nodes.results = [];
  const domainCounts: Record<string, number> = {};
  for (const node of nodes.results) {
    if (selected.length >= 15) break;
    const dc = domainCounts[node.domain] || 0;
    if (dc >= 4) continue;
    selected.push(node);
    domainCounts[node.domain] = dc + 1;
  }

  // Format as tight markdown
  const lines = [
    '# L1 Essential State',
    `Generated: ${new Date().toISOString().split('T')[0]}`,
    '',
  ];

  const facts = selected.filter(n => n.type !== 'decision' && n.type !== 'project-state');
  const decisions = selected.filter(n => n.type === 'decision');
  const projects = selected.filter(n => n.type === 'project-state' || n.type === 'state');

  if (facts.length) {
    lines.push('## Active Facts');
    facts.slice(0, 6).forEach(n => lines.push(`- [${n.domain}] ${n.title}`));
    lines.push('');
  }
  if (decisions.length) {
    lines.push('## Recent Decisions');
    decisions.slice(0, 5).forEach(n => lines.push(`- [${n.domain}] ${n.title}`));
    lines.push('');
  }
  if (projects.length) {
    lines.push('## Active Projects');
    projects.slice(0, 4).forEach(n => lines.push(`- ${n.title}`));
    lines.push('');
  }

  const content = lines.join('\n');

  // Push to GitHub
  if (token) {
    try {
      const path = 'brain/00-session/L1-ESSENTIAL.md';
      const existing = await getFileContent(token, 'AetherCreator/SuperClaude', path);
      await putFileContent(token, 'AetherCreator/SuperClaude', path, content,
        existing?.sha || null,
        `chore: regenerate L1 essential state (${new Date().toISOString().split('T')[0]})`);
    } catch (_) { /* log but don't fail */ }
  }

  return c.json({
    content,
    token_estimate: Math.ceil(content.length / 4),
    node_count: selected.length,
    domains: Object.keys(domainCounts),
    generated_at: new Date().toISOString(),
  });
});
```

### Wire to daily cron (update existing scheduled handler):

```typescript
// In the '0 6 * * *' cron block, after cognitive cache:
// Regenerate L1
try {
  // Same logic as /l1/generate but invoked directly
  // ... or call the endpoint internally
} catch (_) { /* don't fail cron on L1 error */ }
```

### Import required:
- `getFileContent` and `putFileContent` from `./cognitive-cache`

### Files to modify:
- `packages/brain-graph/src/index.ts` — add endpoint, update cron

### Don't clobber:
- Cognitive cache system — L1 is separate
- Existing cron logic — extend, don't replace

### Done when:
- [ ] GET /l1/generate returns ≤300 token markdown
- [ ] Domain diversity: no domain > 4 entries
- [ ] File pushed to `brain/00-session/L1-ESSENTIAL.md`
- [ ] Daily cron triggers L1 regen

---

## Clue 4 — The Watchkeeper (Auto-Harvest)

### What to build
n8n workflow that auto-triggers harvest from VPS Claude Code sessions.

### Workflow: "Auto-Harvest Watchkeeper"

**Trigger:** Cron — every 10 minutes

**Step 1: Check for active session**
- HTTP Request node → POST `https://n8n.thechefos.app/webhook/shell`
- Header: `x-shell-key: SuperDuperClaude`
- Body: `{"command": "tmux list-sessions 2>/dev/null | grep -c ':' || echo 0"}`
- IF output = "0" → STOP

**Step 2: Debounce check**
- Code node → read `$workflow.staticData.lastHarvestTs`
- IF less than 30 min since last → STOP

**Step 3: Capture output**
- HTTP Request → POST shell bridge
- Body: `{"command": "tmux capture-pane -t $(tmux list-sessions -F '#{session_name}' | head -1) -p | tail -50"}`

**Step 4: Content hash**
- Code node → MD5 hash of captured text
- Compare to `$workflow.staticData.lastContentHash`
- IF identical → STOP

**Step 5: Trigger harvest**
- HTTP Request → POST `https://n8n.thechefos.app/webhook/harvest`
- Body: `{"source": "auto-watchkeeper", "session_output": <text>, "timestamp": <now>}`

**Step 6: Update state**
- Code node → set `$workflow.staticData.lastHarvestTs` and `lastContentHash`

### Shell Bridge credential: Reuse ID `fi1JEED7AUp7A8O9`

### Anti-spam:
- 30-min debounce between harvests
- Content hash prevents re-harvesting same output
- No-session check prevents firing on idle VPS

### Done when:
- [ ] Workflow runs every 10 min without error
- [ ] Does NOT fire when no tmux session active
- [ ] Does NOT re-harvest identical content
- [ ] Respects 30-min debounce
- [ ] Successfully triggers harvest on new content
