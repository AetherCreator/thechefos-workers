import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import app from '../src/index';
import type { VoyageRecord } from '../src/types';

function makeMockKV(initialData: Record<string, string> = {}) {
  const store = new Map<string, string>(Object.entries(initialData));
  return {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    put: vi.fn(async (key: string, value: string, _opts?: unknown) => { store.set(key, value); }),
    delete: vi.fn(async (key: string) => { store.delete(key); }),
    list: vi.fn(async () => ({ keys: [], list_complete: true, cursor: undefined })),
    getWithMetadata: vi.fn(async (key: string) => ({ value: store.get(key) ?? null, metadata: null })),
    __store: store,
  } as unknown as KVNamespace & {
    put: ReturnType<typeof vi.fn>;
    get: ReturnType<typeof vi.fn>;
    __store: Map<string, string>;
  };
}

function makeRecord(overrides: Partial<VoyageRecord> = {}): VoyageRecord {
  return {
    voyage_id: 'voyage-test-001',
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

function makeEnv(voyageStateData: Record<string, string> = {}, idempotencyData: Record<string, string> = {}) {
  return {
    VOYAGE_STATE: makeMockKV(voyageStateData),
    VOYAGE_IDEMPOTENCY: makeMockKV(idempotencyData),
    BRAIN_WRITE_BASE_URL: 'https://thechefos-brain-write.tveg-baking.workers.dev',
    BRAIN_WRITE_API_SECRET: 'test-secret',
  };
}

function mockFetchSuccess() {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
    new Response(JSON.stringify({ audit_id: 'aud-test-123' }), { status: 200 })
  );
}

function mockFetchFailure() {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
    new Response(JSON.stringify({ error: 'not found' }), { status: 500 })
  );
}

function captainHandoff(voyage_id = 'voyage-test-001') {
  return {
    voyage_id,
    current_role: 'captain' as const,
    output_ref: 'hunts/test-hunt/clue-0/captain-brief.md',
    hunt_intent: 'build the orchestrator',
    captain_notes: 'stay focused',
  };
}

function mapmakerHandoff(voyage_id = 'voyage-test-001') {
  return {
    voyage_id,
    current_role: 'mapmaker' as const,
    output_ref: 'hunts/test-hunt/MAP.md',
    charter_ref: 'hunts/test-hunt/CHARTER.md',
    map_ref: 'hunts/test-hunt/MAP.md',
    clue_count: 3,
    exec_tags: ['NARROW', 'SUBSTANTIAL', 'CHAT-OPUS'],
  };
}

function quartermasterHandoff(voyage_id = 'voyage-test-001') {
  return {
    voyage_id,
    current_role: 'quartermaster' as const,
    output_ref: 'hunts/test-hunt/preflight-report.md',
    preflight_passed: true,
    preflight_report_ref: 'hunts/test-hunt/preflight-report.md',
    warnings: [],
    first_clue: 'hunts/test-hunt/clue-1/PROMPT.md',
  };
}

function hunterHandoff(voyage_id = 'voyage-test-001', outcome: 'complete' | 'partial' | 'failed' = 'complete') {
  return {
    voyage_id,
    current_role: 'hunter' as const,
    output_ref: 'hunts/test-hunt/clue-3/COMPLETE.md',
    outcome,
    commits: ['abc123def456'],
    complete_md_refs: ['hunts/test-hunt/clue-3/COMPLETE.md'],
  };
}

async function postHandoff(env: ReturnType<typeof makeEnv>, payload: object) {
  return app.fetch(
    new Request('http://localhost/voyage/handoff', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }),
    env
  );
}

afterEach(() => vi.restoreAllMocks());

