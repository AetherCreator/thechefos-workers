// C2.2 required-mode consult — getRuntimeVerdict() D1 reader.
// Design A (replay-driven): a FAIL row blocks; an absent row / unbound D1 returns null
// (never blocks — first delivery is advisory).
import { describe, it, expect } from 'vitest'
import { getRuntimeVerdict as getRV } from '../../src/runtime-verdict/handler'

type Row = { all_pass: number; total: number; passed: number; failed: number } | null
function fakeDb(row: Row) {
  return {
    SUPERCLAUDE_BRAIN: {
      prepare: () => ({
        bind: () => ({ first: async () => row }),
      }),
    } as unknown as D1Database,
  }
}

describe('C2.2 — getRuntimeVerdict (required-mode consult)', () => {
  it('FAIL row (all_pass=0) is returned → caller blocks', async () => {
    const env = fakeDb({ all_pass: 0, total: 3, passed: 2, failed: 1 })
    const rv = await getRV(env, 'h', '1', 'a'.repeat(40))
    expect(rv).not.toBeNull()
    expect(rv!.all_pass).toBe(0)
    expect(rv!.failed).toBe(1)
  })

  it('PASS row (all_pass=1) is returned → caller proceeds', async () => {
    const env = fakeDb({ all_pass: 1, total: 3, passed: 3, failed: 0 })
    const rv = await getRV(env, 'h', '1', 'a'.repeat(40))
    expect(rv!.all_pass).toBe(1)
  })

  it('absent row → null (first delivery, advisory)', async () => {
    const rv = await getRV(fakeDb(null), 'h', '1', 'a'.repeat(40))
    expect(rv).toBeNull()
  })

  it('unbound D1 → null (never blocks)', async () => {
    const rv = await getRV({}, 'h', '1', 'a'.repeat(40))
    expect(rv).toBeNull()
  })
})
