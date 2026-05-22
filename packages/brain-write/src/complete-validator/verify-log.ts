// V4 verify-log parse — structural-only, no replay.
//
// Canonical entry shape: "<cmd>: exit=<code> <summary>"
// Legacy accepted:      "<cmd>: <code> <summary>"
// Anything else flagged as malformed.

const ENTRY_PATTERN = /^(.+?):\s*(?:exit=)?(-?\d+)\s+(.+)$/

export interface ParsedEntry {
  cmd: string
  exit_code: number
  summary: string
}

export type VerifyLogResult =
  | { ok: true; parsed: ParsedEntry[] }
  | { ok: false; malformed: number[]; parsed: ParsedEntry[] }

export function parseVerifyLog(entries: string[]): VerifyLogResult {
  const parsed: ParsedEntry[] = []
  const malformed: number[] = []
  entries.forEach((entry, idx) => {
    const m = entry.match(ENTRY_PATTERN)
    if (!m) {
      malformed.push(idx)
      return
    }
    parsed.push({
      cmd: m[1].trim(),
      exit_code: parseInt(m[2], 10),
      summary: m[3].trim(),
    })
  })
  if (malformed.length > 0) return { ok: false, malformed, parsed }
  return { ok: true, parsed }
}
