// C2 grok-verify-failed OPS row filer.
// Auto-files a BACKLOG row in brain/OPS-BOARD.md when reproduction rejects a COMPLETE.md.
// Tagged agent:grok grok-verify-failed per C2 spec.
//
// Idempotency: ops_id is derived from SHA-256(work_commit + cmd) so replay of the same
// rejection does not create a duplicate row. If IDEMPOTENCY_KEYS is bound, a KV hit
// returns cached result immediately. If not bound, we check for the row ID in OPS-BOARD
// before inserting.
//
// Soft-fail discipline: all errors are caught and logged; never throws or blocks the
// caller verdict. This function is always called with .catch() in index.ts.

import type { EntryResult } from './reproduce'
import { insertRowIntoSection } from '../ops-file'
import type { ValidatorEnv } from './types'

const REPO_OWNER = 'AetherCreator'
const REPO_NAME = 'SuperClaude'
const GITHUB_API = 'https://api.github.com'
const OPS_BOARD_PATH = 'brain/OPS-BOARD.md'
const COMMITTER = { name: 'SuperClaude Brain Ops', email: 'brain-ops@thechefos.app' }
const IDEMPOTENCY_TTL = 30 * 86_400 // 30 days

export interface GvhRejectContext {
  hunt: string
  clue: number
  work_commit: string
  failing_entry: EntryResult
}

async function sha256Hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(text)
  const buf = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('')
}

function ghHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'SuperClaude-Brain-Ops',
    'X-GitHub-Api-Version': '2022-11-28',
  }
}

function decodeB64(encoded: string): string {
  return decodeURIComponent(escape(atob(encoded.replace(/\n/g, ''))))
}

function encodeB64(text: string): string {
  return btoa(unescape(encodeURIComponent(text)))
}

// Derive a stable OPS row ID from the rejection context.
// Format: OPS-GROK-VERIFY-FAILED-{8-char hex prefix}
async function deriveOpsId(ctx: GvhRejectContext): Promise<string> {
  const key = `${ctx.work_commit}:${ctx.failing_entry.cmd}`
  const hash = await sha256Hex(key)
  return `OPS-GROK-VERIFY-FAILED-${hash.slice(0, 8).toUpperCase()}`
}

function buildRowBody(ctx: GvhRejectContext, ops_id: string): string {
  const { hunt, clue, work_commit, failing_entry } = ctx
  const shortSha = work_commit.slice(0, 8)
  const body = [
    `**grok-verify-failed** ${hunt}/C${clue} @ \`${shortSha}\`.`,
    `cmd: \`${failing_entry.cmd}\``,
    `expect: \`${failing_entry.expect}\``,
    `actual: exit=${failing_entry.actual_exit} stdout="${failing_entry.actual_stdout.slice(0, 80)}"`,
    `claim was: "${failing_entry.claim.slice(0, 120)}"`,
    `agent:grok grok-verify-failed`,
  ].join(' | ')
  return `| ${ops_id} | ${body} | infra | Normal |`
}

export async function fileGrokVerifyFailed(
  env: ValidatorEnv,
  ctx: GvhRejectContext,
): Promise<{ ok: boolean; ops_id: string; idempotency_hit: boolean; error?: string }> {
  const ops_id = await deriveOpsId(ctx)
  const idempKey = await sha256Hex(ops_id)

  // KV idempotency check (fast path)
  if (env.IDEMPOTENCY_KEYS) {
    const hit = await env.IDEMPOTENCY_KEYS.get(idempKey, 'text').catch(() => null)
    if (hit) return { ok: true, ops_id, idempotency_hit: true }
  }

  // Fetch current OPS-BOARD.md
  const boardRes = await fetch(
    `${GITHUB_API}/repos/${REPO_OWNER}/${REPO_NAME}/contents/${OPS_BOARD_PATH}`,
    { headers: ghHeaders(env.GITHUB_TOKEN) },
  ).catch(e => null)

  if (!boardRes || !boardRes.ok) {
    return { ok: false, ops_id, idempotency_hit: false, error: 'ops_board_fetch_failed' }
  }

  const boardData = await boardRes.json() as { sha: string; content: string }
  const current = decodeB64(boardData.content)

  // Content-level idempotency: check row ID not already present
  if (current.includes(ops_id)) {
    if (env.IDEMPOTENCY_KEYS) {
      await env.IDEMPOTENCY_KEYS.put(idempKey, ops_id, { expirationTtl: IDEMPOTENCY_TTL }).catch(() => {})
    }
    return { ok: true, ops_id, idempotency_hit: true }
  }

  // Insert the row into BACKLOG section
  const newRow = buildRowBody(ctx, ops_id)
  const updated = insertRowIntoSection(current, '## 🟢 BACKLOG', newRow)
  if (updated === current) {
    // BACKLOG section not found — try inserting before the COMPLETED section as fallback
    const fallback = current + `\n${newRow}\n`
    const putFb = await fetch(
      `${GITHUB_API}/repos/${REPO_OWNER}/${REPO_NAME}/contents/${OPS_BOARD_PATH}`,
      {
        method: 'PUT',
        headers: { ...ghHeaders(env.GITHUB_TOKEN), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: `ops_file: ${ops_id} → BACKLOG (grok-verify-failed)`,
          content: encodeB64(fallback),
          sha: boardData.sha,
          committer: COMMITTER,
        }),
      },
    ).catch(e => null)
    if (putFb && putFb.ok) {
      if (env.IDEMPOTENCY_KEYS) {
        await env.IDEMPOTENCY_KEYS.put(idempKey, ops_id, { expirationTtl: IDEMPOTENCY_TTL }).catch(() => {})
      }
      return { ok: true, ops_id, idempotency_hit: false }
    }
    return { ok: false, ops_id, idempotency_hit: false, error: 'backlog_section_not_found_and_fallback_failed' }
  }

  // Commit updated OPS-BOARD
  const putRes = await fetch(
    `${GITHUB_API}/repos/${REPO_OWNER}/${REPO_NAME}/contents/${OPS_BOARD_PATH}`,
    {
      method: 'PUT',
      headers: { ...ghHeaders(env.GITHUB_TOKEN), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: `ops_file: ${ops_id} → BACKLOG (grok-verify-failed)`,
        content: encodeB64(updated),
        sha: boardData.sha,
        committer: COMMITTER,
      }),
    },
  ).catch(e => null)

  if (!putRes || !putRes.ok) {
    return { ok: false, ops_id, idempotency_hit: false, error: `github_put_failed` }
  }

  if (env.IDEMPOTENCY_KEYS) {
    await env.IDEMPOTENCY_KEYS.put(idempKey, ops_id, { expirationTtl: IDEMPOTENCY_TTL }).catch(() => {})
  }

  return { ok: true, ops_id, idempotency_hit: false }
}
