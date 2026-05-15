import { describe, it, expect } from 'vitest'
import { canonicalize, sha256Hex } from '../../src/guard-layer/id-generation'

describe('canonicalize', () => {
  it('sorts keys alphabetically at every level', () => {
    const a = canonicalize({ b: 1, a: 2, c: { y: 1, x: 2 } })
    const b = canonicalize({ a: 2, b: 1, c: { x: 2, y: 1 } })
    expect(a).toBe(b)
    expect(a).toBe('{"a":2,"b":1,"c":{"x":2,"y":1}}')
  })

  it('elides null and undefined from objects', () => {
    const x = canonicalize({ a: 1, b: null, c: undefined, d: 2 })
    expect(x).toBe('{"a":1,"d":2}')
  })

  it('preserves arrays in order (positional)', () => {
    expect(canonicalize([3, 1, 2])).toBe('[3,1,2]')
  })

  it('produces identical hash for identical content with reordered keys', async () => {
    const k1 = await sha256Hex(canonicalize({ b: 1, a: 2 }))
    const k2 = await sha256Hex(canonicalize({ a: 2, b: 1 }))
    expect(k1).toBe(k2)
    expect(k1).toHaveLength(64)
  })

  it('NFC-normalizes Unicode in hash input', async () => {
    // 'é' NFC vs 'e' + combining acute (NFD) — should hash identically.
    const nfc = 'café'
    const nfd = 'café'
    expect(await sha256Hex(nfc)).toBe(await sha256Hex(nfd))
  })
})
