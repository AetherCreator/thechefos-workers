// C3 integration tests for the validator hook in /api/webhook/github.
//
// Exercises the real Hono route via app.request(...) with a signed payload
// + MSW-mocked GitHub Contents API + Telegram relay. Confirms:
//   - dry-run + valid    -> applied verdict, audit committed, OPS routing happens
//   - enforce + blocked  -> audit committed, ping fired, OPS routing skipped

import { describe, it, expect, beforeEach } from 'vitest'
import { http, HttpResponse } from 'msw'
import { createHmac } from 'node:crypto'
import { server } from './msw-setup'
import app from '../../src/index'

const WEBHOOK_SECRET = 'test-webhook-secret'
const GITHUB_WEBHOOK_SECRET = WEBHOOK_SECRET
const GITHUB_TOKEN = 'test-github-token'
// Real H1 SHA so V3 push verification passes (MSW handlers in msw-setup.ts return 200 for it)
const VALID_WORK_COMMIT = 'b56bc8e79fea8cf152ea438bc1c4a3f9908cc4b3'
const PUSH_COMMIT_SHA = 'cafebabe1234567890abcdef1234567890abcdef'

const VALID_COMPLETE_MD = `hunt: carpenter-foundation
clue: 1
status: COMPLETE
work_repo: AetherCreator/SuperClaude
work_commit: ${VALID_WORK_COMMIT}
hunt_repo: AetherCreator/SuperClaude
verify_log:
  - "git rev-parse HEAD: exit=0 ${VALID_WORK_COMMIT.slice(0, 12)}"
evidence_urls:
  - "https://github.com/AetherCreator/SuperClaude/commit/${VALID_WORK_COMMIT}"
flags: []
notes: ""
agent: carpenter
`

const PLACEHOLDER_COMPLETE_MD = `hunt: carpenter-runner
clue: 4
status: COMPLETE
work_repo: AetherCreator/SuperClaude
work_commit: __will_be_filled_by_runner_after_push__
hunt_repo: AetherCreator/SuperClaude
verify_log: ["echo: exit=0 ok"]
evidence_urls:
  - "https://github.com/AetherCreator/SuperClaude/commit/__will_be_filled__"
flags: []
notes: ""
agent: carpenter
`

function makeWebhookPayload(file: string, commitSha: string = PUSH_COMMIT_SHA) {
  return {
    ref: 'refs/heads/main',
    head_commit: {
      committer: { email: 'someone-else@example.com' }, // not brain-ops self-commit
    },
    commits: [
      {
        id: commitSha,
        message: 'test commit',
        added: [],
        modified: [file],
        removed: [],
        committer: { email: 'someone-else@example.com' },
      },
    ],
    repository: { full_name: 'AetherCreator/SuperClaude' },
  }
}

function signBody(body: string, secret: string): string {
  return 'sha256=' + createHmac('sha256', secret).update(body).digest('hex')
}

interface RecordedCall {
  url: string
  method: string
  body?: unknown
}

function recordAndPassthroughGithubGetFiles(rec: RecordedCall[], fileBody: string) {
  return [
    // GET .../contents/* — multi-segment wildcard, dispatch by URL inspection
    http.get(
      'https://api.github.com/repos/AetherCreator/SuperClaude/contents/*',
      ({ request }) => {
        rec.push({ url: request.url, method: 'GET' })
        const url = new URL(request.url)
        if (url.searchParams.has('ref')) {
          // file-at-ref read (validator's fetchFileTextAtRef)
          return new HttpResponse(fileBody, { status: 200 })
        }
        // OPS-BOARD read (no ref)
        return HttpResponse.json({
          name: 'OPS-BOARD.md',
          path: 'brain/OPS-BOARD.md',
          sha: 'ops-board-sha',
          content: btoa('# OPS-BOARD\n## ACTIVE\n'),
          encoding: 'base64',
        })
      },
    ),
    // PUT .../contents/* — audit trail commit + any other PUT
    http.put(
      'https://api.github.com/repos/AetherCreator/SuperClaude/contents/*',
      async ({ request }) => {
        const body = await request.json()
        rec.push({ url: request.url, method: 'PUT', body })
        return HttpResponse.json(
          { commit: { sha: 'audit-trail-commit-sha' } },
          { status: 201 },
        )
      },
    ),
    // telegram relay
    http.post('https://api.thechefos.app/api/telegram', async ({ request }) => {
      const body = await request.json()
      rec.push({ url: request.url, method: 'POST', body })
      return HttpResponse.json({ ok: true, message_id: 12345 })
    }),
  ]
}

