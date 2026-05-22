// COMPLETE.md evidence layer — V2 + V3 + D1 cross-source SHA verification.
//
// C1 ships the parse layer; this clue fills the substrate stub.
// After C2, validateComplete returns:
//   - { verdict: 'applied' }    when all six invariants hold
//   - { verdict: 'blocked_*' }  when any single check rejects
//
// Soft-skip discipline:
//   - PARTIAL status bypasses V3 (sandbox work is legitimate)
//   - D1 lookup soft-skips when CF token/account missing, when run_id absent,
//     when the run isn't in the table (eval runs, ad-hoc), or on transport failure.
//     A D1 outage must NOT false-block; D1 is corroborating evidence, not gating.

import type { CompleteSchemaType } from './schema'
import type { BlockedCode, ValidatorEnv } from './types'

const GITHUB_API = 'https://api.github.com'
const GITHUB_COMMIT_URL = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/commit\/([a-f0-9]{40})$/
const D1_SUPERCLAUDE_BRAIN = 'c9f55aaf-ac80-4111-b78e-9339a2f8e377'

type EvidenceOk = { ok: true }
type EvidenceBlocked = {
  ok: false
  code: BlockedCode
  message: string
  diagnosis: Record<string, unknown>
}
export type EvidenceResult = EvidenceOk | EvidenceBlocked

function block(
  code: BlockedCode,
  message: string,
  diagnosis: Record<string, unknown>,
): EvidenceBlocked {
  return { ok: false, code, message, diagnosis }
}

/**
 * V2 — status-evidence coherence.
 *   COMPLETE: at least one evidence URL must match the GitHub commit URL shape
 *   PARTIAL:  accepts anything (sandbox or github) — no rejection
 *   BLOCKED:  notes must be >= 20 chars (forces a real reason)
 */
function checkStatusEvidence(parsed: CompleteSchemaType): EvidenceResult {
  if (parsed.status === 'COMPLETE') {
    const hasGithubCommit = parsed.evidence_urls.some(u => GITHUB_COMMIT_URL.test(u))
    if (!hasGithubCommit) {
      return block(
        'blocked_status_evidence_mismatch',
        'COMPLETE status requires at least one GitHub commit URL in evidence_urls',
        { evidence_urls: parsed.evidence_urls },
      )
    }
  } else if (parsed.status === 'BLOCKED') {
    if (parsed.notes.trim().length < 20) {
      return block(
        'blocked_status_evidence_mismatch',
        'BLOCKED status requires notes describing the block (>= 20 chars)',
        { notes_length: parsed.notes.trim().length, notes: parsed.notes },
      )
    }
  }
  // PARTIAL: pass through
  return { ok: true }
}

/**
 * V3 — push verification via the GitHub API.
 * GET /repos/{owner}/{repo}/git/commits/{sha} returns 200 if the commit
 * is reachable from any ref on the origin repo. Non-200 means the SHA
 * is not on origin (the work was never pushed, or was pushed and rewritten).
 */
async function verifyCommitExists(
  repo: string,
  sha: string,
  token: string,
): Promise<{ ok: boolean; status: number; body?: unknown }> {
  const url = `${GITHUB_API}/repos/${repo}/git/commits/${sha}`
  try {
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'thechefos-workers-complete-validator/1.0',
      },
    })
    const remaining = parseInt(res.headers.get('x-ratelimit-remaining') ?? '99999', 10)
    if (Number.isFinite(remaining) && remaining < 100) {
      console.warn(`[complete-validator] GitHub rate-limit remaining: ${remaining}`)
    }
    if (res.status === 200) return { ok: true, status: 200 }
    if (res.status === 403) {
      const body = await res.json().catch(() => ({}))
      return { ok: false, status: 403, body }
    }
    // 404 / 422 / anything else → not on origin
    return { ok: false, status: res.status }
  } catch (e) {
    return {
      ok: false,
      status: -1,
      body: { fetch_error: e instanceof Error ? e.message : String(e) },
    }
  }
}

