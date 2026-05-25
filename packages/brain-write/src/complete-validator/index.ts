// COMPLETE.md validator — entry point.
//
// C1: V1 schema + V4 verify-log parse + V5 strict + H2 deltas
//     (placeholder rejection, BLOCKED-flags semantics).
// C2: V2 status-evidence + V3 push verification + D1 cross-source SHA (this clue).
// C3: webhook integration + COMPLETE_VALIDATOR_DRY_RUN gate + audit trail.

import { parse as parseYaml } from 'yaml'
import type { ZodIssue } from 'zod'
import { CompleteSchema } from './schema'
import { parseVerifyLog } from './verify-log'
import { inferAgent } from './agent'
import { checkEvidence } from './evidence'
import type { BlockedCode, ValidatorEnv, ValidatorVerdict } from './types'

/**
 * Classify a set of zod issues into the most specific BlockedCode.
 * Scans all issues (not just the first) so that, e.g., a value that
 * fails both the placeholder refine AND the SHA regex gets classified
 * as `blocked_placeholder` rather than the generic `blocked_schema`.
 *
 * Priority (most-specific first):
 *   1. blocked_fictional_field     — zod-strict "unrecognized_keys"
 *   2. blocked_placeholder         — message mentions placeholder/__will_be_filled
 *   3. blocked_blocked_empty_flags — BLOCKED + empty flags refine
 *   4. blocked_schema              — fallthrough for any other shape failure
 */
function classifyZodIssues(issues: readonly ZodIssue[]): BlockedCode {
  for (const issue of issues) {
    if (issue.code === 'unrecognized_keys') return 'blocked_fictional_field'
  }
  for (const issue of issues) {
    if (/placeholder|__will_be_filled/i.test(issue.message)) return 'blocked_placeholder'
  }
  for (const issue of issues) {
    if (
      Array.isArray(issue.path) &&
      issue.path.includes('flags') &&
      /BLOCKED/.test(issue.message)
    ) {
      return 'blocked_blocked_empty_flags'
    }
  }
  return 'blocked_schema'
}

/**
 * H3 pre-flip fix (2026-05-24): Accept COMPLETE.md input as either:
 *   (a) raw YAML (fixture-shaped, machine-emitted, no `---` delimiters)
 *   (b) markdown frontmatter shape `---\n<YAML>\n---\n<body>` (human-authored)
 *
 * Pre-fix the validator used `parseYaml()` single-doc mode on (b), which dies
 * with "Source contains multiple documents" because the trailing `---` reads
 * as a YAML document separator. All 4 P4 quest-log COMPLETE.mds blocked_schema
 * on this false-negative class.
 *
 * Extraction is forgiving: if input doesn't open with `---\n`, returns input
 * unchanged so raw-YAML fixtures keep working. If `---` opens but no closing
 * `---` found, also returns input unchanged (single-doc YAML with a stray
 * leading separator is the YAML parser's problem, not ours to second-guess).
 */
function extractFrontmatter(input: string): string {
  // Match leading `---` + newline (LF or CRLF), then capture until the next
  // line that is just `---` (with optional trailing newline). The capture group
  // is the YAML content; everything after the closing `---` is markdown body.
  const m = input.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)
  if (m) return m[1]
  return input
}

export async function validateComplete(
  yamlText: string,
  env: ValidatorEnv,
): Promise<ValidatorVerdict> {
  // 1. YAML parse — extract frontmatter first for human-authored COMPLETE.mds
  let raw: unknown
  const yamlOnly = extractFrontmatter(yamlText)
  try {
    raw = parseYaml(yamlOnly)
  } catch (e) {
    return {
      verdict: 'blocked_schema',
      code: 'blocked_schema',
      message: 'COMPLETE.md is not valid YAML',
      diagnosis: { yaml_error: e instanceof Error ? e.message : String(e) },
    }
  }

  if (raw === null || raw === undefined || typeof raw !== 'object') {
    return {
      verdict: 'blocked_schema',
      code: 'blocked_schema',
      message: 'COMPLETE.md YAML must be a mapping at the top level',
      diagnosis: { actual_type: raw === null ? 'null' : typeof raw },
    }
  }

  // 2. V1 + V5 (strict) + placeholder + BLOCKED-flags refinement
  const parseResult = CompleteSchema.safeParse(raw)
  if (!parseResult.success) {
    const issues = parseResult.error.issues
    const code = classifyZodIssues(issues)
    const head = issues[0]
    return {
      verdict: code,
      code,
      message: head ? head.message : 'schema validation failed',
      diagnosis: {
        path: head?.path,
        issue_code: head?.code,
        all_issues: issues.map(i => ({ path: i.path, code: i.code, message: i.message })),
      },
    }
  }
  const parsed = parseResult.data

  // 3. V4 verify-log parse
  const v4 = parseVerifyLog(parsed.verify_log)
  if (!v4.ok) {
    return {
      verdict: 'blocked_verify_log_malformed',
      code: 'blocked_verify_log_malformed',
      message: `verify_log entries at indices ${v4.malformed.join(', ')} do not match canonical pattern (<cmd>: exit=<code> <summary>)`,
      diagnosis: { malformed_indices: v4.malformed, entries: parsed.verify_log },
    }
  }

  // 4. Agent inference (informs D1 cross-source check + C3 audit trail)
  const agent = inferAgent(parsed)

  // 5. V2 + V3 + D1 substrate checks
  const evidence = await checkEvidence(parsed, env)
  if (!evidence.ok) {
    return {
      verdict: evidence.code,
      code: evidence.code,
      message: evidence.message,
      diagnosis: evidence.diagnosis,
    }
  }

  return { verdict: 'applied', parsed, agent }
}

// Re-exports for downstream consumers (C3, C5)
export { CompleteSchema } from './schema'
export type { CompleteSchemaType } from './schema'
export type { Agent, BlockedCode, ValidatorEnv, ValidatorVerdict } from './types'
export { checkEvidence } from './evidence'
export type { EvidenceResult } from './evidence'
