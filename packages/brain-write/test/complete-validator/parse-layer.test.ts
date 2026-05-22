import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { validateComplete } from '../../src/complete-validator/index'
import type { ValidatorEnv } from '../../src/complete-validator/types'

const __dirname = dirname(fileURLToPath(import.meta.url))
const FIXTURE_DIR = join(__dirname, '..', '..', 'src', 'complete-validator', '__fixtures__')

const env: ValidatorEnv = { GITHUB_TOKEN: 'test-not-used-in-c1' }
const load = (name: string) => readFileSync(join(FIXTURE_DIR, name), 'utf-8')

describe('complete-validator C1 — parse layer', () => {
  it('valid-carpenter.md → partial_pending_evidence (agent=carpenter)', async () => {
    const r = await validateComplete(load('valid-carpenter.md'), env)
    expect(r.verdict).toBe('partial_pending_evidence')
    if (r.verdict === 'partial_pending_evidence') {
      expect(r.agent).toBe('carpenter')
      expect(r.parsed.hunt).toBe('carpenter-runner')
      expect(r.parsed.clue).toBe(4)
      expect(r.parsed.status).toBe('COMPLETE')
    }
  })

  it('valid-hunter.md → partial_pending_evidence (agent=hunter)', async () => {
    const r = await validateComplete(load('valid-hunter.md'), env)
    expect(r.verdict).toBe('partial_pending_evidence')
    if (r.verdict === 'partial_pending_evidence') {
      expect(r.agent).toBe('hunter')
      expect(r.parsed.work_repo).toBe('AetherCreator/aether-chronicles')
      expect(r.parsed.hunt_repo).toBe('AetherCreator/SuperClaude')
    }
  })

  it('missing-field.md → blocked_schema', async () => {
    const r = await validateComplete(load('missing-field.md'), env)
    expect(r.verdict).toBe('blocked_schema')
    if (r.verdict === 'blocked_schema') {
      // diagnosis should mention the missing field
      const allIssues = r.diagnosis.all_issues as Array<{ path: unknown[] }>
      expect(allIssues.some(i => Array.isArray(i.path) && i.path.includes('work_repo'))).toBe(true)
    }
  })

  it('wrong-type.md → blocked_schema (clue is string not int)', async () => {
    const r = await validateComplete(load('wrong-type.md'), env)
    expect(r.verdict).toBe('blocked_schema')
  })

  it('fictional-field.md → blocked_fictional_field (zod strict catches unknown key)', async () => {
    const r = await validateComplete(load('fictional-field.md'), env)
    expect(r.verdict).toBe('blocked_fictional_field')
  })

  it('verify-log-malformed.md → blocked_verify_log_malformed', async () => {
    const r = await validateComplete(load('verify-log-malformed.md'), env)
    expect(r.verdict).toBe('blocked_verify_log_malformed')
    if (r.verdict === 'blocked_verify_log_malformed') {
      expect(r.diagnosis.malformed_indices).toEqual([0])
    }
  })

  it('placeholder-work-commit.md → blocked_placeholder (catches H2 fiction structurally)', async () => {
    const r = await validateComplete(load('placeholder-work-commit.md'), env)
    expect(r.verdict).toBe('blocked_placeholder')
  })

  it('blocked-empty-flags.md → blocked_blocked_empty_flags (BLOCKED requires non-empty flags)', async () => {
    const r = await validateComplete(load('blocked-empty-flags.md'), env)
    expect(r.verdict).toBe('blocked_blocked_empty_flags')
  })
})
