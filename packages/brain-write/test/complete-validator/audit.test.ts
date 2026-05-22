import { describe, it, expect } from 'vitest'
import { buildAuditEntry } from '../../src/complete-validator/audit'
import type { CompleteSchemaType } from '../../src/complete-validator/schema'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const baseParsed: CompleteSchemaType = {
  hunt: 'carpenter-h3-validator',
  clue: 4,
  agent: 'carpenter',
  status: 'complete',
  run_id: 'real-uuid-here',
  evidence: [],
}

const push = { after: 'deadbeef', repo: 'AetherCreator/SuperClaude' }
const file = 'hunts/carpenter-h3-validator/clue-4/COMPLETE.md'

describe('buildAuditEntry run_id fallback', () => {
  it('uses run_id from parsed when non-empty', () => {
    const entry = buildAuditEntry({ verdict: 'applied' }, baseParsed, 'carpenter', file, push, false)
    expect(entry.run_id).toBe('real-uuid-here')
  })

  it('generates a UUID when run_id is empty string (regression: was producing ".json" filename)', () => {
    const parsed = { ...baseParsed, run_id: '' }
    const entry = buildAuditEntry({ verdict: 'applied' }, parsed, 'carpenter', file, push, false)
    expect(entry.run_id).not.toBe('')
    expect(entry.run_id).toMatch(UUID_RE)
  })

  it('generates a UUID when run_id is whitespace-only', () => {
    const parsed = { ...baseParsed, run_id: '   ' }
    const entry = buildAuditEntry({ verdict: 'applied' }, parsed, 'carpenter', file, push, false)
    expect(entry.run_id).toMatch(UUID_RE)
  })

  it('generates a UUID when parsed is null', () => {
    const entry = buildAuditEntry({ verdict: 'applied' }, null, 'carpenter', file, push, false)
    expect(entry.run_id).toMatch(UUID_RE)
  })
})

describe('buildAuditEntry claimed_run_id (H3 v1.1 SubDiv #3)', () => {
  const blockedResult = { verdict: 'blocked_placeholder' } as const

  it('preserves claimed_run_id on blocked verdict; audit run_id stays a fresh UUID', () => {
    const entry = buildAuditEntry(
      blockedResult,
      null,
      'unknown',
      file,
      push,
      false,
      'deadbeef-cafe-1234',
    )
    expect(entry.claimed_run_id).toBe('deadbeef-cafe-1234')
    expect(entry.run_id).not.toBe('deadbeef-cafe-1234')
    expect(entry.run_id).toMatch(UUID_RE)
  })

  it('omits claimed_run_id when none supplied', () => {
    const entry = buildAuditEntry(blockedResult, null, 'unknown', file, push, false)
    expect(entry.claimed_run_id).toBeUndefined()
  })

  it('treats empty/whitespace claimedRunId as absent', () => {
    const e1 = buildAuditEntry(blockedResult, null, 'unknown', file, push, false, '')
    const e2 = buildAuditEntry(blockedResult, null, 'unknown', file, push, false, '   ')
    expect(e1.claimed_run_id).toBeUndefined()
    expect(e2.claimed_run_id).toBeUndefined()
  })

  it('flows through on applied verdict alongside parsed-derived audit run_id', () => {
    const entry = buildAuditEntry(
      { verdict: 'applied' },
      baseParsed,
      'carpenter',
      file,
      push,
      false,
      'claimed-from-source',
    )
    expect(entry.run_id).toBe('real-uuid-here')
    expect(entry.claimed_run_id).toBe('claimed-from-source')
  })
})
