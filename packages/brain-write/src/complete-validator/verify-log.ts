// V4 verify-log parse — H3 pre-flip 2026-05-24 loosened to accept both:
//
// Canonical machine entry shape (hunter-emitted, parsed into ParsedEntry):
//   "<cmd>: exit=<code> <summary>"
//   "<cmd>: <code> <summary>"   (legacy form, also parsed)
//
// Natural-language entry (Chat-Opus / Carpenter / human-authored):
//   any non-empty string ≥ 5 chars
//
// Pre-fix the validator failed on natural-language entries (em-dash separator,
// "ok" instead of "exit=0", etc.), producing blocked_verify_log_malformed
// false-negatives across quest-log + eval-synthetic hunts. The strict pattern
// over-constrained the contract for the actual range of authoring surfaces.
//
// Now the validator only fails if entries are blank/trivially-short. The
// structured parser remains for machine-emitted entries that downstream
// consumers (D1 cross-source, audit trail) can still cheaply parse.

const ENTRY_PATTERN = /^(.+?):\s*(?:exit=)?(-?\d+)\s+(.+)$/
const MIN_ENTRY_LEN = 5

export interface ParsedEntry {
  cmd: string
  exit_code: number
  summary: string
}

export type VerifyLogResult =
  | { ok: true; parsed: ParsedEntry[]; informational_malformed: number[] }
  | { ok: false; malformed: number[]; parsed: ParsedEntry[] }

export function parseVerifyLog(entries: string[]): VerifyLogResult {
  const parsed: ParsedEntry[] = []
  const informational_malformed: number[] = []
  const blocking_malformed: number[] = []

  entries.forEach((entry, idx) => {
    // Blocking failure: trivially short / blank / non-string-ish content.
    if (typeof entry !== 'string' || entry.trim().length < MIN_ENTRY_LEN) {
      blocking_malformed.push(idx)
      return
    }
    // Opportunistic structured parse for machine-emitted entries.
    const m = entry.match(ENTRY_PATTERN)
    if (m) {
      parsed.push({
        cmd: m[1].trim(),
        exit_code: parseInt(m[2], 10),
        summary: m[3].trim(),
      })
    } else {
      // Natural-language entry — log informationally, do not fail.
      informational_malformed.push(idx)
    }
  })

  if (blocking_malformed.length > 0) {
    return { ok: false, malformed: blocking_malformed, parsed }
  }
  return { ok: true, parsed, informational_malformed }
}
