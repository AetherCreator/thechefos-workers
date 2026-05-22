// COMPLETE.md validator — entry point.
//
// C1 ships: V1 schema + V4 verify-log parse + V5 strict + H2 deltas
//           (placeholder rejection, BLOCKED-flags semantics).
// C2 ships: V2 status-evidence coherence + V3 push verification + D1 cross-source SHA.
// C3 ships: webhook integration + COMPLETE_VALIDATOR_DRY_RUN gate + audit trail.

import { parse as parseYaml } from 'yaml'
import type { ZodIssue } from 'zod'
import { CompleteSchema } from './schema'
import { parseVerifyLog } from './verify-log'
import { inferAgent } from './agent'
import type { BlockedCode, ValidatorEnv, ValidatorVerdict } from './types'

/**
 * Classify a set of zod issues into the most specific BlockedCode.
 * Scans all issues (not just the first) so that, e.g., a value that
 * fails both the placeholder refine AND the SHA regex gets classified
 * as `blocked_placeholder` rather than the generic `blocked_schema`.
 *
 * Priority (most-specific first):
 *   1. blocked_fictional_field   — zod-strict "Unrecognized key"
 *   2. blocked_placeholder       — message mentions placeholder/__will_be_filled
 *   3. blocked_blocked_empty_flags — BLOCKED + empty flags refine
 *   4. blocked_schema            — fallthrough for any other shape failure
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

export async function validateComplete(
  yamlText: string,
  _env: ValidatorEnv,
): Promise<ValidatorVerdict> {
  // 1. YAML parse
  let raw: unknown
  try {
    raw = parseYaml(yamlText)
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

  // 4. Agent inference (informs C2 D1 lookup and C3 audit trail)
  const agent = inferAgent(parsed)

  // 5. Substrate checks (V2 + V3 + D1) deferred to C2.
  //    C2 replaces this stub with `await checkEvidence(parsed, _env)`.
  return { verdict: 'partial_pending_evidence', parsed, agent }
}

// Re-exports for downstream consumers (C2, C3, C5)
export { CompleteSchema } from './schema'
export type { CompleteSchemaType } from './schema'
export type { Agent, BlockedCode, ValidatorEnv, ValidatorVerdict } from './types'
