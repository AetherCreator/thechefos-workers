import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import {
  healthProbe,
  counterIncrementValid,
  ciRunCheck,
  kvStateCheck,
} from '../../src/guard-layer/verifier'

describe('healthProbe', () => {
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    originalFetch = globalThis.fetch
  })
  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('passes when status matches expected', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response('{"ok":true}', { status: 200 }),
    ) as unknown as typeof fetch
    const r = await healthProbe({
      url: 'https://example.com/health',
      expected_status: 200,
    })
    expect(r.check).toBe('health_probe')
    expect(r.passed).toBe(true)
  })

  it('fails when /health returns 503 (FALSE COMPLETE caught)', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response('service unavailable', { status: 503 }),
    ) as unknown as typeof fetch
    const r = await healthProbe({
      url: 'https://example.com/health',
      expected_status: 200,
    })
    expect(r.passed).toBe(false)
  })

  it('fails when expected_fields are missing from body', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response('{"status":"ok"}', { status: 200 }),
    ) as unknown as typeof fetch
    const r = await healthProbe({
      url: 'https://example.com/health',
      expected_status: 200,
      expected_fields: ['status', 'version'],
    })
    expect(r.passed).toBe(false)
  })

  it('fails when url is missing (caller bug)', async () => {
    const r = await healthProbe({})
    expect(r.passed).toBe(false)
    expect(r.detail).toContain('url param required')
  })
})

describe('counterIncrementValid', () => {
  it('passes when arithmetic holds (prior + delta = new)', async () => {
    const r = await counterIncrementValid({
      expected_prior: 245,
      delta: 10,
      expected_new: 255,
    })
    expect(r.passed).toBe(true)
  })

  it('fails on bad arithmetic (catches lost-update races)', async () => {
    const r = await counterIncrementValid({
      expected_prior: 245,
      delta: 10,
      expected_new: 256, // off by one
    })
    expect(r.passed).toBe(false)
  })

  it('fails when actual_new diverges from expected_new', async () => {
    const r = await counterIncrementValid({
      expected_prior: 100,
      delta: 5,
      expected_new: 105,
      actual_new: 104, // race: someone else decremented
    })
    expect(r.passed).toBe(false)
  })

  it('fails on missing numeric params', async () => {
    const r = await counterIncrementValid({ expected_prior: 1 })
    expect(r.passed).toBe(false)
  })
})

describe('ciRunCheck', () => {
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    originalFetch = globalThis.fetch
  })
  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('passes when all runs are completed + success', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          workflow_runs: [
            { name: 'test', status: 'completed', conclusion: 'success' },
            { name: 'lint', status: 'completed', conclusion: 'success' },
          ],
        }),
        { status: 200 },
      ),
    ) as unknown as typeof fetch
    const r = await ciRunCheck({}, { repo: 'foo/bar', commit_sha: 'abc123' })
    expect(r.passed).toBe(true)
  })

  it('fails when a workflow has failed', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          workflow_runs: [
            { name: 'test', status: 'completed', conclusion: 'failure' },
          ],
        }),
        { status: 200 },
      ),
    ) as unknown as typeof fetch
    const r = await ciRunCheck({}, { repo: 'foo/bar', commit_sha: 'abc123' })
    expect(r.passed).toBe(false)
  })

  it('treats zero workflow runs as n/a (non-blocking)', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ workflow_runs: [] }), { status: 200 }),
    ) as unknown as typeof fetch
    const r = await ciRunCheck({}, { repo: 'foo/bar', commit_sha: 'abc123' })
    expect(r.passed).toBe(true)
    expect(r.detail).toContain('n/a')
  })
})

describe('kvStateCheck', () => {
  it('passes for exists predicate when key has value', async () => {
    const kv = {
      get: vi.fn().mockResolvedValue('{"hello":"world"}'),
    } as unknown as KVNamespace
    const env = { IDEMPOTENCY_KEYS: kv }
    const r = await kvStateCheck(env, {
      namespace: 'IDEMPOTENCY_KEYS',
      key: 'some-key',
      predicate: 'exists',
    })
    expect(r.passed).toBe(true)
  })

  it('fails for exists predicate when key is missing', async () => {
    const kv = {
      get: vi.fn().mockResolvedValue(null),
    } as unknown as KVNamespace
    const env = { IDEMPOTENCY_KEYS: kv }
    const r = await kvStateCheck(env, {
      key: 'missing',
      predicate: 'exists',
    })
    expect(r.passed).toBe(false)
  })

  it('fails when namespace binding is missing', async () => {
    const r = await kvStateCheck({} as any, {
      namespace: 'NOPE',
      key: 'x',
      predicate: 'exists',
    })
    expect(r.passed).toBe(false)
  })
})
