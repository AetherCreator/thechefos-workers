import { describe, it, expect, vi, afterEach } from 'vitest';
import { findStalledVoyages, pingShipsDoctor, STALL_GRACE_MS } from '../src/stall-checker';
import type { VoyageRecord, Env } from '../src/types';

function makeMockKVWithList(initialData: Record<string, string> = {}) {
  const store = new Map<string, string>(Object.entries(initialData));
  return {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    put: vi.fn(async (key: string, value: string) => { store.set(key, value); }),
    delete: vi.fn(async (key: string) => { store.delete(key); }),
    list: vi.fn(async (_opts?: unknown) => ({
      keys: Array.from(store.keys()).map(name => ({ name })),
      list_complete: true,
      cursor: undefined as string | undefined,
    })),
    getWithMetadata: vi.fn(async () => ({ value: null, metadata: null })),
    __store: store,
  } as unknown as KVNamespace;
}

function makeRecord(overrides: Partial<VoyageRecord> = {}): VoyageRecord {
  return {
    voyage_id: 'voyage-stall-001',
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

function makeEnv(kv: KVNamespace): Env {
  return {
    VOYAGE_STATE: kv,
    VOYAGE_IDEMPOTENCY: {} as KVNamespace,
    BRAIN_WRITE_BASE_URL: '',
    BRAIN_WRITE_API_SECRET: '',
    SHIPS_DOCTOR_BOT_TOKEN: 'mytoken',
    TYLER_CHAT_ID: 'tyler-chat-999',
    VOYAGE_ABORT_SECRET: 'abort-secret',
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('STALL_GRACE_MS', () => {
  it('is 15 minutes in milliseconds', () => {
    expect(STALL_GRACE_MS).toBe(15 * 60 * 1000);
  });
});

describe('findStalledVoyages', () => {
  it('returns empty when ETA is in the future', async () => {
    const now = new Date('2026-05-25T12:00:00.000Z');
    const futureETA = new Date(now.getTime() + 30 * 60 * 1000).toISOString();
    const record = makeRecord({ expected_completion_by: futureETA });
    const kv = makeMockKVWithList({ [record.voyage_id]: JSON.stringify(record) });

    const result = await findStalledVoyages(makeEnv(kv), now);
    expect(result).toHaveLength(0);
  });

  it('returns stalled voyage: ETA 20min past grace, active, no prior ping', async () => {
    const now = new Date('2026-05-25T12:00:00.000Z');
    // ETA was 20min ago — past the 15min grace window
    const pastETA = new Date(now.getTime() - 20 * 60 * 1000).toISOString();
    const record = makeRecord({ expected_completion_by: pastETA, last_stall_ping_at: null });
    const kv = makeMockKVWithList({ [record.voyage_id]: JSON.stringify(record) });

    const result = await findStalledVoyages(makeEnv(kv), now);
    expect(result).toHaveLength(1);
    expect(result[0].voyage_id).toBe(record.voyage_id);
  });

  it('skips voyage where last_stall_ping_at >= expected_completion_by (already pinged for this episode)', async () => {
    const now = new Date('2026-05-25T12:00:00.000Z');
    const eta = new Date(now.getTime() - 20 * 60 * 1000).toISOString();
    // Pinged after ETA — means we already handled this stall episode
    const pingAt = new Date(now.getTime() - 5 * 60 * 1000).toISOString();
    const record = makeRecord({ expected_completion_by: eta, last_stall_ping_at: pingAt });
    const kv = makeMockKVWithList({ [record.voyage_id]: JSON.stringify(record) });

    const result = await findStalledVoyages(makeEnv(kv), now);
    expect(result).toHaveLength(0);
  });

  it('skips voyage with status !== active (e.g. blocked)', async () => {
    const now = new Date('2026-05-25T12:00:00.000Z');
    const pastETA = new Date(now.getTime() - 20 * 60 * 1000).toISOString();
    const record = makeRecord({ expected_completion_by: pastETA, status: 'blocked' });
    const kv = makeMockKVWithList({ [record.voyage_id]: JSON.stringify(record) });

    const result = await findStalledVoyages(makeEnv(kv), now);
    expect(result).toHaveLength(0);
  });

  it('skips voyage with null expected_completion_by', async () => {
    const now = new Date('2026-05-25T12:00:00.000Z');
    const record = makeRecord({ expected_completion_by: null });
    const kv = makeMockKVWithList({ [record.voyage_id]: JSON.stringify(record) });

    const result = await findStalledVoyages(makeEnv(kv), now);
    expect(result).toHaveLength(0);
  });
});

describe('pingShipsDoctor', () => {
  it('calls Telegram sendMessage with correct URL and body', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 })
    );

    const record = makeRecord({
      voyage_id: 'voyage-ping-test',
      hunt: 'my-hunt',
      current_role: 'hunter',
      expected_completion_by: '2026-05-25T10:00:00.000Z',
    });

    const kv = makeMockKVWithList();
    const env = makeEnv(kv);

    await pingShipsDoctor(env, record);

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, opts] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toContain(`botmytoken/sendMessage`);
    const body = JSON.parse(opts.body as string);
    expect(body.chat_id).toBe('tyler-chat-999');
    expect(body.text).toContain('voyage-ping-test');
    expect(body.text).toContain('my-hunt');
    expect(body.parse_mode).toBe('Markdown');
  });

  it('throws on non-2xx response from Telegram', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('{"description":"Unauthorized"}', { status: 401 })
    );

    const record = makeRecord();
    const kv = makeMockKVWithList();

    await expect(pingShipsDoctor(makeEnv(kv), record)).rejects.toThrow('401');
  });
});
