import { describe, it, expect, vi, beforeEach } from 'vitest';
import app from '../src/index';

function makeMockKV(initialData: Record<string, string> = {}) {
  const store = new Map<string, string>(Object.entries(initialData));
  return {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    put: vi.fn(async (key: string, value: string) => { store.set(key, value); }),
    delete: vi.fn(async (key: string) => { store.delete(key); }),
    list: vi.fn(async () => ({ keys: [], list_complete: true, cursor: undefined })),
    getWithMetadata: vi.fn(async (key: string) => ({ value: store.get(key) ?? null, metadata: null })),
    __store: store,
  } as unknown as KVNamespace & { put: ReturnType<typeof vi.fn>; get: ReturnType<typeof vi.fn>; __store: Map<string, string> };
}

function makeEnv(voyageStateData: Record<string, string> = {}) {
  return {
    VOYAGE_STATE: makeMockKV(voyageStateData),
    VOYAGE_IDEMPOTENCY: makeMockKV(),
  };
}

describe('GET /health', () => {
  it('returns 200 with correct contract', async () => {
    const env = makeEnv();
    const res = await app.fetch(new Request('http://localhost/health'), env);
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.ok).toBe(true);
    expect(body.worker).toBe('voyage');
    expect(body.version).toBe('0.1.0');
    expect(body.kv_bindings).toEqual(['VOYAGE_STATE', 'VOYAGE_IDEMPOTENCY']);
  });
});

describe('POST /voyage/start', () => {
  it('valid body → 201, voyage_id matches format, KV.put called with correct key', async () => {
    const env = makeEnv();
    const res = await app.fetch(
      new Request('http://localhost/voyage/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hunt: 'my-hunt', hunt_intent: 'do the thing' }),
      }),
      env
    );
    expect(res.status).toBe(201);
    const body = await res.json() as { voyage_id: string; record: unknown };
    expect(body.voyage_id).toMatch(/^voyage-\d{8}T\d{6}Z-[a-z0-9-]+$/);
    const putCalls = (env.VOYAGE_STATE as ReturnType<typeof makeMockKV>).put.mock.calls;
    expect(putCalls.length).toBe(1);
    expect(putCalls[0][0]).toBe(body.voyage_id);
  });

  it('missing hunt_intent → 400 invalid_body', async () => {
    const env = makeEnv();
    const res = await app.fetch(
      new Request('http://localhost/voyage/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hunt: 'my-hunt' }),
      }),
      env
    );
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string; issues: unknown[] };
    expect(body.error).toBe('invalid_body');
    expect(Array.isArray(body.issues)).toBe(true);
  });

  it('malformed JSON → 400', async () => {
    const env = makeEnv();
    const res = await app.fetch(
      new Request('http://localhost/voyage/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'not { valid json',
      }),
      env
    );
    expect(res.status).toBe(400);
  });

  it('initial record has correct shape (captain, active, empty history)', async () => {
    const env = makeEnv();
    const res = await app.fetch(
      new Request('http://localhost/voyage/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hunt: 'voyage-worker', hunt_intent: 'build the orchestrator' }),
      }),
      env
    );
    expect(res.status).toBe(201);
    const body = await res.json() as { voyage_id: string; record: Record<string, unknown> };
    expect(body.record.current_role).toBe('captain');
    expect(body.record.next_role).toBe('mapmaker');
    expect(body.record.status).toBe('active');
    expect(body.record.history).toEqual([]);
    expect(body.record.hunt).toBe('voyage-worker');
  });
});

describe('GET /voyage/:id', () => {
  it('existing voyage → 200 with record', async () => {
    const storedRecord = { voyage_id: 'voyage-test', hunt: 'foo', status: 'active' };
    const env = makeEnv({ 'voyage-test': JSON.stringify(storedRecord) });
    const res = await app.fetch(
      new Request('http://localhost/voyage/voyage-test'),
      env
    );
    expect(res.status).toBe(200);
    const body = await res.json() as { voyage_id: string; record: Record<string, unknown> };
    expect(body.voyage_id).toBe('voyage-test');
    expect(body.record.hunt).toBe('foo');
  });

  it('nonexistent voyage → 404 not_found', async () => {
    const env = makeEnv();
    const res = await app.fetch(
      new Request('http://localhost/voyage/does-not-exist'),
      env
    );
    expect(res.status).toBe(404);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('not_found');
  });
});

describe('catch-all', () => {
  it('unknown route → 404', async () => {
    const env = makeEnv();
    const res = await app.fetch(new Request('http://localhost/unknown'), env);
    expect(res.status).toBe(404);
  });
});
