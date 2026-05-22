// ops_board_complete bypass resolution.
//
// Today's Guard Layer flow blocks paper-design OPS-row closures because the
// health_probe verifier requires a `url` param and paper-design rows have
// no deployable surface. C5 adds two structural bypasses so principled
// closures land without weakening the Guard Layer envelope on rows that
// genuinely need verification:
//
//   1. Validator-aware: if brain/06-meta/auto-actions/<recent>/*.json contains
//      a complete_validator entry with verdict='applied' for the row's
//      hunt+clue, the substrate work was already independently substantiated
//      by C3's webhook validator -- health_probe would be redundant.
//
//   2. Paper-design flag: if the row's Notes column contains
//      `paper_design: true` (tolerant spelling), the row's closure
//      criterion is artifact deposit (specs at brain/06-meta/...),
//      not deployable health.
//
// Rows hitting NEITHER bypass run the existing Guard Layer path unchanged
// (no regression on non-clue / non-paper-design closures).
//
// Validator-aware bypass takes priority over paper-design when both could
// apply -- a validator verdict is stronger evidence than a flag override.

const GITHUB_API = 'https://api.github.com'
const REPO_OWNER = 'AetherCreator'
const REPO_NAME = 'SuperClaude'

export interface ValidatorVerdictEntry {
  type: 'complete_validator'
  hunt: string
  clue: number
  verdict: string
  run_id: string
  timestamp: string
  file: string
}

export type BypassResult =
  | { kind: 'validator'; entry: ValidatorVerdictEntry }
  | { kind: 'paper_design' }
  | { kind: 'none' }

export interface BypassEnv {
  GITHUB_TOKEN: string
}

/**
 * Extract hunt + clue from an OPS row's Notes column. Rows seeded by the
 * Carpenter / Hunter dispatch path typically include `hunt: <slug>` and
 * `clue: <N>` in Notes; rows seeded manually for token-rotation or
 * one-off ops don't. Returns null when the convention isn't followed.
 */
export function parseHuntClueFromNotes(
  notes: string,
): { hunt: string; clue: number } | null {
  const huntMatch = notes.match(/hunt:\s*([a-z0-9\-_]+)/i)
  const clueMatch = notes.match(/clue:\s*(\d+)/i)
  if (!huntMatch || !clueMatch) return null
  return { hunt: huntMatch[1], clue: parseInt(clueMatch[1], 10) }
}

/**
 * Detect `paper_design: true` in Notes. Tolerant of spelling variants
 * (`paper-design`, `Paper Design`, etc) but strict on the truthy value
 * to avoid accidental matches like `paper_design: false` or
 * `paper_design: pending`.
 */
export function isPaperDesignFlag(notes: string): boolean {
  return /paper[_\s\-]design\s*:\s*true\b/i.test(notes)
}

/**
 * Scan brain/06-meta/auto-actions/<today>/ and <yesterday>/ for a
 * complete_validator entry matching the hunt+clue with verdict='applied'.
 * Returns the most recent match, or null. Network/parse failures
 * soft-fail to null so an audit-trail outage doesn't false-block
 * the bypass path (which would put us right back where we started).
 */
