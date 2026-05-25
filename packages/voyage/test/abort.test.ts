import { describe, it, expect, vi, afterEach } from 'vitest';
import app from '../src/index';
import type { VoyageRecord } from '../src/types';

function makeMockKV(initialData: Record<string, string> = {}) {
  const store = new Map<string, string>(Object.entries(initialData));
  return {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    put: vi.fn(async (key: string, value: string) => { store.set(key, value); }),
    delete: vi.fn(async (key: string) => { store.delete(key); }),
    list: vi.fn(async () => ({ keys: [], list_complete: true })),
    getWithMetadata: vi.fn(async () => ({ value: null, metadata: null })),
    __store: store,
  } as unknown as KVNamespace & { put: ReturnType<typeof vi.fn>; __store: Map<string, string> };
}

function makeRecord(overrides: Partial<VoyageRecord> = {}): VoyageRecord {
  return {
    voyage_id: 'voyage-abort-001',
    hunt: 'test-hunt',
    hunt_intent: 'build the thing',
    started_at: '2026-05-25T10:00:00.000Z',
    current_role: 'hunter',
    next_role: 'closed',
    status: 'active',
    history: [],
    expected_completion_by: null,
    last_stall_ping_at: null,
    block_reason: null,
    anomaly_log: [],
    ...overrides,
  };
}

function makeEnv(voyageStateData: Record<string, string> = {}) {
  return {
    VOYAGE_STATE: makeMockKV(voyageStateData),
    VOYAGE_IDEMPOTENCY: makeMockKV(),
    BRAIN_WRITE_BASE_URL: 'https://thechefos-brain-write.tveg-baking.workers.dev',
    BRAIN_WRITE_API_SECRET: 'test-secret',
    SHIPS_DOCTOR_BOT_TOKEN: 'test-token',
    TYLER_CHAT_ID: 'test-chat-id',
    VOYAGE_ABORT_SECRET: 'correct-abort-secret',
  };
}

function mockFetchSuccess() {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
    new Response(JSON.stringify({ audit_id: 'aud-123' }), { status: 200 })
  );
}

afterEach(() => vi.restoreAllMocks());

async function postAbort(
  env: ReturnType<typeof makeEnv>,
  id: string,
  payload: object,
  secret?: string
) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (secret !== undefined) headers['X-Voyage-Abort-Secret'] = secret;
  return app.fetch(
    new Request(`http://localhost/voyage/${id}/abort`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    }),
    env
  );
}

describe('POST /voyage/:id/abort', () => {
  it('wrong secret → 401, KV NOT written', async () => {
    const record = makeRecord();
    const env = makeEnv({ 'voyage-abort-001': JSON.stringify(record) });
    const kv = env.VOYAGE_STATE as ReturnType<typeof makeMockKV>;

    const res = await postAbort(env, 'voyage-abort-001', { reason: 'test abort' }, 'wrong-secret');
    expect(res.status).toBe(401);

    const body = await res.json() as { error: string };
    expect(body.error).toBe('unauthorized');
    expect(kv.put.mock.calls.length).toBe(0);
  });

  it('missing secret header → 401, KV NOT written', async () => {
    const record = makeRecord();
    const env = makeEnv({ 'voyage-abort-001': JSON.stringify(record) });
    const kv = env.VOYAGE_STATE as ReturnType<typeof makeMockKV>;

    const res = await postAbort(env, 'voyage-abort-001', { reason: 'test' });
    expect(res.status).toBe(401);
    expect(kv.put.mock.calls.length).toBe(0);
  });

  it('correct secret → 200, status=aborted, current_role=closed, audit fired', async () => {
    const fetchSpy = mockFetchSuccess();
    const record = makeRecord();
    const env = makeEnv({ 'voyage-abort-001': JSON.stringify(record) });

    const res = await postAbort(env, 'voyage-abort-001', { reason: 'tyler aborted it' }, 'correct-abort-secret');
    expect(res.status).toBe(200);

    const body = await res.json() as { voyage_id: string; record: VoyageRecord };
    expect(body.record.status).toBe('aborted');
    expect(body.record.current_role).toBe('closed');
    expect(body.record.block_reason).toContain('aborted');
    expect(body.record.block_reason).toContain('tyler aborted it');

    const auditCall = fetchSpy.mock.calls.find(
      call => typeof call[0] === 'string' && (call[0] as string).includes('auto-actions')
    );
    expect(auditCall).toBeDefined();
  });

  it('voyage not found → 404', async () => {
    const env = makeEnv();
    const res = await postAbort(env, 'voyage-does-not-exist', { reason: 'test' }, 'correct-abort-secret');
    expect(res.status).toBe(404);
  });
});
