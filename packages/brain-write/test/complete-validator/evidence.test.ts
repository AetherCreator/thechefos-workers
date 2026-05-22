import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { http, HttpResponse } from 'msw'
import { validateComplete } from '../../src/complete-validator/index'
import { server } from './msw-setup'
import type { ValidatorEnv } from '../../src/complete-validator/types'

const __dirname = dirname(fileURLToPath(import.meta.url))
const FIXTURE_DIR = join(__dirname, '..', '..', 'src', 'complete-validator', '__fixtures__')

const env: ValidatorEnv = { GITHUB_TOKEN: 'test-msw-mocked' }
const envWithCf: ValidatorEnv = {
  GITHUB_TOKEN: 'test-msw-mocked',
  CF_API_TOKEN: 'test-cf-token',
  CF_ACCOUNT_ID: 'test-cf-acct',
}
const load = (name: string) => readFileSync(join(FIXTURE_DIR, name), 'utf-8')

describe('complete-validator C2 — evidence layer', () => {
  it('valid-with-real-sha.md → applied (V3 passes via MSW 200)', async () => {
    const r = await validateComplete(load('valid-with-real-sha.md'), env)
    expect(r.verdict).toBe('applied')
  })

  it('fake-sha.md → blocked_push_unverified (MSW catch-all returns 404)', async () => {
    const r = await validateComplete(load('fake-sha.md'), env)
    expect(r.verdict).toBe('blocked_push_unverified')
    if (r.verdict === 'blocked_push_unverified') {
      expect(r.diagnosis.github_status).toBe(404)
      expect(r.diagnosis.work_commit).toBe('1234567890abcdef1234567890abcdef12345678')
    }
  })

  it('cross-repo-valid.md → applied (both work_commit + hunt_commit resolve via MSW)', async () => {
    const r = await validateComplete(load('cross-repo-valid.md'), env)
    expect(r.verdict).toBe('applied')
  })

  it('sandbox-partial.md → applied (V3 bypassed for PARTIAL status)', async () => {
    // Uses a fake SHA which would 404 — but V3 doesn't fire on PARTIAL.
    const r = await validateComplete(load('sandbox-partial.md'), env)
    expect(r.verdict).toBe('applied')
  })

  it('blocked-no-notes.md → blocked_status_evidence_mismatch (BLOCKED notes < 20 chars)', async () => {
    const r = await validateComplete(load('blocked-no-notes.md'), env)
    expect(r.verdict).toBe('blocked_status_evidence_mismatch')
    if (r.verdict === 'blocked_status_evidence_mismatch') {
      expect(r.diagnosis.notes_length).toBeLessThan(20)
    }
  })

  it('d1-sha-mismatch.md → blocked_d1_sha_mismatch (D1 override returns differing SHA)', async () => {
    server.use(
      http.post(
        'https://api.cloudflare.com/client/v4/accounts/:acct/d1/database/:dbid/query',
        () =>
          HttpResponse.json({
            result: [
              {
                results: [
                  { work_commit: '9999999999999999999999999999999999999999' },
                ],
              },
            ],
          }),
      ),
    )
    const r = await validateComplete(load('d1-sha-mismatch.md'), envWithCf)
    expect(r.verdict).toBe('blocked_d1_sha_mismatch')
    if (r.verdict === 'blocked_d1_sha_mismatch') {
      expect(r.diagnosis.d1_sha).toBe('9999999999999999999999999999999999999999')
      expect(r.diagnosis.complete_md_sha).toBe(
        'b56bc8e79fea8cf152ea438bc1c4a3f9908cc4b3',
      )
    }
  })

  it('d1 soft-skip: same fixture but no CF creds → applied (D1 check skipped, V3 still passes)', async () => {
    // Belt-and-suspenders: confirms D1 is soft-skip and not gating.
    const r = await validateComplete(load('d1-sha-mismatch.md'), env)
    expect(r.verdict).toBe('applied')
  })

  it('d1 soft-skip: D1 endpoint 500 → applied (transport failure must not false-block)', async () => {
    server.use(
      http.post(
        'https://api.cloudflare.com/client/v4/accounts/:acct/d1/database/:dbid/query',
        () => new HttpResponse(null, { status: 500 }),
      ),
    )
    const r = await validateComplete(load('d1-sha-mismatch.md'), envWithCf)
    expect(r.verdict).toBe('applied')
  })
})

describe('complete-validator E2E (real GitHub, gated by VITEST_INTEGRATION=1)', () => {
  it.skipIf(!process.env.VITEST_INTEGRATION)(
    'verifies the real H1 C1 commit on origin',
    async () => {
      // Real GITHUB_TOKEN must be in env for this gated test.
      const realEnv: ValidatorEnv = { GITHUB_TOKEN: process.env.GITHUB_TOKEN || '' }
      const completeMd = `
hunt: carpenter-foundation
clue: 1
status: COMPLETE
work_repo: AetherCreator/SuperClaude
work_commit: b56bc8e79fea8cf152ea438bc1c4a3f9908cc4b3
hunt_repo: AetherCreator/SuperClaude
verify_log:
  - "git rev-parse HEAD: exit=0 b56bc8e79fea"
evidence_urls:
  - "https://github.com/AetherCreator/SuperClaude/commit/b56bc8e79fea8cf152ea438bc1c4a3f9908cc4b3"
flags: []
notes: ""
agent: carpenter
`
      const r = await validateComplete(completeMd, realEnv)
      expect(r.verdict).toBe('applied')
    },
  )
})
