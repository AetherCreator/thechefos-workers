import { describe, it, expect, vi, beforeEach } from 'vitest'
import { handleOpsFile, insertRowIntoSection } from '../../src/ops-file'

// ── Fixtures ─────────────────────────────────────────────────────────────────

const MOCK_OPS_BOARD = [
  '# OPS-BOARD.md',
  '',
  '---',
  '',
  '## 🔴 URGENT',
  '| ID | Task | Status |',
  '|----|------|--------|',
  '| OPS-001 | Rotate tokens | ⏳ |',
  '',
  '---',
  '',
  '## ✅ COMPLETED',
  '| Task | Notes |',
  '|------|-------|',
  '',
  '---',
  '',
  '## 🟡 ACTIVE',
  '| ID | Task | Domain | Notes |',
  '|----|------|--------|-------|',
  '',
  '---',
  '',
  '## 🟢 BACKLOG',
  '| ID | Task | Domain | Priority |',
  '|----|------|--------|----------|',
  '| OPS-EXISTING | Existing task | infra | Normal |',
  '',
].join('\n')

function b64(s: string): string {
  return btoa(unescape(encodeURIComponent(s)))
}

function fromB64(s: string): string {
  return decodeURIComponent(escape(atob(s.replace(/\n/g, ''))))
}

function createMockKV() {
  const store = new Map<string, string>()
  return {
    get: vi.fn().mockImplementation(async (key: string, type?: string) => {
      const val = store.get(key)
      if (!val) return null
      return type === 'json' ? JSON.parse(val) : val
    }),
    put: vi.fn().mockImplementation(async (key: string, value: string) => {
      store.set(key, value)
    }),
    _store: store,
  }
}

function makeEnv(kv?: ReturnType<typeof createMockKV>) {
  return {
    GITHUB_TOKEN: 'gh-token',
    BRAIN_WRITE_API_SECRET: 'secret-key',
    IDEMPOTENCY_KEYS: kv as any,
  }
}

function makeReq(body: Record<string, unknown>, overrideHeaders: Record<string, string> = {}): Request {
  return new Request('https://example.com/api/ops/file', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Brain-Write-Key': 'secret-key',
      ...overrideHeaders,
    },
    body: JSON.stringify(body),
  })
}

let capturedPutBody: Record<string, unknown> = {}

function mockGitHub() {
  capturedPutBody = {}
  vi.stubGlobal('fetch', vi.fn().mockImplementation(async (_url: string, options?: RequestInit) => {
    if (options?.method === 'PUT') {
      capturedPutBody = JSON.parse(options.body as string)
      return {
        ok: true,
        json: async () => ({
          commit: {
            sha: 'deadbeef1234',
            html_url: 'https://github.com/AetherCreator/SuperClaude/commit/deadbeef1234',
          },
        }),
      }
    }
    // GET (fetch OPS-BOARD)
    return {
      ok: true,
      json: async () => ({ sha: 'board-sha', content: b64(MOCK_OPS_BOARD), encoding: 'base64' }),
    }
  }))
}

const VALID_BACKLOG_PAYLOAD = {
  ops_id: 'OPS-C4-TEST',
  priority: 'Normal' as const,
  section: 'BACKLOG' as const,
  title: 'C4 test task',
  body: 'Automated filing from changelog-watcher',
}

