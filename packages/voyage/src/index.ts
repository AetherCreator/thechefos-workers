import { Hono } from 'hono';
import { VoyageStartRequestSchema } from './schemas';
import type { Env, VoyageRecord } from './types';

const app = new Hono<{ Bindings: Env }>();

app.onError((err, c) => {
  return c.json({ error: 'internal', message: err.message }, 500);
});

app.get('/health', (c) => {
  return c.json({
    ok: true,
    worker: 'voyage',
    version: '0.1.0',
    kv_bindings: ['VOYAGE_STATE', 'VOYAGE_IDEMPOTENCY'],
  });
});

app.post('/voyage/start', async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'invalid_body', issues: [{ message: 'invalid JSON' }] }, 400);
  }

  const parsed = VoyageStartRequestSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'invalid_body', issues: parsed.error.issues }, 400);
  }

  const now = new Date().toISOString();
  const isoCompact = now.replace(/[-:]/g, '').replace(/\.\d+/, '').slice(0, 15) + 'Z';
  const slug = (s: string) =>
    s.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').slice(0, 40);
  const voyage_id = `voyage-${isoCompact}-${slug(parsed.data.hunt)}`;

  const record: VoyageRecord = {
    voyage_id,
    hunt: parsed.data.hunt,
    hunt_intent: parsed.data.hunt_intent,
    started_at: now,
    current_role: 'captain',
    next_role: 'mapmaker',
    status: 'active',
    history: [],
    expected_completion_by: parsed.data.expected_completion_by ?? null,
    last_stall_ping_at: null,
    block_reason: null,
    anomaly_log: [],
    scope_constraints: parsed.data.scope_constraints,
  };

  await c.env.VOYAGE_STATE.put(voyage_id, JSON.stringify(record));

  return c.json({ voyage_id, record }, 201);
});

app.get('/voyage/:id', async (c) => {
  const raw = await c.env.VOYAGE_STATE.get(c.req.param('id'));
  if (!raw) return c.json({ error: 'not_found' }, 404);
  return c.json({ voyage_id: c.req.param('id'), record: JSON.parse(raw) }, 200);
});

app.all('*', (c) => c.json({ error: 'not_found' }, 404));

export default app;