describe('POST /voyage/handoff — happy paths', () => {
  it('captain→mapmaker: 200, current_role=mapmaker, 1 history entry', async () => {
    mockFetchSuccess();
    const record = makeRecord({ current_role: 'captain', next_role: 'mapmaker' });
    const env = makeEnv({ 'voyage-test-001': JSON.stringify(record) });

    const res = await postHandoff(env, captainHandoff());
    expect(res.status).toBe(200);

    const body = await res.json() as { voyage_id: string; record: VoyageRecord };
    expect(body.voyage_id).toBe('voyage-test-001');
    expect(body.record.current_role).toBe('mapmaker');
    expect(body.record.next_role).toBe('quartermaster');
    expect(body.record.status).toBe('active');
    expect(body.record.history).toHaveLength(1);
    expect(body.record.history[0].role).toBe('captain');
    expect(body.record.history[0].output_ref).toBe('hunts/test-hunt/clue-0/captain-brief.md');
  });

  it('mapmaker→quartermaster: 200, current_role=quartermaster', async () => {
    mockFetchSuccess();
    const record = makeRecord({ current_role: 'mapmaker', next_role: 'quartermaster' });
    const env = makeEnv({ 'voyage-test-001': JSON.stringify(record) });

    const res = await postHandoff(env, mapmakerHandoff());
    expect(res.status).toBe(200);

    const body = await res.json() as { record: VoyageRecord };
    expect(body.record.current_role).toBe('quartermaster');
    expect(body.record.next_role).toBe('hunter');
    expect(body.record.history).toHaveLength(1);
    expect(body.record.history[0].role).toBe('mapmaker');
  });

  it('quartermaster→hunter: 200, current_role=hunter', async () => {
    mockFetchSuccess();
    const record = makeRecord({ current_role: 'quartermaster', next_role: 'hunter' });
    const env = makeEnv({ 'voyage-test-001': JSON.stringify(record) });

    const res = await postHandoff(env, quartermasterHandoff());
    expect(res.status).toBe(200);

    const body = await res.json() as { record: VoyageRecord };
    expect(body.record.current_role).toBe('hunter');
    expect(body.record.next_role).toBe('closed');
    expect(body.record.history).toHaveLength(1);
  });

  it('hunter→closure with outcome=complete: 200, status=complete, current_role=closed', async () => {
    mockFetchSuccess();
    const record = makeRecord({ current_role: 'hunter', next_role: 'closed' });
    const env = makeEnv({ 'voyage-test-001': JSON.stringify(record) });

    const res = await postHandoff(env, hunterHandoff('voyage-test-001', 'complete'));
    expect(res.status).toBe(200);

    const body = await res.json() as { record: VoyageRecord };
    expect(body.record.current_role).toBe('closed');
    expect(body.record.next_role).toBeNull();
    expect(body.record.status).toBe('complete');
    expect(body.record.history).toHaveLength(1);
    expect(body.record.history[0].role).toBe('hunter');
  });

  it('hunter→closure with outcome=failed: status=failed', async () => {
    mockFetchSuccess();
    const record = makeRecord({ current_role: 'hunter', next_role: 'closed' });
    const env = makeEnv({ 'voyage-test-001': JSON.stringify(record) });

    const res = await postHandoff(env, hunterHandoff('voyage-test-001', 'failed'));
    expect(res.status).toBe(200);

    const body = await res.json() as { record: VoyageRecord };
    expect(body.record.status).toBe('failed');
    expect(body.record.current_role).toBe('closed');
  });
});

describe('POST /voyage/handoff — error paths', () => {
  it('wrong current_role → 409 illegal_transition', async () => {
    mockFetchSuccess();
    const record = makeRecord({ current_role: 'mapmaker', next_role: 'quartermaster' });
    const env = makeEnv({ 'voyage-test-001': JSON.stringify(record) });

    const res = await postHandoff(env, captainHandoff());
    expect(res.status).toBe(409);

    const body = await res.json() as { error: string; expected: string; got: string };
    expect(body.error).toBe('illegal_transition');
    expect(body.expected).toBe('mapmaker');
    expect(body.got).toBe('captain');
  });

  it('missing output_ref → 400 invalid_body', async () => {
    const env = makeEnv();
    const res = await postHandoff(env, {
      voyage_id: 'voyage-test-001',
      current_role: 'captain',
      hunt_intent: 'do stuff',
      // output_ref intentionally omitted
    });
    expect(res.status).toBe(400);

    const body = await res.json() as { error: string; issues: unknown[] };
    expect(body.error).toBe('invalid_body');
    expect(Array.isArray(body.issues)).toBe(true);
  });

  it('voyage_id not in KV → 404', async () => {
    const env = makeEnv(); // empty KV
    const res = await postHandoff(env, captainHandoff('voyage-does-not-exist'));
    expect(res.status).toBe(404);
  });

  it('malformed JSON → 400', async () => {
    const env = makeEnv();
    const res = await app.fetch(
      new Request('http://localhost/voyage/handoff', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{ bad json',
      }),
      env
    );
    expect(res.status).toBe(400);
  });
});

describe('POST /voyage/handoff — idempotency', () => {
  it('same handoff twice: second returns cached, KV.put called exactly once for each KV', async () => {
    mockFetchSuccess();
    const record = makeRecord({ current_role: 'captain', next_role: 'mapmaker' });
    const env = makeEnv({ 'voyage-test-001': JSON.stringify(record) });
    const voyageKV = env.VOYAGE_STATE as ReturnType<typeof makeMockKV>;
    const idemKV = env.VOYAGE_IDEMPOTENCY as ReturnType<typeof makeMockKV>;

    const payload = captainHandoff();

    const res1 = await postHandoff(env, payload);
    expect(res1.status).toBe(200);
    const body1 = await res1.json();

    const res2 = await postHandoff(env, payload);
    expect(res2.status).toBe(200);
    const body2 = await res2.json();

    // Both responses are identical
    expect(JSON.stringify(body1)).toBe(JSON.stringify(body2));

    // VOYAGE_STATE.put called exactly once (not twice)
    expect(voyageKV.put.mock.calls.length).toBe(1);
    // VOYAGE_IDEMPOTENCY.put called exactly once
    expect(idemKV.put.mock.calls.length).toBe(1);
  });
});