const VALID_URGENT_PAYLOAD = {
  ops_id: 'OPS-C4-URGENT',
  priority: 'URGENT' as const,
  section: 'URGENT' as const,
  title: 'Security advisory',
  body: 'Critical vulnerability in dep-foo',
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('/api/ops/file route', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    capturedPutBody = {}
  })

  it('returns 401 when X-Brain-Write-Key header is missing', async () => {
    const env = makeEnv(createMockKV())
    const req = new Request('https://example.com/api/ops/file', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(VALID_BACKLOG_PAYLOAD),
    })
    const res = await handleOpsFile(env, req)
    expect(res.status).toBe(401)
  })

  it('returns 401 when X-Brain-Write-Key is wrong', async () => {
    const env = makeEnv(createMockKV())
    const req = makeReq(VALID_BACKLOG_PAYLOAD, { 'X-Brain-Write-Key': 'wrong-key' })
    const res = await handleOpsFile(env, req)
    expect(res.status).toBe(401)
  })

  it('returns 400 on invalid ops_id (lowercase)', async () => {
    const env = makeEnv(createMockKV())
    const req = makeReq({ ...VALID_BACKLOG_PAYLOAD, ops_id: 'ops-lowercase' })
    const res = await handleOpsFile(env, req)
    expect(res.status).toBe(400)
    const body = await res.json() as Record<string, unknown>
    expect(body.error).toBe('invalid_ops_id')
  })

  it('returns 400 on missing body field', async () => {
    const env = makeEnv(createMockKV())
    const { body: _b, ...noBody } = VALID_BACKLOG_PAYLOAD
    const req = makeReq(noBody)
    const res = await handleOpsFile(env, req)
    expect(res.status).toBe(400)
    const body = await res.json() as Record<string, unknown>
    expect(body.error).toBe('missing_body')
  })

  it('happy path returns 200 with idempotency_hit: false and commit_url', async () => {
    const kv = createMockKV()
    const env = makeEnv(kv)
    mockGitHub()
    const req = makeReq(VALID_BACKLOG_PAYLOAD)
    const res = await handleOpsFile(env, req)
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(body.ok).toBe(true)
    expect(body.ops_id).toBe('OPS-C4-TEST')
    expect(body.idempotency_hit).toBe(false)
    expect(typeof body.commit_url).toBe('string')
    expect((body.commit_url as string).startsWith('https://')).toBe(true)
  })

  it('replay returns 200 with idempotency_hit: true and the same commit_url', async () => {
    const kv = createMockKV()
    const env = makeEnv(kv)
    mockGitHub()

    const req1 = makeReq({ ...VALID_BACKLOG_PAYLOAD, ops_id: 'OPS-REPLAY-TEST' })
    const res1 = await handleOpsFile(env, req1)
    const body1 = await res1.json() as Record<string, unknown>
    expect(res1.status).toBe(200)
    expect(body1.idempotency_hit).toBe(false)

    const req2 = makeReq({ ...VALID_BACKLOG_PAYLOAD, ops_id: 'OPS-REPLAY-TEST' })
    const res2 = await handleOpsFile(env, req2)
    const body2 = await res2.json() as Record<string, unknown>
    expect(res2.status).toBe(200)
    expect(body2.idempotency_hit).toBe(true)
    expect(body2.commit_url).toBe(body1.commit_url)
    // KV PUT should only have been called once (first fire)
    expect((kv.put as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1)
  })

  it('URGENT section insertion lands under ## 🔴 URGENT', async () => {
    const kv = createMockKV()
    const env = makeEnv(kv)
    mockGitHub()
    const req = makeReq(VALID_URGENT_PAYLOAD)
    const res = await handleOpsFile(env, req)
    expect(res.status).toBe(200)

    const decodedContent = fromB64(capturedPutBody.content as string)
    const urgentIdx = decodedContent.indexOf('## 🔴 URGENT')
    const rowIdx = decodedContent.indexOf('OPS-C4-URGENT')
    const completedIdx = decodedContent.indexOf('## ✅ COMPLETED')
    expect(urgentIdx).toBeGreaterThanOrEqual(0)
    expect(rowIdx).toBeGreaterThan(urgentIdx)
    if (completedIdx !== -1) expect(rowIdx).toBeLessThan(completedIdx)
  })

  it('BACKLOG section insertion lands under ## 🟢 BACKLOG', async () => {
    const kv = createMockKV()
    const env = makeEnv(kv)
    mockGitHub()
    const req = makeReq({ ...VALID_BACKLOG_PAYLOAD, ops_id: 'OPS-BACKLOG-INSERT' })
    const res = await handleOpsFile(env, req)
    expect(res.status).toBe(200)

    const decodedContent = fromB64(capturedPutBody.content as string)
    const backlogIdx = decodedContent.indexOf('## 🟢 BACKLOG')
    const rowIdx = decodedContent.indexOf('OPS-BACKLOG-INSERT')
    expect(backlogIdx).toBeGreaterThanOrEqual(0)
    expect(rowIdx).toBeGreaterThan(backlogIdx)
    // must not appear in URGENT section
    const urgentIdx = decodedContent.indexOf('## 🔴 URGENT')
    const activeIdx = decodedContent.indexOf('## 🟡 ACTIVE')
    expect(rowIdx).toBeGreaterThan(activeIdx !== -1 ? activeIdx : urgentIdx)
  })
})

// ── insertRowIntoSection unit tests ──────────────────────────────────────────

describe('insertRowIntoSection', () => {
  it('inserts after last data row in URGENT section', () => {
    const content = MOCK_OPS_BOARD
    const result = insertRowIntoSection(content, '## 🔴 URGENT', '| OPS-NEW | new | Low |')
    const lines = result.split('\n')
    const urgentHeaderIdx = lines.findIndex(l => l.startsWith('## 🔴 URGENT'))
    const newRowIdx = lines.findIndex(l => l.includes('OPS-NEW'))
    const existingIdx = lines.findIndex(l => l.includes('OPS-001'))
    expect(newRowIdx).toBeGreaterThan(urgentHeaderIdx)
    expect(newRowIdx).toBeGreaterThan(existingIdx)
  })

  it('inserts after last data row in BACKLOG section', () => {
    const content = MOCK_OPS_BOARD
    const result = insertRowIntoSection(content, '## 🟢 BACKLOG', '| OPS-NEW | new | infra | Normal |')
    const lines = result.split('\n')
    const backlogIdx = lines.findIndex(l => l.startsWith('## 🟢 BACKLOG'))
    const newRowIdx = lines.findIndex(l => l.includes('OPS-NEW'))
    const existingIdx = lines.findIndex(l => l.includes('OPS-EXISTING'))
    expect(newRowIdx).toBeGreaterThan(backlogIdx)
    expect(newRowIdx).toBeGreaterThan(existingIdx)
  })

  it('returns content unchanged when section not found', () => {
    const content = MOCK_OPS_BOARD
    const result = insertRowIntoSection(content, '## 🟣 NONEXISTENT', '| OPS-NEW | new |')
    expect(result).toBe(content)
  })
})
