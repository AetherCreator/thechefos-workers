import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { guardLayer, type GuardLayerEnv } from '../../src/guard-layer'

function makeMockKV() {
  const store = new Map<string, string>()
  return {
    get: vi.fn(async (key: string, type?: string) => {
      const v = store.get(key) ?? null
      if (v === null) return null
      if (type === 'json') return JSON.parse(v)
      return v
    }),
    put: vi.fn(async (key: string, value: string) => {
      store.set(key, value)
    }),
    delete: vi.fn(async (key: string) => {
      store.delete(key)
    }),
    list: vi.fn(),
    __store: store,
  } as unknown as KVNamespace & { __store: Map<string, string> }
}

function makeEnv(overrides: Partial<GuardLayerEnv> = {}): GuardLayerEnv {
  return {
    IDEMPOTENCY_KEYS: makeMockKV(),
    GITHUB_TOKEN: 'fake-token-not-used-when-fetch-is-mocked',
    ...overrides,
  } as GuardLayerEnv
}

const baseRequest = {
  actor: 'ops-board-agent' as const,
  intent: 'ops_board_promote' as const,
  trigger: {
    type: 'github_webhook' as const,
    details: {
      event: 'push',
      commit: 'abc123',
      file_path: 'hunts/test/clue-1/COMPLETE.md',
    },
  },
  action: {
    type: 'ops_board_promote' as const,
    target: 'OPS-ABC',
    params: { from: 'ACTIVE', to: 'COMPLETED' },
  },
}

