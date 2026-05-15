import { describe, it, expect, vi } from 'vitest'
import {
  checkIdempotency,
  incrementFireCount,
  recordIdempotencyResult,
  type StoredIdempotency,
} from '../../src/guard-layer/idempotency'
import type { GuardLayerEvidence } from '../../src/guard-layer/types'

function makeMockKV(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial))
  return {
    get: vi.fn(async (key: string, type?: string) => {
      const v = store.get(key) ?? null
      if (v === null) return null
      if (type === 'json') return JSON.parse(v)
      return v
    }),
    put: vi.fn(async (key: string, value: string, _opts?: unknown) => {
      store.set(key, value)
    }),
    delete: vi.fn(async (key: string) => {
      store.delete(key)
    }),
    list: vi.fn(),
    __store: store,
  } as unknown as KVNamespace & { __store: Map<string, string> }
}

function dummyEvidence(action_id: string): GuardLayerEvidence {
  return {
    schema_version: '1.0',
    action_id,
    ts: '2026-05-16T00:00:00Z',
    actor: 'ops-board-agent',
    intent: 'ops_board_promote',
    trigger: { type: 'github_webhook', details: {} },
    action: {
      type: 'ops_board_promote',
      target: 'OPS-ABC',
      params: { from: 'ACTIVE', to: 'COMPLETED' },
    },
    verification: [],
    verifier_outcome: 'passed',
    idempotency_key: 'abc',
    first_seen_ts: '2026-05-16T00:00:00Z',
    fire_count: 1,
    reversible: true,
    reversible_via: null,
    outcome: 'applied',
    outcome_detail: 'ok',
    notified: [],
  }
}

describe('idempotency', () => {
  it('detects first_fire when key is absent', async () => {
    const kv = makeMockKV()
    const r = await checkIdempotency({ IDEMPOTENCY_KEYS: kv }, 'k1')
    expect(r.first_fire).toBe(true)
  })

  it('detects replay when key is present', async () => {
    const cached: StoredIdempotency = {
      action_id: 'auto-1',
      evidence: dummyEvidence('auto-1'),
      fire_count: 1,
    }
    const kv = makeMockKV({ k1: JSON.stringify(cached) })
    const r = await checkIdempotency({ IDEMPOTENCY_KEYS: kv }, 'k1')
    expect(r.first_fire).toBe(false)
    if (!r.first_fire) {
      expect(r.cached.action_id).toBe('auto-1')
    }
  })

  it('record + check roundtrips', async () => {
    const kv = makeMockKV()
    const env = { IDEMPOTENCY_KEYS: kv }
    await recordIdempotencyResult(env, 'k2', dummyEvidence('auto-2'))
    const r = await checkIdempotency(env, 'k2')
    expect(r.first_fire).toBe(false)
    if (!r.first_fire) {
      expect(r.cached.fire_count).toBe(1)
    }
  })

  it('increments fire_count on replay', async () => {
    const kv = makeMockKV()
    const env = { IDEMPOTENCY_KEYS: kv }
    await recordIdempotencyResult(env, 'k3', dummyEvidence('auto-3'))
    const first = await checkIdempotency(env, 'k3')
    if (first.first_fire) throw new Error('expected cached')
    const updated = await incrementFireCount(env, 'k3', first.cached)
    expect(updated.fire_count).toBe(2)
    const second = await checkIdempotency(env, 'k3')
    if (second.first_fire) throw new Error('expected cached')
    expect(second.cached.fire_count).toBe(2)
  })

  it('preserves evidence across replays', async () => {
    const kv = makeMockKV()
    const env = { IDEMPOTENCY_KEYS: kv }
    const original = dummyEvidence('auto-4')
    await recordIdempotencyResult(env, 'k4', original)
    const r = await checkIdempotency(env, 'k4')
    if (r.first_fire) throw new Error('expected cached')
    expect(r.cached.evidence.action_id).toBe('auto-4')
    expect(r.cached.evidence.outcome).toBe('applied')
  })
})