export async function findValidatorApplied(
  hunt: string,
  clue: number,
  env: BypassEnv,
): Promise<ValidatorVerdictEntry | null> {
  const now = new Date()
  const today = now.toISOString().slice(0, 10)
  const yesterday = new Date(now.getTime() - 86_400_000).toISOString().slice(0, 10)

  const headers = {
    Authorization: `Bearer ${env.GITHUB_TOKEN}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'thechefos-workers-ops-bypass/1.0',
    'X-GitHub-Api-Version': '2022-11-28',
  }

  for (const date of [today, yesterday]) {
    const dirUrl = `${GITHUB_API}/repos/${REPO_OWNER}/${REPO_NAME}/contents/brain/06-meta/auto-actions/${date}`
    let listing: Array<{ name: string; download_url?: string }>
    try {
      const res = await fetch(dirUrl, { headers })
      if (!res.ok) continue // partition doesn't exist yet -> skip
      const body = await res.json()
      if (!Array.isArray(body)) continue
      listing = body as Array<{ name: string; download_url?: string }>
    } catch {
      continue
    }

    // Only consider .json files (skip stray .md / etc)
    const jsonFiles = listing.filter(f => f.name.endsWith('.json'))
    for (const file of jsonFiles) {
      if (!file.download_url) continue
      try {
        const contentRes = await fetch(file.download_url, {
          headers: { 'User-Agent': 'thechefos-workers-ops-bypass/1.0' },
        })
        if (!contentRes.ok) continue
        const entry = (await contentRes.json()) as Partial<ValidatorVerdictEntry>
        if (
          entry?.type === 'complete_validator' &&
          entry?.hunt === hunt &&
          entry?.clue === clue &&
          entry?.verdict === 'applied'
        ) {
          return entry as ValidatorVerdictEntry
        }
      } catch {
        // bad JSON or fetch error -> skip
      }
    }
  }
  return null
}

/**
 * Top-level bypass dispatcher. Validator-aware wins over paper-design when
 * both could apply (validator is stronger evidence).
 */
export async function resolveBypass(
  rowNotes: string | null | undefined,
  env: BypassEnv,
): Promise<BypassResult> {
  const notes = rowNotes ?? ''

  const hc = parseHuntClueFromNotes(notes)
  if (hc) {
    const entry = await findValidatorApplied(hc.hunt, hc.clue, env)
    if (entry) return { kind: 'validator', entry }
  }

  if (isPaperDesignFlag(notes)) {
    return { kind: 'paper_design' }
  }

  return { kind: 'none' }
}

/**
 * Audit trail entry for a bypass invocation. Mirrors the
 * complete_validator audit shape (same directory, distinct `type`).
 */
export interface BypassAuditEntry {
  type: 'ops_board_complete_bypass'
  kind: 'validator' | 'paper_design'
  ops_id: string
  timestamp: string
  validator_run_id?: string
  validator_file?: string
}

export interface BypassAuditResult {
  ok: boolean
  path: string
  commit_sha?: string
  error?: string
}

/**
 * Soft-fail audit emission. Bypass observability is the goal, not safety --
 * if the audit write fails the bypass should still complete (the OPS-row
 * promotion is the actual user-visible work).
 */
export async function commitBypassAudit(
  entry: BypassAuditEntry,
  env: BypassEnv,
): Promise<BypassAuditResult> {
  const date = entry.timestamp.slice(0, 10)
  const runId = `bypass-${entry.ops_id}-${Date.parse(entry.timestamp)}`
  const path = `brain/06-meta/auto-actions/${date}/${runId}.json`
  const content = JSON.stringify(entry, null, 2)
  const contentBase64 = btoa(unescape(encodeURIComponent(content)))
  const message = `audit: ops_board_complete_bypass ${entry.kind} for ${entry.ops_id}`

  const url = `${GITHUB_API}/repos/${REPO_OWNER}/${REPO_NAME}/contents/${path}`
  try {
    const res = await fetch(url, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${env.GITHUB_TOKEN}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'thechefos-workers-ops-bypass/1.0',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message,
        content: contentBase64,
        committer: {
          name: 'SuperClaude Brain Ops',
          email: 'brain-ops@thechefos.app',
        },
      }),
    })
    if (res.ok) {
      const data = (await res.json()) as { commit?: { sha?: string } }
      return { ok: true, path, commit_sha: data?.commit?.sha }
    }
    if (res.status === 422) {
      return { ok: true, path, error: 'audit_file_already_exists' }
    }
    const detail = await res.text()
    return { ok: false, path, error: `github_${res.status}: ${detail.slice(0, 200)}` }
  } catch (e) {
    return { ok: false, path, error: e instanceof Error ? e.message : String(e) }
  }
}
