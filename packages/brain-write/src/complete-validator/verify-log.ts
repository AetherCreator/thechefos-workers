// V4 verify-log parse — H3 pre-flip 2026-05-24 loosened to accept both:
//
// Canonical machine entry shape (hunter-emitted, parsed into ParsedEntry):
//   "<cmd>: exit=<code> <summary>"
//   "<cmd>: <code> <summary>"   (legacy form, also parsed)
//
// Natural-language entry (Chat-Opus / Carpenter / human-authored):
//   any non-empty string ≥ 5 chars
//
// C2 delta: verify_log entries are now a union of string | {cmd, expect, claim} objects.
// The schema (zod) enforces: strings ≥ 5 chars OR strict {cmd, expect, claim} objects.
// Blank/short strings are rejected at schema level (blocked_schema), not here.
// Object entries (the C2 machine-executable format) are always valid at parse level —
// the reproduction pass in index.ts handles them.
//
// This function is now informational-only for the V4 structured parse (audit trail,
// agent heuristic). It always returns ok:true because the schema already enforces shape.

import type { VerifyLogObjectEntry } from './schema'

const ENTRY_PATTERN = /^(.+?):\s*(?:exit=)?(-?\d+)\s+(.+)$/

export interface ParsedEntry {
  cmd: string
  exit_code: number
  summary: string
}

export type VerifyLogResult =
  | { ok: true; parsed: ParsedEntry[]; informational_malformed: number[]; object_entry_count: number }
  | { ok: false; malformed: number[]; parsed: ParsedEntry[] }

export function parseVerifyLog(entries: (string | VerifyLogObjectEntry)[]): VerifyLogResult {
  const parsed: ParsedEntry[] = []
  const informational_malformed: number[] = []
  let object_entry_count = 0

  entries.forEach((entry, idx) => {
    if (typeof entry === 'object' && entry !== null) {
      // C2 object entry — valid by schema; reproduction pass handles it; count for audit
      object_entry_count++
      return
    }
    // String entry — schema guarantees >= 5 chars by this point
    const m = entry.match(ENTRY_PATTERN)
    if (m) {
      parsed.push({
        cmd: m[1].trim(),
        exit_code: parseInt(m[2], 10),
        summary: m[3].trim(),
      })
    } else {
      informational_malformed.push(idx)
    }
  })

  return { ok: true, parsed, informational_malformed, object_entry_count }
}