async function checkPushVerification(
  parsed: CompleteSchemaType,
  token: string,
): Promise<EvidenceResult> {
  // V3 only fires for COMPLETE status. PARTIAL is sandbox-legal; BLOCKED needs
  // no push verification (the block is the point).
  if (parsed.status !== 'COMPLETE') return { ok: true }

  // Verify work_commit on work_repo
  const v3work = await verifyCommitExists(parsed.work_repo, parsed.work_commit, token)
  if (!v3work.ok) {
    const body = v3work.body as { message?: string } | undefined
    if (v3work.status === 403 && body?.message?.toLowerCase().includes('rate limit')) {
      return block(
        'blocked_rate_limit',
        'GitHub API rate limit exhausted while verifying work_commit',
        { work_repo: parsed.work_repo, github_response: v3work.body },
      )
    }
    return block(
      'blocked_push_unverified',
      `work_commit ${parsed.work_commit} not found on origin ${parsed.work_repo}`,
      {
        github_status: v3work.status,
        work_repo: parsed.work_repo,
        work_commit: parsed.work_commit,
      },
    )
  }

  // Cross-repo: when hunt_commit is present AND hunt_repo differs from work_repo,
  // verify hunt_commit too. Same repo + same SHA is the common single-repo case
  // and doesn't need a second round-trip.
  if (parsed.hunt_commit && parsed.hunt_repo !== parsed.work_repo) {
    const v3hunt = await verifyCommitExists(parsed.hunt_repo, parsed.hunt_commit, token)
    if (!v3hunt.ok) {
      return block(
        'blocked_push_unverified',
        `hunt_commit ${parsed.hunt_commit} not found on origin ${parsed.hunt_repo}`,
        {
          github_status: v3hunt.status,
          hunt_repo: parsed.hunt_repo,
          hunt_commit: parsed.hunt_commit,
        },
      )
    }
  }

  return { ok: true }
}

/**
 * D1 cross-source SHA verification — H2 Seed 2.
 *
 * When agent === 'carpenter' AND run_id is set, the autonomous carpenter
 * runner is supposed to have logged the run to D1 carpenter_runs with the
 * same work_commit. If the D1 row exists and the SHA differs, the COMPLETE.md
 * is lying about its substrate (or the runner mis-logged — either is worth
 * blocking and investigating).
 *
 * Soft-skip cases (not blocking):
 *   - agent !== carpenter, or run_id absent → not a carpenter-runner job
 *   - CF token / account absent → D1 unreachable, can't corroborate
 *   - D1 transport failure → outage shouldn't false-block validator
 *   - run_id not in D1 → eval run, ad-hoc dispatch, or pre-D1 hunt
 */
async function checkD1ShaMatch(
  parsed: CompleteSchemaType,
  env: ValidatorEnv,
): Promise<EvidenceResult> {
  if (parsed.agent !== 'carpenter' || !parsed.run_id) return { ok: true }
  if (!env.CF_API_TOKEN || !env.CF_ACCOUNT_ID) return { ok: true }

  const url = `https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/d1/database/${D1_SUPERCLAUDE_BRAIN}/query`
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.CF_API_TOKEN}`,
        'Content-Type': 'application/json',
        'User-Agent': 'thechefos-workers-complete-validator/1.0',
      },
      body: JSON.stringify({
        sql: 'SELECT work_commit FROM carpenter_runs WHERE run_id = ?1 LIMIT 1',
        params: [parsed.run_id],
      }),
    })
    if (!res.ok) return { ok: true } // D1 unreachable → soft-skip

    const data = (await res.json().catch(() => null)) as {
      result?: Array<{ results?: Array<{ work_commit?: string }> }>
    } | null
    const rows = data?.result?.[0]?.results ?? []
    if (rows.length === 0) return { ok: true } // run_id not logged → soft-skip

    const d1Sha = rows[0]?.work_commit
    if (d1Sha && d1Sha !== parsed.work_commit) {
      return block(
        'blocked_d1_sha_mismatch',
        `D1 carpenter_runs.work_commit (${d1Sha}) does not match COMPLETE.md work_commit (${parsed.work_commit})`,
        {
          run_id: parsed.run_id,
          complete_md_sha: parsed.work_commit,
          d1_sha: d1Sha,
        },
      )
    }
    return { ok: true }
  } catch {
    // D1 transport failure → soft-skip
    return { ok: true }
  }
}

/**
 * Evidence layer entry point. Invoked from validateComplete after the C1
 * parse layer has accepted the document.
 */
export async function checkEvidence(
  parsed: CompleteSchemaType,
  env: ValidatorEnv,
): Promise<EvidenceResult> {
  const v2 = checkStatusEvidence(parsed)
  if (!v2.ok) return v2

  const v3 = await checkPushVerification(parsed, env.GITHUB_TOKEN)
  if (!v3.ok) return v3

  const d1 = await checkD1ShaMatch(parsed, env)
  if (!d1.ok) return d1

  return { ok: true }
}
