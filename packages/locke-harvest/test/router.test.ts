import { describe, it, expect, vi, afterEach } from 'vitest'
import worker from '../src/index'

const mockEnv = {
  AI: {},
  PERSONA: 'lookout',
  BRAIN_PATH: 'brain/05-leads',
  INTEL_LOG_URL: 'https://example.com/intel',
  BRAIN_WRITE_URL: 'https://example.com/brain',
  NIM_URL: 'https://example.com/nim',
  NIM_MODEL: '@cf/meta/llama-test',
  SCHEMA_VERSION: 'locke-1.2',
  MAX_LEADS_PER_RUN: '5',
  WALL_CLOCK_BUDGET_MS: '480000',
  PER_QUERY_SLEEP_MS: '0',
  NIM_BUDGET: '50',
  NIM_API_KEY: 'test-nim-key',
  BRAIN_WRITE_SECRET: 'test-brain-secret',
  HARVEST_RUN_SECRET: 'test-secret',
  BRAVE_SEARCH_API_KEY: 'test-brave-key',
}

const mockCtx = {
  waitUntil: (_p: Promise<any>) => {},
  passThroughOnException: () => {},
} as unknown as ExecutionContext

describe('router', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })
  it('GET /health returns 200 with both personas listed', async () => {
    const req = new Request('https://locke-harvest.workers.dev/health')
    const res = await worker.fetch(req, mockEnv as any, mockCtx)
    expect(res.status).toBe(200)
    const body = await res.json() as any
    expect(body.ok).toBe(true)
    expect(Array.isArray(body.personas)).toBe(true)
    expect(body.personas).toContain('lookout')
    expect(body.personas).toContain('changelog-watcher')
  })

  it('POST /run returns 308 redirect to /run/lookout', async () => {
    const req = new Request('https://locke-harvest.workers.dev/run', { method: 'POST' })
    const res = await worker.fetch(req, mockEnv as any, mockCtx)
    expect(res.status).toBe(308)
    const location = res.headers.get('Location') ?? ''
    expect(location).toContain('/run/lookout')
  })

  it('POST /run/changelog with valid secret returns 200 run response', async () => {
    const emptyFeed = `<?xml version="1.0" encoding="UTF-8"?><feed xmlns="http://www.w3.org/2005/Atom"><title>Test</title></feed>`
    const depsYaml = 'version: 1\ndependencies:\n  - name: test-dep\n    feed: https://example.com/feed.atom\n    criticality: high\n    notes: test\n'
    const base64Yaml = Buffer.from(depsYaml, 'utf-8').toString('base64')
    const mockKV = { get: vi.fn().mockResolvedValue(null), put: vi.fn().mockResolvedValue(undefined) }
    const envWithExtras = {
      ...mockEnv,
      GITHUB_TOKEN: 'test-token',
      CHANGELOG_SEEN: mockKV,
    }
    vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
      if (String(url).includes('api.github.com')) {
        return Promise.resolve({ ok: true, json: async () => ({ content: base64Yaml, encoding: 'base64' }) })
      }
      return Promise.resolve({ ok: true, text: async () => emptyFeed })
    }))
    const req = new Request('https://locke-harvest.workers.dev/run/changelog?secret=test-secret', { method: 'POST' })
    const res = await worker.fetch(req, envWithExtras as any, mockCtx)
    expect(res.status).toBe(200)
    const body = await res.json() as any
    expect(body.ok).toBe(true)
    expect(body.persona).toBe('changelog-watcher')
    expect(typeof body.deps_polled).toBe('number')
    expect(Array.isArray(body.leads)).toBe(true)
  })

  it('POST /run/changelog with wrong secret returns 403', async () => {
    const req = new Request('https://locke-harvest.workers.dev/run/changelog?secret=wrong', { method: 'POST' })
    const res = await worker.fetch(req, mockEnv as any, mockCtx)
    expect(res.status).toBe(403)
  })

  it('unknown path returns 404 with error field', async () => {
    const req = new Request('https://locke-harvest.workers.dev/unknown')
    const res = await worker.fetch(req, mockEnv as any, mockCtx)
    expect(res.status).toBe(404)
    const body = await res.json() as any
    expect(body.error).toBe('not_found')
  })
})
