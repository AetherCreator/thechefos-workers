import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { validateComplete } from '../../src/complete-validator/index'
import type { ValidatorEnv } from '../../src/complete-validator/types'

const __dirname = dirname(fileURLToPath(import.meta.url))
const FIXTURE_DIR = join(__dirname, '..', '..', 'src', 'complete-validator', '__fixtures__')

// C2: MSW is now active globally via vitest.config.ts setupFiles, so these
// tests exercise the full pipeline (parse layer + evidence layer). The two
// "valid-*" fixtures carry real H1/aether-chronicles SHAs that MSW returns
// 200 for; everything else fails at parse layer before evidence is touched.
const env: ValidatorEnv = { GITHUB_TOKEN: 'test-msw-mocked' }
const load = (name: string) => readFileSync(join(FIXTURE_DIR, name), 'utf-8')

describe('complete-validator C1 — parse layer (post-C2 pipeline integration)', () => {
  it('valid-carpenter.md → applied (agent=carpenter, real H1 SHA via MSW)', async () => {
    const r = await validateComplete(load('valid-carpenter.md'), env)
    expect(r.verdict).toBe('applied')
    if (r.verdict === 'applied') {
      expect(r.agent).toBe('carpenter')
      expect(r.parsed.hunt).toBe('carpenter-foundation')
      expect(r.parsed.clue).toBe(1)
      expect(r.parsed.status).toBe('COMPLETE')
    }
  })

  it('valid-hunter.md → applied (agent=hunter, real aether SHA via MSW)', async () => {
    const r = await validateComplete(load('valid-hunter.md'), env)
    expect(r.verdict).toBe('applied')
    if (r.verdict === 'applied') {
      expect(r.agent).toBe('hunter')
      expect(r.parsed.work_repo).toBe('AetherCreator/aether-chronicles')
      expect(r.parsed.hunt_repo).toBe('AetherCreator/SuperClaude')
    }
  })

  it('missing-field.md → blocked_schema (fails at parse layer, evidence not called)', async () => {
    const r = await validateComplete(load('missing-field.md'), env)
    expect(r.verdict).toBe('blocked_schema')
    if (r.verdict === 'blocked_schema') {
      const allIssues = r.diagnosis.all_issues as Array<{ path: unknown[] }>
      expect(allIssues.some(i => Array.isArray(i.path) && i.path.includes('work_repo'))).toBe(
        true,
      )
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

  it('blocked-empty-flags.md → blocked_blocked_empty_flags', async () => {
    const r = await validateComplete(load('blocked-empty-flags.md'), env)
    expect(r.verdict).toBe('blocked_blocked_empty_flags')
  })
})

describe('H3 pre-flip fix (2026-05-24) — frontmatter + natural-language verify_log', () => {
  it('valid-frontmatter-wrapped.md → applied (frontmatter `---` extracted, body ignored)', async () => {
    const r = await validateComplete(load('valid-frontmatter-wrapped.md'), env)
    expect(r.verdict).toBe('applied')
    if (r.verdict === 'applied') {
      expect(r.parsed.hunt).toBe('gamma-v1')
      expect(r.parsed.clue).toBe(2)
      expect(r.parsed.verify_log).toHaveLength(3)
    }
  })

  it('valid-natural-verify-log.md → applied (em-dash + "ok" entries accepted as natural language)', async () => {
    const r = await validateComplete(load('valid-natural-verify-log.md'), env)
    expect(r.verdict).toBe('applied')
    if (r.verdict === 'applied') {
      // 4 entries provided; canonical regex matches 2 of them ("...: 200 ..." and one machine-readable id line)
      // Natural-language entries (em-dash separator) are accepted without failing the validator.
      expect(r.parsed.verify_log).toHaveLength(4)
    }
  })

  it('blocked-blank-verify-entry.md → blocked_verify_log_malformed (blank string trips the floor)', async () => {
    const r = await validateComplete(load('blocked-blank-verify-entry.md'), env)
    expect(r.verdict).toBe('blocked_verify_log_malformed')
    if (r.verdict === 'blocked_verify_log_malformed') {
      const idx = r.diagnosis.malformed_indices as number[]
      // Entry at index 2 is the empty string — that's the blocking one.
      // (Indices 0, 1 ("ok", "abc") are also < 5 chars, so all three short ones block.)
      expect(idx).toContain(2)
      expect(idx.length).toBeGreaterThanOrEqual(1)
    }
  })

  it('extractFrontmatter is forgiving: raw-YAML fixture (no `---`) still parses identically', async () => {
    // valid-hunter.md is raw YAML with no frontmatter delimiters — must keep working.
    const r = await validateComplete(load('valid-hunter.md'), env)
    expect(r.verdict).toBe('applied')
  })
})

