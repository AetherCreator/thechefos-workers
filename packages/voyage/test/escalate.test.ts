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
    voyage_id: 'voyage-esc-001',
    hunt: 'test-hunt',
    hunt_intent: 'build the thing',
    started_at: '2026-05-25T10:00:00.000Z',
    current_role: 'captain',
    next_role: 'mapmaker',
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
    VOYAGE_ABORT_SECRET: 'abort-secret',
  };
}

function mockFetchSuccess() {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
    new Response(JSON.stringify({ audit_id: 'aud-123' }), { status: 200 })
  );
}

afterEach(() => vi.restoreAllMocks());

async function postEscalate(env: ReturnType<typeof makeEnv>, id: string, payload: object) {
  return app.fetch(
    new Request(`http://localhost/voyage/${id}/escalate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }),
    env
  );
}

describe('POST /voyage/:id/escalate', () => {
  it('mode=block: status=blocked, block_reason set', async () => {
    mockFetchSuccess();
    const record = makeRecord();
    const env = makeEnv({ 'voyage-esc-001': JSON.stringify(record) });

    const res = await postEscalate(env, 'voyage-esc-001', { mode: 'block', reason: 'blocked by dependency' });
    expect(res.status).toBe(200);

    const body = await res.json() as { record: VoyageRecord };
    expect(body.record.status).toBe('blocked');
    expect(body.record.block_reason).toBe('blocked by dependency');
  });

  it('mode=fail: status=failed, current_role=closed', async () => {
    mockFetchSuccess();
    const record = makeRecord();
    const env = makeEnv({ 'voyage-esc-001': JSON.stringify(record) });

    const res = await postEscalate(env, 'voyage-esc-001', { mode: 'fail', reason: 'unrecoverable error' });
    expect(res.status).toBe(200);

    const body = await res.json() as { record: VoyageRecord };
    expect(body.record.status).toBe('failed');
    expect(body.record.current_role).toBe('closed');
    expect(body.record.block_reason).toBe('unrecoverable error');
  });

  it('mode=anomaly: status unchanged, anomaly_log appended', async () => {
    mockFetchSuccess();
    const record = makeRecord({ status: 'active' });
    const env = makeEnv({ 'voyage-esc-001': JSON.stringify(record) });

    const res = await postEscalate(env, 'voyage-esc-001', { mode: 'anomaly', reason: 'unexpected output' });
    expect(res.status).toBe(200);

    const body = await res.json() as { record: VoyageRecord };
    expect(body.record.status).toBe('active');
    expect(body.record.anomaly_log).toHaveLength(1);
    expect(body.record.anomaly_log[0].reason).toBe('unexpected output');
    expect(body.record.anomaly_log[0].ts).toBeDefined();
  });

  it('voyage not found → 404', async () => {
    const env = makeEnv();
    const res = await postEscalate(env, 'voyage-does-not-exist', { mode: 'block', reason: 'test' });
    expect(res.status).toBe(404);
  });

  it('audit fail → 503, KV NOT written', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      new Response('{}', { status: 500 })
    );
    const record = makeRecord();
    const env = makeEnv({ 'voyage-esc-001': JSON.stringify(record) });
    const kv = env.VOYAGE_STATE as ReturnType<typeof makeMockKV>;

    const res = await postEscalate(env, 'voyage-esc-001', { mode: 'block', reason: 'test' });
    expect(res.status).toBe(503);
    expect(kv.put.mock.calls.length).toBe(0);
  });
});