describe('guardLayer orchestrator', () => {
  let originalFetch: typeof globalThis.fetch
  beforeEach(() => {
    originalFetch = globalThis.fetch
  })
  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('happy path: verifiers pass → action executes → evidence written', async () => {
    // Mock GitHub Contents API (evidence write) + health probe + ci runs.
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url.includes('/health')) {
        return new Response('{"ok":true}', { status: 200 })
      }
      if (url.includes('/actions/runs')) {
        return new Response(
          JSON.stringify({
            workflow_runs: [
              { name: 'test', status: 'completed', conclusion: 'success' },
            ],
          }),
          { status: 200 },
        )
      }
      if (url.includes('/contents/brain/06-meta/auto-actions/')) {
        return new Response(JSON.stringify({ commit: { sha: 'deadbeef' } }), {
          status: 201,
        })
      }
      return new Response('not mocked', { status: 500 })
    }) as unknown as typeof fetch

    const env = makeEnv()
    const executeAction = vi.fn().mockResolvedValue({
      detail: 'OPS-ABC promoted',
      reversible_via: {
        command: 'ops_board_reopen',
        params: { id: 'OPS-ABC' },
        estimated_difficulty: 'trivial' as const,
        requires_confirmation: false,
      },
    })

    const res = await guardLayer(env, {
      ...baseRequest,
      verifierParams: {
        url: 'https://brain-write.example/health',
        expected_status: 200,
        repo: 'AetherCreator/SuperClaude',
        commit_sha: 'abc123',
      },
      executeAction,
    })

    expect(res.outcome).toBe('applied')
    expect(executeAction).toHaveBeenCalledOnce()
    expect(res.evidence.verifier_outcome).toBe('passed')
    expect(res.evidence.reversible).toBe(true)
    expect(res.evidence.action_id).toMatch(/^auto-\d{8}T\d{6}Z-ops-ops-abc$/)
  })

  it('verifier blocks: /health returns 503 → action NOT executed', async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url.includes('/health')) {
        return new Response('service unavailable', { status: 503 })
      }
      if (url.includes('/contents/brain/06-meta/auto-actions/')) {
        return new Response(JSON.stringify({ commit: { sha: 'audit01' } }), {
          status: 201,
        })
      }
      // ci_run_check should never be reached (short-circuit on health fail)
      return new Response('not mocked', { status: 500 })
    }) as unknown as typeof fetch

    const env = makeEnv()
    const executeAction = vi.fn()

    const res = await guardLayer(env, {
      ...baseRequest,
      verifierParams: {
        url: 'https://brain-write.example/health',
        expected_status: 200,
        repo: 'AetherCreator/SuperClaude',
        commit_sha: 'abc123',
      },
      executeAction,
    })

    expect(res.outcome).toBe('blocked_verifier')
    expect(executeAction).not.toHaveBeenCalled()
    expect(res.evidence.verifier_outcome).toBe('failed')
    expect(res.evidence.verification[0].check).toBe('health_probe')
    expect(res.evidence.verification[0].passed).toBe(false)
  })

  it('idempotency: second fire returns noop_duplicate, action NOT re-executed', async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url.includes('/health')) {
        return new Response('{"ok":true}', { status: 200 })
      }
      if (url.includes('/actions/runs')) {
        return new Response(
          JSON.stringify({
            workflow_runs: [
              { name: 'test', status: 'completed', conclusion: 'success' },
            ],
          }),
          { status: 200 },
        )
      }
      if (url.includes('/contents/brain/06-meta/auto-actions/')) {
        return new Response(JSON.stringify({ commit: { sha: 'fff' } }), {
          status: 201,
        })
      }
      return new Response('not mocked', { status: 500 })
    }) as unknown as typeof fetch

    const env = makeEnv()
    const executeAction = vi.fn().mockResolvedValue({
      detail: 'OPS-ABC promoted',
      reversible_via: null,
    })

    const req = {
      ...baseRequest,
      verifierParams: {
        url: 'https://brain-write.example/health',
        expected_status: 200,
        repo: 'AetherCreator/SuperClaude',
        commit_sha: 'abc123',
      },
      executeAction,
    }

    const first = await guardLayer(env, req)
    expect(first.outcome).toBe('applied')
    expect(executeAction).toHaveBeenCalledTimes(1)

    const second = await guardLayer(env, req)
    expect(second.outcome).toBe('noop_duplicate')
    expect(executeAction).toHaveBeenCalledTimes(1) // NOT re-executed
    expect(second.evidence.fire_count).toBe(2)
  })

  it('executeAction throws → outcome failed_error, evidence still written', async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url.includes('/health')) {
        return new Response('{"ok":true}', { status: 200 })
      }
      if (url.includes('/actions/runs')) {
        return new Response(
          JSON.stringify({ workflow_runs: [] }),
          { status: 200 },
        )
      }
      if (url.includes('/contents/brain/06-meta/auto-actions/')) {
        return new Response(JSON.stringify({ commit: { sha: 'fff' } }), {
          status: 201,
        })
      }
      return new Response('not mocked', { status: 500 })
    }) as unknown as typeof fetch

    const env = makeEnv()
    const executeAction = vi.fn().mockRejectedValue(new Error('GitHub 422'))

    const res = await guardLayer(env, {
      ...baseRequest,
      verifierParams: {
        url: 'https://brain-write.example/health',
        repo: 'AetherCreator/SuperClaude',
        commit_sha: 'abc123',
      },
      executeAction,
    })

    expect(res.outcome).toBe('failed_error')
    expect(res.evidence.outcome_detail).toContain('GitHub 422')
  })

  it('intent with no required verifiers (ops_board_file) skips verifier phase', async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url.includes('/contents/brain/06-meta/auto-actions/')) {
        return new Response(JSON.stringify({ commit: { sha: 'fff' } }), {
          status: 201,
        })
      }
      return new Response('not mocked', { status: 500 })
    }) as unknown as typeof fetch

    const env = makeEnv()
    const executeAction = vi.fn().mockResolvedValue({
      detail: 'filed',
      reversible_via: null,
    })

    const res = await guardLayer(env, {
      actor: 'locke-changelog-watcher',
      intent: 'ops_board_file',
      trigger: { type: 'atom_feed', details: { item_id: 'cf-sdk-v4' } },
      action: {
        type: 'ops_board_file',
        target: 'OPS-CF-SDK-V4',
        params: { severity: 'breaking_change' },
      },
      executeAction,
    })

    expect(res.outcome).toBe('applied')
    expect(res.evidence.verifier_outcome).toBe('n/a')
    expect(executeAction).toHaveBeenCalledOnce()
  })
})
