// COMPLETE.md validator — entry point.
//
// C1: V1 schema + V4 verify-log parse + V5 strict + H2 deltas
//     (placeholder rejection, BLOCKED-flags semantics).
// C2: V2 status-evidence + V3 push verification + D1 cross-source SHA + reproduction pass.
//     Reproduction pass: for object verify_log entries {cmd,expect,claim}, re-executes
//     each cmd against origin@work_commit via GitHub API. Mismatch => blocked_verify_log_reproduction_failed.
//     Auto-files grok-verify-failed OPS row on rejection (soft-degrade, never re-blocks).
// C3: webhook integration + COMPLETE_VALIDATOR_DRY_RUN gate + audit trail.
// C2 Guard Layer hook: fireXpGrantHook added after evidence check (soft-degrade, never blocks verdict)

import { parse as parseYaml } from 'yaml'
import type { ZodIssue } from 'zod'
import { CompleteSchema } from './schema'
import type { VerifyLogObjectEntry } from './schema'
import { parseVerifyLog } from './verify-log'
import { inferAgent } from './agent'
import { checkEvidence } from './evidence'
import { fireXpGrantHook } from './xp-grant-hook'
import { reproduceEntries } from './reproduce'
import { fileGrokVerifyFailed } from './gvh-ops-filer'
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

  // 3. V4 verify-log parse (informational; schema already enforces shape)
  // After C2 schema change, this always returns ok:true — kept for audit trail.
  parseVerifyLog(parsed.verify_log)

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

  // 6. C2 reproduction pass — re-execute object verify_log entries against origin@work_commit.
  // String entries use legacy V4 path (no re-execution). Object entries are the C2 format.
  const objectEntries = parsed.verify_log.filter(
    (e): e is VerifyLogObjectEntry => typeof e === 'object' && e !== null,
  )
  if (objectEntries.length > 0) {
    const repro = await reproduceEntries(objectEntries, parsed.work_repo, parsed.work_commit, env)
    if (repro.verdict === 'REJECTED') {
      // Auto-file OPS row — soft-degrade: never blocks the rejection verdict itself
      fileGrokVerifyFailed(env, {
        hunt: parsed.hunt,
        clue: parsed.clue,
        work_commit: parsed.work_commit,
        failing_entry: repro.failing_entry!,
      }).catch(err => console.error('[gvh-ops-filer] soft-fail:', String(err)))

      const fe = repro.failing_entry!
      return {
        verdict: 'blocked_verify_log_reproduction_failed',
        code: 'blocked_verify_log_reproduction_failed',
        message: `verify_log cmd failed re-execution: ${fe.cmd}`,
        diagnosis: {
          cmd: fe.cmd,
          expect: fe.expect,
          claim: fe.claim,
          actual_exit: fe.actual_exit,
          actual_stdout: fe.actual_stdout,
          detail: fe.detail,
          wall_ms: repro.wall_ms,
        },
      }
    }
  }

  // C2 Guard Layer hook — AFTER evidence/audit + reproduction, BEFORE response return
  // Soft-degrade: any failure is logged but NEVER blocks the 'applied' verdict
  await fireXpGrantHook(env as any, parsed, agent)

  return { verdict: 'applied', parsed, agent }
}

// Re-exports for downstream consumers (C3, C5)
export { CompleteSchema } from './schema'
export type { CompleteSchemaType } from './schema'
export type { Agent, BlockedCode, ValidatorEnv, ValidatorVerdict } from './types'
export { checkEvidence } from './evidence'
export type { EvidenceResult } from './evidence'
