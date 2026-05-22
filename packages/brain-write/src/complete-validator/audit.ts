// Audit trail emission for complete-validator verdicts.
//
// Mirrors guard-layer/evidence.ts:writeEvidence pattern. Distinct `type` field
// ('complete_validator') lets the Reflection Worker filter validator entries
// from Guard Layer entries even though both share the same directory.
//
// Audit trail path scheme:
//   brain/06-meta/auto-actions/<YYYY-MM-DD>/<run-id>.json
//
// Auditing is *unconditional* — fires for both dry-run and enforce. Only the
// downstream halt + Ship's Doctor ping are gated by dry-run.

import type { CompleteSchemaType } from './schema'
import type { Agent, ValidatorVerdict } from './types'

const REPO_OWNER = 'AetherCreator'
const REPO_NAME = 'SuperClaude'
const GITHUB_API = 'https://api.github.com'
const COMMITTER = {
  name: 'SuperClaude Brain Ops',
  email: 'brain-ops@thechefos.app',
}

export interface AuditTrailEntry {
  type: 'complete_validator'
  timestamp: string // ISO 8601 UTC
  run_id: string // from COMPLETE.md run_id field or generated
  hunt: string
  clue: number
  agent: Agent
  verdict: string // 'applied' | 'blocked_*'
  dry_run: boolean
  diagnosis: Record<string, unknown>
  file: string // e.g. "hunts/carpenter-foundation/clue-5/COMPLETE.md"
  push_sha: string // push.after
  push_repo: string // e.g. "AetherCreator/SuperClaude"
}

export interface AuditEnv {
  GITHUB_TOKEN: string
}

function extractHuntFromPath(file: string): string {
  const m = file.match(/^hunts\/([^/]+)\/clue-[^/]+\/COMPLETE\.md$/)
  return m?.[1] ?? 'unknown'
}

function extractClueFromPath(file: string): number {
  const m = file.match(/^hunts\/[^/]+\/clue-(\d+)\/COMPLETE\.md$/)
  return m ? parseInt(m[1], 10) : 0
}

/** Build the audit entry. Tolerant of missing `parsed` (which happens when
 *  the validator rejects before YAML parse succeeds, e.g. malformed YAML). */
export function buildAuditEntry(
  result: ValidatorVerdict,
  parsed: CompleteSchemaType | null,
  agent: Agent,
  file: string,
  push: { after: string; repo: string },
  dryRun: boolean,
): AuditTrailEntry {
  const diagnosis = 'diagnosis' in result ? result.diagnosis : {}
  // Best-effort run_id: COMPLETE.md field, then a fresh UUID. Including push.after
  // would force per-push uniqueness, but it'd also tie the audit row to the push
  // SHA which makes filtering harder. UUID per run is the spec-conformant move.
  const runId = parsed?.run_id?.trim() || crypto.randomUUID()
  return {
    type: 'complete_validator',
    timestamp: new Date().toISOString(),
    run_id: runId,
    hunt: parsed?.hunt ?? extractHuntFromPath(file),
    clue: parsed?.clue ?? extractClueFromPath(file),
    agent,
    verdict: result.verdict,
    dry_run: dryRun,
    diagnosis,
    file,
    push_sha: push.after,
    push_repo: push.repo,
  }
}

export interface CommitAuditResult {
  ok: boolean
  path: string
  commit_sha?: string
  error?: string
}

/**
 * Write the audit entry to brain/06-meta/auto-actions/<date>/<run-id>.json
 * via GitHub Contents API PUT. Treats the file as create-only — if it
 * already exists (idempotency replay), GitHub 422s and we surface that
 * distinctly rather than overwriting.
 */
export async function commitAuditEntry(
  entry: AuditTrailEntry,
  env: AuditEnv,
): Promise<CommitAuditResult> {
  const date = entry.timestamp.slice(0, 10)
  const path = `brain/06-meta/auto-actions/${date}/${entry.run_id}.json`
  const content = JSON.stringify(entry, null, 2)
  const contentBase64 = btoa(unescape(encodeURIComponent(content)))
  const message = `audit: complete_validator ${entry.verdict} for ${entry.hunt}/clue-${entry.clue} (${entry.dry_run ? 'dry-run' : 'enforce'})`

  const url = `${GITHUB_API}/repos/${REPO_OWNER}/${REPO_NAME}/contents/${path}`
  const headers: Record<string, string> = {
    Authorization: `Bearer ${env.GITHUB_TOKEN}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'thechefos-workers-complete-validator/1.0',
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json',
  }

  try {
    const res = await fetch(url, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ message, content: contentBase64, committer: COMMITTER }),
    })
    if (res.ok) {
      const data = (await res.json()) as { commit?: { sha?: string } }
      return { ok: true, path, commit_sha: data?.commit?.sha }
    }
    if (res.status === 422) {
      // Likely "sha required" because the path already exists (replay/dup).
      return { ok: true, path, error: 'audit_file_already_exists' }
    }
    const detail = await res.text()
    return {
      ok: false,
      path,
      error: `github_${res.status}: ${detail.slice(0, 200)}`,
    }
  } catch (e) {
    return { ok: false, path, error: e instanceof Error ? e.message : String(e) }
  }
}
