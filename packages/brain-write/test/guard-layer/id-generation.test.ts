import { describe, it, expect } from 'vitest'
import {
  generateActionId,
  deriveIdempotencyKey,
} from '../../src/guard-layer/id-generation'

describe('generateActionId', () => {
  it('matches the documented format', () => {
    const ts = new Date('2026-05-16T03:14:22Z')
    const id = generateActionId('ops-board-agent', 'OPS-ABC', ts)
    expect(id).toBe('auto-20260516T031422Z-ops-ops-abc')
  })

  it('strips disallowed characters from target', () => {
    const ts = new Date('2026-05-16T08:05:00Z')
    const id = generateActionId(
      'locke-changelog-watcher',
      'CF SDK v4!',
      ts,
    )
    expect(id).toMatch(/^auto-\d{8}T\d{6}Z-lcw-cf-sdk-v4$/)
  })

  it('uses the 3-letter actor short codes', () => {
    const ts = new Date('2026-05-16T11:20:00Z')
    expect(generateActionId('xp-middleware', 'mastro', ts)).toContain('-xpm-')
    expect(generateActionId('voyage-worker', 'voyage-abc', ts)).toContain('-voy-')
    expect(generateActionId('manual', 'tyler-direct', ts)).toContain('-man-')
  })
})

describe('deriveIdempotencyKey', () => {
  it('is deterministic for identical input', async () => {
    const trigger = {
      type: 'github_webhook' as const,
      details: { commit: 'abc123' },
    }
    const action = {
      type: 'ops_board_promote' as const,
      target: 'OPS-ABC',
      params: { from: 'ACTIVE', to: 'COMPLETED' },
    }
    const k1 = await deriveIdempotencyKey(trigger, action)
    const k2 = await deriveIdempotencyKey(trigger, action)
    expect(k1).toBe(k2)
    expect(k1).toHaveLength(64)
    expect(k1).toMatch(/^[0-9a-f]{64}$/)
  })

  it('produces same key when params are reordered', async () => {
    const trigger = {
      type: 'github_webhook' as const,
      details: { commit: 'abc', file: 'x.md' },
    }
    const reordered = {
      type: 'github_webhook' as const,
      details: { file: 'x.md', commit: 'abc' },
    }
    const action = {
      type: 'ops_board_promote' as const,
      target: 'OPS-Z',
      params: { to: 'COMPLETED', from: 'ACTIVE' },
    }
    const k1 = await deriveIdempotencyKey(trigger, action)
    const k2 = await deriveIdempotencyKey(reordered, action)
    expect(k1).toBe(k2)
  })

  it('produces different key for different commit (real-world retry vs new push)', async () => {
    const action = {
      type: 'ops_board_promote' as const,
      target: 'OPS-ABC',
      params: { from: 'ACTIVE', to: 'COMPLETED' },
    }
    const k1 = await deriveIdempotencyKey(
      { type: 'github_webhook', details: { commit: 'abc' } },
      action,
    )
    const k2 = await deriveIdempotencyKey(
      { type: 'github_webhook', details: { commit: 'def' } },
      action,
    )
    expect(k1).not.toBe(k2)
  })

  it('ignores evidence_url when computing key (drift-tolerant)', async () => {
    const trigger = { type: 'manual' as const, details: {} }
    const k1 = await deriveIdempotencyKey(trigger, {
      type: 'brain_write',
      target: 'path/x.md',
      params: {},
      evidence_url: 'https://a',
    })
    const k2 = await deriveIdempotencyKey(trigger, {
      type: 'brain_write',
      target: 'path/x.md',
      params: {},
      evidence_url: 'https://b',
    })
    expect(k1).toBe(k2)
  })
})
