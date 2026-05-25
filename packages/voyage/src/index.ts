import { Hono } from 'hono';
import { z } from 'zod';
import { VoyageStartRequestSchema, HandoffPayloadSchema } from './schemas';
import type { Env, VoyageRecord } from './types';
import { advanceRole, IllegalTransitionError } from './state-machine';
import { computeIdempotencyKey } from './idempotency';
import { emitAudit } from './audit-emit';
import { findStalledVoyages, pingShipsDoctor } from './stall-checker';

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

  const auditResult = await emitAudit(c.env, 'voyage_state_advance', voyage_id, record);
  if (!auditResult.ok) {
    // Soft-degrade: audit emit failure does NOT block state mutation.
    // CF subrequest routing returned 404 in C5 testing despite route being live;
    // tracked under OPS-VOYAGE-AUDIT-EMIT-CF-SUBREQUEST-404. Audit trail gap is
    // recoverable via backfill from VOYAGE_STATE history. State integrity wins.
    console.warn('audit_emit_degraded', { detail: auditResult.error });
  }

  await c.env.VOYAGE_STATE.put(voyage_id, JSON.stringify(record));

  return c.json({ voyage_id, record }, 201);
});

app.get('/voyage/:id', async (c) => {
  const raw = await c.env.VOYAGE_STATE.get(c.req.param('id'));
  if (!raw) return c.json({ error: 'not_found' }, 404);
  return c.json({ voyage_id: c.req.param('id'), record: JSON.parse(raw) }, 200);
});

app.post('/voyage/handoff', async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'invalid_body', issues: [{ message: 'invalid JSON' }] }, 400);
  }

  const parsed = HandoffPayloadSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'invalid_body', issues: parsed.error.issues }, 400);
  }

  const payload = parsed.data;
  const raw = await c.env.VOYAGE_STATE.get(payload.voyage_id);
  if (!raw) return c.json({ error: 'not_found' }, 404);

  const record: VoyageRecord = JSON.parse(raw);

  const idempotencyKey = await computeIdempotencyKey(payload.voyage_id, payload.current_role, payload.output_ref);
  const cached = await c.env.VOYAGE_IDEMPOTENCY.get(idempotencyKey);
  if (cached) {
    return c.json(JSON.parse(cached), 200);
  }

  let updated: VoyageRecord;
  try {
    updated = advanceRole(record, payload);
  } catch (e) {
    if (e instanceof IllegalTransitionError) {
      return c.json({ error: 'illegal_transition', expected: e.expected, got: e.got }, 409);
    }
    throw e;
  }

  const auditResult = await emitAudit(c.env, 'voyage_state_advance', payload.voyage_id, {
    from_role: payload.current_role,
    to_role: updated.current_role,
    output_ref: payload.output_ref,
  });
  if (!auditResult.ok) {
    // Soft-degrade: audit emit failure does NOT block state mutation.
    // CF subrequest routing returned 404 in C5 testing despite route being live;
    // tracked under OPS-VOYAGE-AUDIT-EMIT-CF-SUBREQUEST-404. Audit trail gap is
    // recoverable via backfill from VOYAGE_STATE history. State integrity wins.
    console.warn('audit_emit_degraded', { detail: auditResult.error });
  }

  await c.env.VOYAGE_STATE.put(payload.voyage_id, JSON.stringify(updated));
  const responseBody = { voyage_id: payload.voyage_id, record: updated };
  await c.env.VOYAGE_IDEMPOTENCY.put(idempotencyKey, JSON.stringify(responseBody), {
    expirationTtl: 604800,
  });

  return c.json(responseBody, 200);
});

const EscalateSchema = z.object({
  mode: z.enum(['block', 'fail', 'anomaly']),
  reason: z.string().min(1),
});

app.post('/voyage/:id/escalate', async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'invalid_body', issues: [{ message: 'invalid JSON' }] }, 400);
  }

  const parsed = EscalateSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'invalid_body', issues: parsed.error.issues }, 400);
  }

  const { mode, reason } = parsed.data;
  const id = c.req.param('id');
  const raw = await c.env.VOYAGE_STATE.get(id);
  if (!raw) return c.json({ error: 'not_found' }, 404);

  const record: VoyageRecord = JSON.parse(raw);
  const now = new Date().toISOString();

  if (mode === 'block') {
    record.status = 'blocked';
    record.block_reason = reason;
  } else if (mode === 'fail') {
    record.status = 'failed';
    record.current_role = 'closed';
    record.block_reason = reason;
  } else {
    record.anomaly_log.push({ ts: now, reason });
  }

  const auditResult = await emitAudit(c.env, 'voyage_state_advance', id, { escalate: mode, reason });
  if (!auditResult.ok) {
    // Soft-degrade: audit emit failure does NOT block state mutation.
    // CF subrequest routing returned 404 in C5 testing despite route being live;
    // tracked under OPS-VOYAGE-AUDIT-EMIT-CF-SUBREQUEST-404. Audit trail gap is
    // recoverable via backfill from VOYAGE_STATE history. State integrity wins.
    console.warn('audit_emit_degraded', { detail: auditResult.error });
  }

  await c.env.VOYAGE_STATE.put(id, JSON.stringify(record));
  return c.json({ voyage_id: id, record }, 200);
});

const AbortSchema = z.object({ reason: z.string().min(1) });

app.post('/voyage/:id/abort', async (c) => {
  if (c.req.header('X-Voyage-Abort-Secret') !== c.env.VOYAGE_ABORT_SECRET) {
    return c.json({ error: 'unauthorized' }, 401);
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'invalid_body', issues: [{ message: 'invalid JSON' }] }, 400);
  }

  const parsed = AbortSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'invalid_body', issues: parsed.error.issues }, 400);
  }

  const id = c.req.param('id');
  const raw = await c.env.VOYAGE_STATE.get(id);
  if (!raw) return c.json({ error: 'not_found' }, 404);

  const record: VoyageRecord = JSON.parse(raw);
  record.status = 'aborted';
  record.current_role = 'closed';
  record.block_reason = 'aborted: ' + parsed.data.reason;

  const auditResult = await emitAudit(c.env, 'voyage_abort', id, { reason: parsed.data.reason });
  if (!auditResult.ok) {
    // Soft-degrade: audit emit failure does NOT block state mutation.
    // CF subrequest routing returned 404 in C5 testing despite route being live;
    // tracked under OPS-VOYAGE-AUDIT-EMIT-CF-SUBREQUEST-404. Audit trail gap is
    // recoverable via backfill from VOYAGE_STATE history. State integrity wins.
    console.warn('audit_emit_degraded', { detail: auditResult.error });
  }

  await c.env.VOYAGE_STATE.put(id, JSON.stringify(record));
  return c.json({ voyage_id: id, record }, 200);
});

app.all('*', (c) => c.json({ error: 'not_found' }, 404));

export default {
  fetch: app.fetch,
  scheduled: async (event: ScheduledEvent, env: Env, ctx: ExecutionContext) => {
    if (event.cron === '*/15 * * * *') {
      ctx.waitUntil((async () => {
        const now = new Date();
        const stalled = await findStalledVoyages(env, now);
        for (const voyage of stalled) {
          const updated = { ...voyage, last_stall_ping_at: now.toISOString() };
          await env.VOYAGE_STATE.put(voyage.voyage_id, JSON.stringify(updated));
          await pingShipsDoctor(env, voyage);
        }
      })());
    }
  },
};
