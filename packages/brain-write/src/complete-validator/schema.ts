// COMPLETE.md schema — V1 (shape) + V5 (no unknown keys via strict) + H2 deltas + C2 (object verify_log)
// (placeholder rejection from H2 SubDiv #6, BLOCKED-flags semantics from H2 Seed 5)
//
// C2 delta: verify_log entries accept either the legacy string format (natural-language,
// >= 5 chars) OR the new C2 object format { cmd, expect, claim } (machine-executable).
// Object entries trigger the reproduction pass in index.ts. String entries use legacy V4 parse.
//
// Notes:
//   - NotPlaceholder is checked BEFORE the SHA regex so placeholder values
//     produce a placeholder-specific issue (not a generic "not 40 hex" one).
//     index.ts classifier scans all zod issues and picks the most specific.
//   - work_commit / hunt_commit are wrapped in a preprocess that stringifies
//     yaml-parsed numbers/bigints. Unquoted all-numeric SHAs (or all-zero) are
//     parsed as numbers by yaml; this preprocess yields a clean "not 40 hex"
//     diagnosis rather than a confusing "Expected string, received number".

import { z } from 'zod'

const PLACEHOLDER_PATTERN = /__will_be_filled/i

const coerceShaString = z.preprocess(v => {
  if (typeof v === 'number' || typeof v === 'bigint') return String(v)
  return v
}, z.string())

const Sha40NotPlaceholder = coerceShaString
  .refine(s => !PLACEHOLDER_PATTERN.test(s), {
    message: 'placeholder forbidden (__will_be_filled_*)',
  })
  .refine(s => /^[a-f0-9]{40}$/.test(s), {
    message: 'must be 40-char hex SHA',
  })

const Sha40Optional = coerceShaString
  .refine(s => /^[a-f0-9]{40}$/.test(s), {
    message: 'must be 40-char hex SHA',
  })
  .optional()

const NotPlaceholder = z.string().refine(s => !PLACEHOLDER_PATTERN.test(s), {
  message: 'placeholder string forbidden (__will_be_filled_*)',
})

const OwnerRepo = z
  .string()
  .regex(/^[^/]+\/[^/]+$/, 'must be owner/repo format')

export const CompleteSchema = z
  .object({
    hunt: z.string().min(1),
    clue: z.number().int().positive(),
    status: z.enum(['COMPLETE', 'PARTIAL', 'BLOCKED']),
    work_repo: OwnerRepo,
    work_commit: Sha40NotPlaceholder,
    hunt_repo: OwnerRepo,
    hunt_commit: Sha40Optional,
    verify_log: z.array(
      z.union([
        // Legacy: natural-language string entry (V4 parse path, no re-execution)
        z.string().min(5, 'verify_log string entry must be at least 5 characters'),
        // C2: machine-executable object entry ({cmd, expect, claim} — triggers reproduction pass)
        z.object({
          cmd: z.string().min(1, 'cmd must not be empty'),
          expect: z.string().min(1, 'expect must not be empty'),
          claim: z.string().min(1, 'claim must not be empty'),
        }).strict(),
      ])
    ).min(1, 'verify_log must have at least 1 entry'),
    evidence_urls: z.array(NotPlaceholder),
    flags: z.array(z.string()),
    notes: z.string(),
    agent: z.enum(['carpenter', 'hunter', 'claude-code', 'chat-opus', 'conductor', 'grok', 'unknown']).optional(),
    run_id: z.string().optional(),
  })
  .strict() // V5: zod rejects unknown keys (fictional-field detection)
  .refine(d => !(d.status === 'BLOCKED' && d.flags.length === 0), {
    message: 'BLOCKED status requires non-empty flags[]',
    path: ['flags'],
  })

export type CompleteSchemaType = z.infer<typeof CompleteSchema>

// The structured verify_log entry shape (C2 format)
export const VerifyLogObjectEntrySchema = z.object({
  cmd: z.string().min(1),
  expect: z.string().min(1),
  claim: z.string().min(1),
}).strict()

export type VerifyLogObjectEntry = z.infer<typeof VerifyLogObjectEntrySchema>

export { PLACEHOLDER_PATTERN }