describe('POST /voyage/handoff — audit emit failure', () => {
  it('audit fails → 503, VOYAGE_STATE not written', async () => {
    mockFetchFailure();
    const record = makeRecord({ current_role: 'captain', next_role: 'mapmaker' });
    const env = makeEnv({ 'voyage-test-001': JSON.stringify(record) });
    const voyageKV = env.VOYAGE_STATE as ReturnType<typeof makeMockKV>;

    const res = await postHandoff(env, captainHandoff());
    expect(res.status).toBe(503);

    const body = await res.json() as { error: string };
    expect(body.error).toBe('audit_emit_failed');

    // State NOT written on audit failure (atomicity)
    expect(voyageKV.put.mock.calls.length).toBe(0);
  });
});

describe('POST /voyage/start — audit emit retrofit', () => {
  it('start emits audit and succeeds when fetch returns 200', async () => {
    const fetchSpy = mockFetchSuccess();
    const env = makeEnv();

    const res = await app.fetch(
      new Request('http://localhost/voyage/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hunt: 'test-hunt', hunt_intent: 'do stuff' }),
      }),
      env
    );
    expect(res.status).toBe(201);
    // fetch was called once for audit emit
    expect(fetchSpy.mock.calls.length).toBeGreaterThanOrEqual(1);
    const auditCall = fetchSpy.mock.calls.find(
      call => typeof call[0] === 'string' && (call[0] as string).includes('auto-actions')
    );
    expect(auditCall).toBeDefined();
  });

  it('start returns 503 when audit emit fails', async () => {
    mockFetchFailure();
    const env = makeEnv();
    const voyageKV = env.VOYAGE_STATE as ReturnType<typeof makeMockKV>;

    const res = await app.fetch(
      new Request('http://localhost/voyage/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hunt: 'test-hunt', hunt_intent: 'do stuff' }),
      }),
      env
    );
    expect(res.status).toBe(503);
    // VOYAGE_STATE.put not called on audit failure
    expect(voyageKV.put.mock.calls.length).toBe(0);
  });
});

describe('Full 4-step end-to-end voyage', () => {
  it('captain→mapmaker→quartermaster→hunter→closed: 4 history entries, status=complete', async () => {
    mockFetchSuccess();

    // Persistent KV-backed env (store persists across handoffs)
    const voyageKV = makeMockKV();
    const idemKV = makeMockKV();
    const env = {
      VOYAGE_STATE: voyageKV,
      VOYAGE_IDEMPOTENCY: idemKV,
      BRAIN_WRITE_BASE_URL: 'https://thechefos-brain-write.tveg-baking.workers.dev',
      BRAIN_WRITE_API_SECRET: 'test-secret',
    };

    const voyage_id = 'voyage-e2e-001';

    // Seed initial captain record
    const initial = makeRecord({ voyage_id, current_role: 'captain', next_role: 'mapmaker' });
    voyageKV.__store.set(voyage_id, JSON.stringify(initial));

    // Step 1: captain → mapmaker
    let res = await postHandoff(env, { ...captainHandoff(voyage_id), output_ref: 'captain-out.md' });
    expect(res.status).toBe(200);
    let body = await res.json() as { record: VoyageRecord };
    expect(body.record.current_role).toBe('mapmaker');

    // Step 2: mapmaker → quartermaster
    res = await postHandoff(env, { ...mapmakerHandoff(voyage_id), output_ref: 'mapmaker-out.md' });
    expect(res.status).toBe(200);
    body = await res.json() as { record: VoyageRecord };
    expect(body.record.current_role).toBe('quartermaster');

    // Step 3: quartermaster → hunter
    res = await postHandoff(env, { ...quartermasterHandoff(voyage_id), output_ref: 'qm-out.md' });
    expect(res.status).toBe(200);
    body = await res.json() as { record: VoyageRecord };
    expect(body.record.current_role).toBe('hunter');

    // Step 4: hunter → closed
    res = await postHandoff(env, { ...hunterHandoff(voyage_id, 'complete'), output_ref: 'hunter-out.md' });
    expect(res.status).toBe(200);
    body = await res.json() as { record: VoyageRecord };
    expect(body.record.current_role).toBe('closed');
    expect(body.record.status).toBe('complete');
    expect(body.record.history).toHaveLength(4);
    expect(body.record.history.map((h) => h.role)).toEqual(['captain', 'mapmaker', 'quartermaster', 'hunter']);
  });
});
