// COMPLETE.md schema — V1 (shape) + V5 (no unknown keys via strict) + H2 deltas
// (placeholder rejection from H2 SubDiv #6, BLOCKED-flags semantics from H2 Seed 5)
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
    verify_log: z.array(z.string()).min(1, 'verify_log must have at least 1 entry'),
    evidence_urls: z.array(NotPlaceholder),
    flags: z.array(z.string()),
    notes: z.string(),
    agent: z.enum(['carpenter', 'hunter', 'claude-code', 'chat-opus', 'conductor', 'unknown']).optional(),
    run_id: z.string().optional(),
  })
  .strict() // V5: zod rejects unknown keys (fictional-field detection)
  .refine(d => !(d.status === 'BLOCKED' && d.flags.length === 0), {
    message: 'BLOCKED status requires non-empty flags[]',
    path: ['flags'],
  })

export type CompleteSchemaType = z.infer<typeof CompleteSchema>

export { PLACEHOLDER_PATTERN }