describe('C3 webhook validator integration', () => {
  let calls: RecordedCall[]

  beforeEach(() => {
    calls = []
  })

  function makeEnv(dryRun: boolean) {
    return {
      GITHUB_TOKEN,
      WEBHOOK_SECRET,
      GITHUB_WEBHOOK_SECRET,
      SESSION_KV: {
        get: async () => null,
        put: async () => undefined,
      } as unknown as KVNamespace,
      COMPLETE_VALIDATOR_DRY_RUN: dryRun ? 'true' : 'false',
    }
  }

  it('dry-run + valid COMPLETE.md -> applied verdict + audit committed, no ping, OPS attempted', async () => {
    server.use(...recordAndPassthroughGithubGetFiles(calls, VALID_COMPLETE_MD))
    const payload = makeWebhookPayload(
      'hunts/carpenter-foundation/clue-1/COMPLETE.md',
      PUSH_COMMIT_SHA,
    )
    const body = JSON.stringify(payload)
    const res = await app.request(
      '/api/webhook/github',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-hub-signature-256': signBody(body, GITHUB_WEBHOOK_SECRET),
        },
        body,
      },
      makeEnv(true),
    )
    expect(res.status).toBe(200)
    const json = (await res.json()) as {
      validator_results: Array<{ verdict: string; blocked: boolean; dry_run: boolean }>
      validator_dry_run: boolean
      ops_results: Array<unknown>
    }
    expect(json.validator_dry_run).toBe(true)
    expect(json.validator_results).toHaveLength(1)
    expect(json.validator_results[0]).toMatchObject({
      verdict: 'applied',
      blocked: false,
      dry_run: true,
    })
    // Audit trail PUT happened
    const auditPuts = calls.filter(
      c => c.method === 'PUT' && c.url.includes('/06-meta/auto-actions/'),
    )
    expect(auditPuts).toHaveLength(1)
    // No Telegram ping (dry-run)
    const telegramCalls = calls.filter(c => c.url === 'https://api.thechefos.app/api/telegram')
    expect(telegramCalls).toHaveLength(0)
    // OPS routing was attempted (downstream OPS-BOARD fetch happened)
    const opsFetch = calls.find(c => c.url.includes('OPS-BOARD.md'))
    expect(opsFetch).toBeDefined()
  })

  it('enforce + placeholder -> blocked_placeholder verdict + audit + ping + OPS skipped for this file', async () => {
    server.use(...recordAndPassthroughGithubGetFiles(calls, PLACEHOLDER_COMPLETE_MD))
    const payload = makeWebhookPayload(
      'hunts/carpenter-runner/clue-4/COMPLETE.md',
      PUSH_COMMIT_SHA,
    )
    const body = JSON.stringify(payload)
    const res = await app.request(
      '/api/webhook/github',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-hub-signature-256': signBody(body, GITHUB_WEBHOOK_SECRET),
        },
        body,
      },
      makeEnv(false), // enforce
    )
    expect(res.status).toBe(200)
    const json = (await res.json()) as {
      validator_results: Array<{ verdict: string; blocked: boolean; ping?: unknown }>
      validator_dry_run: boolean
      ops_results: Array<{ result: { ok: boolean; error?: string } }>
    }
    expect(json.validator_dry_run).toBe(false)
    expect(json.validator_results).toHaveLength(1)
    expect(json.validator_results[0]).toMatchObject({
      verdict: 'blocked_placeholder',
      blocked: true,
    })
    expect(json.validator_results[0].ping).toBeDefined()
    // Audit trail PUT happened
    const auditPuts = calls.filter(
      c => c.method === 'PUT' && c.url.includes('/06-meta/auto-actions/'),
    )
    expect(auditPuts).toHaveLength(1)
    // Telegram ping fired
    const telegramCalls = calls.filter(c => c.url === 'https://api.thechefos.app/api/telegram')
    expect(telegramCalls).toHaveLength(1)
    // OPS routing skipped for this file
    expect(json.ops_results).toHaveLength(1)
    expect(json.ops_results[0].result.ok).toBe(false)
    expect(json.ops_results[0].result.error).toBe('blocked_by_complete_validator')
  })

  describe('COMPLETE_MD_PATTERN path gating (v1.1 broadened regex)', () => {
    // ── Regex unit: test the pattern in isolation ────────────────────────
    const PATTERN = /^hunts\/(?:[^/]+\/)+clue-[^/]+\/COMPLETE\.md$/

    it.each([
      ['hunts/foo/clue-1/COMPLETE.md', true],               // canonical 1-segment (unchanged)
      ['hunts/_smoke/h2-c3/clue-1/COMPLETE.md', true],     // 2-segment namespace (NEW)
      ['hunts/_smoke/foo/bar/clue-1/COMPLETE.md', true],   // 3-segment namespace (NEW)
      ['hunts/clue-1/COMPLETE.md', false],                  // zero namespace segments
      ['hunts/COMPLETE.md', false],                          // no namespace or clue
      ['hunts/foo/COMPLETE.md', false],                      // no clue segment
      ['hunts/foo/clue-1/something.md', false],              // not COMPLETE.md ($-anchor)
      ['hunts/foo/clue-1/COMPLETE.md.bak', false],          // suffix after COMPLETE.md ($-anchor)
    ])('regex: %s → matches=%s', (path, expected) => {
      expect(PATTERN.test(path)).toBe(expected)
    })

    // ── Integration: nested-namespace paths → validator actually runs ────
    it('2-segment namespace (_smoke/h2-c3) → validator processes file', async () => {
      server.use(...recordAndPassthroughGithubGetFiles(calls, VALID_COMPLETE_MD))
      const payload = makeWebhookPayload('hunts/_smoke/h2-c3/clue-1/COMPLETE.md', PUSH_COMMIT_SHA)
      const body = JSON.stringify(payload)
      const res = await app.request(
        '/api/webhook/github',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-hub-signature-256': signBody(body, GITHUB_WEBHOOK_SECRET),
          },
          body,
        },
        makeEnv(true),
      )
      expect(res.status).toBe(200)
      const json = (await res.json()) as { validator_results: Array<{ file: string }> }
      expect(json.validator_results).toHaveLength(1)
      expect(json.validator_results[0].file).toBe('hunts/_smoke/h2-c3/clue-1/COMPLETE.md')
    })

    it('3-segment namespace (_smoke/foo/bar) → validator processes file', async () => {
      server.use(...recordAndPassthroughGithubGetFiles(calls, VALID_COMPLETE_MD))
      const payload = makeWebhookPayload(
        'hunts/_smoke/foo/bar/clue-1/COMPLETE.md',
        PUSH_COMMIT_SHA,
      )
      const body = JSON.stringify(payload)
      const res = await app.request(
        '/api/webhook/github',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-hub-signature-256': signBody(body, GITHUB_WEBHOOK_SECRET),
          },
          body,
        },
        makeEnv(true),
      )
      expect(res.status).toBe(200)
      const json = (await res.json()) as { validator_results: Array<{ file: string }> }
      expect(json.validator_results).toHaveLength(1)
      expect(json.validator_results[0].file).toBe('hunts/_smoke/foo/bar/clue-1/COMPLETE.md')
    })

    it('zero-segment path (hunts/clue-1/COMPLETE.md) → validator skips', async () => {
      server.use(...recordAndPassthroughGithubGetFiles(calls, VALID_COMPLETE_MD))
      const payload = makeWebhookPayload('hunts/clue-1/COMPLETE.md', PUSH_COMMIT_SHA)
      const body = JSON.stringify(payload)
      const res = await app.request(
        '/api/webhook/github',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-hub-signature-256': signBody(body, GITHUB_WEBHOOK_SECRET),
          },
          body,
        },
        makeEnv(true),
      )
      expect(res.status).toBe(200)
      const json = (await res.json()) as { validator_results: Array<unknown> }
      expect(json.validator_results).toHaveLength(0)
    })
  })

  it('invalid signature -> 401 (sanity, no validator side-effects)', async () => {
    server.use(...recordAndPassthroughGithubGetFiles(calls, VALID_COMPLETE_MD))
    const payload = makeWebhookPayload(
      'hunts/carpenter-foundation/clue-1/COMPLETE.md',
      PUSH_COMMIT_SHA,
    )
    const body = JSON.stringify(payload)
    const res = await app.request(
      '/api/webhook/github',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-hub-signature-256': 'sha256=' + 'f'.repeat(64),
        },
        body,
      },
      makeEnv(true),
    )
    expect(res.status).toBe(401)
    // No audit calls, no Telegram
    expect(calls.filter(c => c.method === 'PUT')).toHaveLength(0)
    expect(calls.filter(c => c.url.includes('telegram'))).toHaveLength(0)
  })
})
