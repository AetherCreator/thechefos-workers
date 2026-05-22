// packages/brain-write/src/index.ts
import { Hono } from 'hono'
import { guardLayer, type GuardLayerEnv } from './guard-layer'
import { resolveBypass, commitBypassAudit } from './ops-board/bypass'
import { validateComplete } from './complete-validator'
import { buildAuditEntry, commitAuditEntry } from './complete-validator/audit'
import { pingShipsDoctor } from './complete-validator/ping'

const REPO_OWNER = 'AetherCreator'
const REPO_NAME = 'SuperClaude'
const COMMITTER = { name: 'SuperClaude Brain Ops', email: 'brain-ops@thechefos.app' }
const MAX_CONTENT_SIZE = 256 * 1024 // 256KB (was 50KB; raised so explicit GRAPH-INDEX writes pass)
const GRAPH_INDEX_PATH = 'brain/GRAPH-INDEX.md'
const OPS_BOARD_PATH = 'brain/OPS-BOARD.md'
const GITHUB_API = 'https://api.github.com'
const SESSION_STATE_KEY = 'session:state'
const TELEGRAM_RELAY_URL = 'https://api.thechefos.app/api/telegram' // black-hole per OPS-041; spec-conforming target

export interface Env {
  GITHUB_TOKEN: string
  WEBHOOK_SECRET: string
  GITHUB_WEBHOOK_SECRET: string
  SESSION_KV: KVNamespace
  // Guard Layer (P0.5) — KV + notifier bindings. Optional during rollout:
  // when IDEMPOTENCY_KEYS is unbound, callers fall back to non-guarded path.
  IDEMPOTENCY_KEYS?: KVNamespace
  TYLER_CHAT_ID?: string
  SHIPS_DOCTOR_BOT_TOKEN?: string
  MASTRO_BOT_TOKEN?: string
  // complete-validator (carpenter-h3-validator C3)
  COMPLETE_VALIDATOR_DRY_RUN?: string // 'true' = dry-run (audit + log, no halt / no ping)
  CF_API_TOKEN?: string // optional; enables D1 cross-source SHA verification
  CF_ACCOUNT_ID?: string // optional; enables D1 cross-source SHA verification
}

interface BrainPushPayload {
  path: string
  content: string
  message: string
}

interface SessionState {
  active_hunt_clue: string | null
  [key: string]: unknown
}

// ─── OPS-BOARD types ─────────────────────────────────────────────

type OpsSection = 'urgent' | 'active' | 'backlog' | 'completed'

interface OpsItem {
  id: string
  title: string
  section: OpsSection
  domain?: string | null
  status_note?: string | null
  raw_line?: string
  line_index?: number
}

interface SectionBounds {
  h2_line: number
  header_line: number
  separator_line: number
  first_data_line: number  // -1 if no data rows
  last_data_line: number   // -1 if no data rows
}

interface ParsedOpsBoard {
  raw_lines: string[]
  sections: Record<OpsSection, OpsItem[]>
  bounds: Partial<Record<OpsSection, SectionBounds>>
  board_sha?: string  // attached by the caller post-fetch
}

const app = new Hono<{ Bindings: Env }>()

// ─── Session State ───────────────────────────────────────────────

// GET /state — public read (no auth, used by hook curl)
app.get('/state', async (c) => {
  const raw = await c.env.SESSION_KV.get(SESSION_STATE_KEY)
  const state: SessionState = raw ? JSON.parse(raw) : { active_hunt_clue: null }
  return c.json(state)
})

// PATCH /state — merge fields (requires x-webhook-secret auth)
app.patch('/state', async (c) => {
  const secret = c.req.header('x-webhook-secret')
  if (!secret || secret !== c.env.WEBHOOK_SECRET) {
    return c.json({ error: 'Unauthorized' }, 401)
  }

  const patch = await c.req.json<Partial<SessionState>>()
  const raw = await c.env.SESSION_KV.get(SESSION_STATE_KEY)
  const current: SessionState = raw ? JSON.parse(raw) : { active_hunt_clue: null }
  const merged = { ...current, ...patch }

  await c.env.SESSION_KV.put(SESSION_STATE_KEY, JSON.stringify(merged))
  return c.json({ ok: true, state: merged })
})

// ─── GitHub Webhook — COMPLETE.md Detection ──────────────────────

app.post('/api/webhook/github', async (c) => {
  // Verify GitHub signature
  const signature = c.req.header('x-hub-signature-256')
  if (!signature) {
    return c.json({ error: 'Missing signature' }, 401)
  }

  const body = await c.req.text()
  const valid = await verifyGitHubSignature(c.env.GITHUB_WEBHOOK_SECRET, body, signature)
  if (!valid) {
    return c.json({ error: 'Invalid signature' }, 401)
  }

  const payload = JSON.parse(body)

  // Only handle push events
  if (!payload.commits || !Array.isArray(payload.commits)) {
    return c.json({ ok: true, action: 'ignored — not a push event' })
  }

  // OPS-021 FIX: Ignore self-commits from brain-ops to prevent amplification loop.
  const headCommitterEmail = payload.head_commit?.committer?.email || ''
  if (headCommitterEmail === COMMITTER.email) {
    return c.json({ ok: true, action: 'ignored — brain-ops self-commit' })
  }

  // OPS-021 FIX: Only process main branch — ignore feature branches, PRs, etc.
  if (payload.ref && payload.ref !== 'refs/heads/main') {
    return c.json({ ok: true, action: 'ignored — non-main branch' })
  }

  // Scan all commits for COMPLETE.md files and capture path + commit metadata
  const completeMdPaths: { path: string; commitSha: string; commitMessage: string }[] = []
  for (const commit of payload.commits) {
    const allFiles = [
      ...(commit.added || []),
      ...(commit.modified || []),
    ]
    for (const file of allFiles) {
      if (file.endsWith('COMPLETE.md')) {
        completeMdPaths.push({
          path: file,
          commitSha: commit.id,
          commitMessage: commit.message || '',
        })
      }
    }
  }

  if (completeMdPaths.length === 0) {
    return c.json({ ok: true, action: 'no COMPLETE.md detected' })
  }

  // Validator pass (carpenter-h3-validator C3): structurally enforce COMPLETE.md
  // shape + substrate. Runs before OPS-row routing so blocked files don't promote
  // downstream. In dry-run, every COMPLETE.md push still emits an audit entry to
  // brain/06-meta/auto-actions/ but downstream behavior is unchanged. In enforce,
  // blocked files halt their OPS-row promotion and fire a Ship's Doctor Telegram
  // ping. Per spec, ships in dry-run; 1-week grace before enforce flip.
  const COMPLETE_MD_PATTERN = /^hunts\/(?:[^/]+\/)+clue-[^/]+\/COMPLETE\.md$/
  const dryRun = c.env.COMPLETE_VALIDATOR_DRY_RUN === 'true'
  const validatorResults: Array<{
    file: string
    verdict: string
    blocked: boolean
    dry_run: boolean
    audit_path?: string
    audit_commit_sha?: string
    audit_error?: string
    ping?: { ok: boolean; relay_status?: number; relay_body?: string; error?: string }
  }> = []
  const blockedFiles = new Set<string>()

  for (const detected of completeMdPaths) {
    if (!COMPLETE_MD_PATTERN.test(detected.path)) {
      // Non-hunt COMPLETE.md — skip validator (extractHuntInfo will reject downstream).
      continue
    }
    const fileText = await fetchFileTextAtRef(
      detected.path,
      detected.commitSha,
      c.env.GITHUB_TOKEN,
    )
    if (!fileText.ok) {
      validatorResults.push({
        file: detected.path,
        verdict: 'fetch_error',
        blocked: false,
        dry_run: dryRun,
        audit_error: fileText.error,
      })
      continue
    }
    const result = await validateComplete(fileText.text, c.env)
    const parsed = result.verdict === 'applied' ? result.parsed : null
    const agent = result.verdict === 'applied' ? result.agent : 'unknown'
    const entry = buildAuditEntry(
      result,
      parsed,
      agent,
      detected.path,
      { after: detected.commitSha, repo: `${REPO_OWNER}/${REPO_NAME}` },
      dryRun,
    )
    const auditCommit = await commitAuditEntry(entry, c.env)
    const blocked = entry.verdict.startsWith('blocked_')
    const vr: (typeof validatorResults)[number] = {
      file: detected.path,
      verdict: entry.verdict,
      blocked,
      dry_run: dryRun,
      audit_path: auditCommit.path,
      audit_commit_sha: auditCommit.commit_sha,
      audit_error: auditCommit.ok ? undefined : auditCommit.error,
    }
    if (blocked && !dryRun) {
      blockedFiles.add(detected.path)
      vr.ping = await pingShipsDoctor(entry)
    }
    validatorResults.push(vr)
  }

  // Try to auto-claim a matching ACTIVE OPS row for each detected COMPLETE.md.
  // Reads OPS-BOARD once for matching, then calls completeOpsItem (which re-fetches
  // for atomic SHA-aware moveLine + GitHub PUT under retryOnce).
  const opsResults: Array<{
    path: string
    hunt?: string
    ops_id?: string
    result:
      | { ok: true; board_sha?: string; commit_url?: string; moved_id: string }
      | { ok: false; error: string; current_section?: string; status?: number; detail?: string }
    guard_layer?: { outcome: string; action_id: string; verifier_outcome: string }
  }> = []

  let parsedBoard: ParsedOpsBoard | null = null
  try {
    const headers = githubHeaders(c.env.GITHUB_TOKEN)
    const opsFile = await getFileContent(OPS_BOARD_PATH, headers)
    if (opsFile) parsedBoard = parseOpsBoard(decodeBase64Content(opsFile.content))
  } catch {
    // Soft-fail: continue to gate-clear if OPS-BOARD unreadable
  }

  for (const detected of completeMdPaths) {
    if (blockedFiles.has(detected.path)) {
      opsResults.push({
        path: detected.path,
        result: { ok: false, error: 'blocked_by_complete_validator' },
      })
      continue
    }
    const huntInfo = extractHuntInfo(detected.path)
    if (!huntInfo) {
      opsResults.push({ path: detected.path, result: { ok: false, error: 'not_hunt_path' } })
      continue
    }
    const item = parsedBoard ? findActiveOpsItemForHunt(parsedBoard, huntInfo.hunt) : null
    if (!item) {
      opsResults.push({
        path: detected.path,
        hunt: huntInfo.hunt,
        result: { ok: false, error: 'no_matching_active_ops_row' },
      })
      continue
    }
    const firstLine = detected.commitMessage.split('\n')[0].slice(0, 100)
    const summary = `${huntInfo.clue} shipped (${firstLine || 'auto-claim'})`
    const evidenceUrl = `https://github.com/${REPO_OWNER}/${REPO_NAME}/commit/${detected.commitSha}`
    const guarded = await completeOpsItemGuarded(c.env, item, summary, evidenceUrl, {
      trigger: {
        type: 'github_webhook',
        details: {
          event: 'push',
          repo: `${REPO_OWNER}/${REPO_NAME}`,
          commit: detected.commitSha,
          file_path: detected.path,
        },
      },
    })
    opsResults.push({
      path: detected.path,
      hunt: huntInfo.hunt,
      ops_id: item.id,
      result: guarded.result,
      guard_layer: guarded.guard_layer,
    })
  }

  // Clear the active hunt clue (existing behavior preserved)
  const raw = await c.env.SESSION_KV.get(SESSION_STATE_KEY)
  const current: SessionState = raw ? JSON.parse(raw) : { active_hunt_clue: null }
  const previousClue = current.active_hunt_clue
  current.active_hunt_clue = null
  await c.env.SESSION_KV.put(SESSION_STATE_KEY, JSON.stringify(current))

  return c.json({
    ok: true,
    action: 'gate_cleared_and_ops_processed',
    previous_clue: previousClue,
    complete_md_count: completeMdPaths.length,
    ops_results: opsResults,
    validator_results: validatorResults,
    validator_dry_run: dryRun,
  })
})

// ─── Brain Push (existing) ───────────────────────────────────────

// Auth middleware for brain push
app.use('/api/brain/push', async (c, next) => {
  const secret = c.req.header('x-webhook-secret')
  if (!secret || secret !== c.env.WEBHOOK_SECRET) {
    return c.json({ error: 'Unauthorized — invalid or missing webhook secret' }, 401)
  }
  await next()
})

// POST /api/brain/push — commit a brain node to SuperClaude
app.post('/api/brain/push', async (c) => {
  const body = await c.req.json<BrainPushPayload>()

  if (!body.path || !body.content || !body.message) {
    return c.json({ error: 'Missing required fields: path, content, message' }, 400)
  }
  if (!body.path.startsWith('brain/') && !body.path.startsWith('hunts/')) {
    return c.json({ error: 'Path must start with brain/ or hunts/' }, 400)
  }
  if (body.path.includes('..')) {
    return c.json({ error: 'Path traversal not allowed' }, 400)
  }
  if (new TextEncoder().encode(body.content).byteLength > MAX_CONTENT_SIZE) {
    return c.json({ error: `Content exceeds ${MAX_CONTENT_SIZE / 1024}KB limit` }, 400)
  }

  const headers = githubHeaders(c.env.GITHUB_TOKEN)

  try {
    const existingFile = await getFileContent(body.path, headers)
    const contentBase64 = btoa(unescape(encodeURIComponent(body.content)))

    let commitSha: string

    if (existingFile) {
      // OPS-058e fix (2026-05-14): pass through GitHub status + auto-retry once on 409 SHA conflict.
      // Old behavior: every GitHub failure remapped to opaque 502, swallowing 409/403/401 distinction.
      // New: callers see real status; 409 (race) auto-recovers with fresh-SHA retry.
      let updateRes!: Response
      let currentSha = existingFile.sha
      let retryAttempted = false
      for (let attempt = 0; attempt < 2; attempt++) {
        updateRes = await fetch(
          `${GITHUB_API}/repos/${REPO_OWNER}/${REPO_NAME}/contents/${body.path}`,
          {
            method: 'PUT',
            headers: { ...headers, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              message: body.message,
              content: contentBase64,
              sha: currentSha,
              committer: COMMITTER,
            }),
          }
        )
        if (updateRes.ok) break
        // 409 = SHA conflict (concurrent edit race) — fetch fresh SHA and retry once
        if (updateRes.status === 409 && attempt === 0) {
          const fresh = await getFileContent(body.path, headers)
          if (fresh) {
            currentSha = fresh.sha
            retryAttempted = true
            continue
          }
        }
        break
      }
      if (!updateRes.ok) {
        const errText = await updateRes.text()
        const proxyStatus = updateRes.status >= 500 ? 502 : updateRes.status
        return c.json({
          error: 'GitHub API error (update)',
          github_status: updateRes.status,
          github_message: errText.slice(0, 500),
          retry_attempted: retryAttempted,
          details: errText,
        }, proxyStatus as any)
      }
      const updateData = await updateRes.json() as { commit: { sha: string } }
      commitSha = updateData.commit.sha
    } else {
      const createRes = await fetch(
        `${GITHUB_API}/repos/${REPO_OWNER}/${REPO_NAME}/contents/${body.path}`,
        {
          method: 'PUT',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: body.message,
            content: contentBase64,
            committer: COMMITTER,
          }),
        }
      )
      if (!createRes.ok) {
        // OPS-058e fix (2026-05-14): pass through GitHub status + diagnostic fields
        const errText = await createRes.text()
        const proxyStatus = createRes.status >= 500 ? 502 : createRes.status
        return c.json({
          error: 'GitHub API error (create)',
          github_status: createRes.status,
          github_message: errText.slice(0, 500),
          details: errText,
        }, proxyStatus as any)
      }
      const createData = await createRes.json() as { commit: { sha: string } }
      commitSha = createData.commit.sha
    }

    // Skip auto-append when:
    // 1. The explicit target IS GRAPH-INDEX itself (would recurse).
    // 2. The path is not under brain/ (e.g. hunts/ writes — tracked elsewhere,
    //    don't pollute the brain knowledge graph index with hunt scaffolds).
    if (body.path !== GRAPH_INDEX_PATH && body.path.startsWith('brain/')) {
      await appendToGraphIndex(body.path, body.message, headers)
    }
    return c.json({ ok: true, sha: commitSha, path: body.path, updated: !!existingFile })
  } catch (err) {
    return c.json({ error: 'Internal error', details: String(err) }, 500)
  }
})

// ─── OPS-BOARD Routes (Wave 1 Hunt A) ────────────────────────────

// Auth middleware — same x-webhook-secret pattern
app.use('/api/ops/*', async (c, next) => {
  const secret = c.req.header('x-webhook-secret')
  if (!secret || secret !== c.env.WEBHOOK_SECRET) {
    return c.json({ error: 'Unauthorized — invalid or missing webhook secret' }, 401)
  }
  await next()
})

// GET /api/ops/list?filter=open|blocked|stale|all
app.get('/api/ops/list', async (c) => {
  const filter = (c.req.query('filter') ?? 'open') as 'open' | 'blocked' | 'stale' | 'all'
  const headers = githubHeaders(c.env.GITHUB_TOKEN)
  const file = await getFileContent(OPS_BOARD_PATH, headers)
  if (!file) return c.json({ error: 'OPS-BOARD not found' }, 502)
  const content = decodeBase64Content(file.content)
  let parsed: ParsedOpsBoard
  try {
    parsed = parseOpsBoard(content)
  } catch (e) {
    return c.json({ error: 'parser_error', details: String(e) }, 500)
  }

  let items: OpsItem[]
  if (filter === 'blocked') items = parsed.sections.urgent
  else if (filter === 'stale') items = []  // age computation TBD; contract allows empty placeholder
  else if (filter === 'all') items = [
    ...parsed.sections.urgent,
    ...parsed.sections.active,
    ...parsed.sections.backlog,
    ...parsed.sections.completed,
  ]
  else items = [
    ...parsed.sections.urgent,
    ...parsed.sections.active,
    ...parsed.sections.backlog,
  ]

  // Strip internal fields from response
  const sanitized = items.map(stripInternal)
  return c.json({ items: sanitized, board_sha: file.sha, filter })
})

// GET /api/ops/get/:id
app.get('/api/ops/get/:id', async (c) => {
  const id = c.req.param('id')
  const headers = githubHeaders(c.env.GITHUB_TOKEN)
  const file = await getFileContent(OPS_BOARD_PATH, headers)
  if (!file) return c.json({ error: 'OPS-BOARD not found' }, 502)
  const content = decodeBase64Content(file.content)
  let parsed: ParsedOpsBoard
  try {
    parsed = parseOpsBoard(content)
  } catch (e) {
    return c.json({ error: 'parser_error', details: String(e) }, 500)
  }

  for (const section of ['urgent', 'active', 'backlog', 'completed'] as OpsSection[]) {
    const item = parsed.sections[section].find((i) => i.id === id)
    if (item) {
      return c.json({ item: stripInternal(item), board_sha: file.sha })
    }
  }
  return c.json({ error: 'not_found', id }, 404)
})

// POST /api/ops/claim — body { id, agent }
app.post('/api/ops/claim', async (c) => {
  let body: { id?: string; agent?: string }
  try { body = await c.req.json() } catch { return c.json({ error: 'bad_json' }, 400) }
  const { id, agent } = body
  if (!id || !agent) return c.json({ error: 'missing_fields', hint: '{id, agent}' }, 400)

  const headers = githubHeaders(c.env.GITHUB_TOKEN)
  const result = await retryOnce(async () => {
    const file = await getFileContent(OPS_BOARD_PATH, headers)
    if (!file) return { ok: false, error: 'fetch_failed' as const }
    const parsed = parseOpsBoard(decodeBase64Content(file.content))

    // Already in active?
    const alreadyActive = parsed.sections.active.find((i) => i.id === id)
    if (alreadyActive) {
      return { ok: false, error: 'already_claimed' as const, item: stripInternal(alreadyActive), board_sha: file.sha }
    }

    // Find in urgent or backlog
    let source: OpsSection | null = null
    let item: OpsItem | undefined
    for (const s of ['urgent', 'backlog'] as OpsSection[]) {
      item = parsed.sections[s].find((i) => i.id === id)
      if (item) { source = s; break }
    }
    if (!source || !item || item.line_index == null) return { ok: false, error: 'not_found' as const }

    const today = isoDate()
    const newRow = buildClaimRow(item, agent, today)
    const activeBounds = parsed.bounds.active
    if (!activeBounds || activeBounds.separator_line < 0) {
      return { ok: false, error: 'active_section_missing' as const }
    }
    const insertBeforeRemove = activeBounds.last_data_line >= 0
      ? activeBounds.last_data_line + 1
      : activeBounds.separator_line + 1

    const newLines = moveLine(parsed.raw_lines, item.line_index, insertBeforeRemove, newRow)
    const newContent = newLines.join('\n')

    const putRes = await putFile(OPS_BOARD_PATH, newContent, file.sha, `ops_board.claim: ${id} → ACTIVE (by ${agent})`, headers)
    if (!putRes.ok) {
      if (putRes.status === 409) return { ok: false, error: 'sha_stale' as const, retry: true }
      return { ok: false, error: 'worker_4xx' as const, status: putRes.status, detail: putRes.detail }
    }
    return {
      ok: true as const,
      item: { ...stripInternal(item), section: 'active' as const, status_note: extractStatusFromRow(newRow, 'active') },
      board_sha: putRes.commit_sha,
      commit_url: putRes.commit_url,
    }
  })
  return c.json(result, result.ok ? 200 : (result.error === 'not_found' ? 404 : (result.error === 'already_claimed' ? 200 : 500)))
})

// ─── Helpers for webhook-driven OPS auto-claim ───────────────────

// Parse a path like "hunts/foo-bar/clue-3/COMPLETE.md" → { hunt: "foo-bar", clue: "clue-3" }
function extractHuntInfo(filePath: string): { hunt: string; clue: string } | null {
  const m = filePath.match(/^hunts\/([^/]+)\/(clue-[^/]+)\/COMPLETE\.md$/)
  if (!m) return null
  return { hunt: m[1], clue: m[2] }
}

// Find an ACTIVE OpsItem whose ID or title matches a hunt slug.
// Tries direct ID (OPS-FOO-BAR) first, then substring fallback.
function findActiveOpsItemForHunt(parsed: ParsedOpsBoard, slug: string): OpsItem | null {
  const slugUpper = slug.toUpperCase()
  const slugId = `OPS-${slugUpper}`
  let item = parsed.sections.active.find((i) => i.id === slugId)
  if (item) return item
  const slugLower = slug.toLowerCase()
  item = parsed.sections.active.find(
    (i) =>
      i.id.toLowerCase().includes(slugLower) ||
      (i.title || '').toLowerCase().includes(slugLower)
  )
  return item || null
}

// Reusable: complete an OPS item. Same logic as the /api/ops/complete route handler;
// extracted so the webhook handler can call it internally without re-fetching auth.
async function completeOpsItem(
  env: Env,
  id: string,
  summary: string,
  evidence_url?: string
): Promise<
  | { ok: true; board_sha?: string; commit_url?: string; moved_id: string }
  | { ok: false; error: string; current_section?: string; status?: number; detail?: string }
> {
  if (!id || !summary) return { ok: false, error: 'missing_fields' }
  if (summary.length < 4) return { ok: false, error: 'summary_too_short' }
  const headers = githubHeaders(env.GITHUB_TOKEN)
  return await retryOnce(async () => {
    const file = await getFileContent(OPS_BOARD_PATH, headers)
    if (!file) return { ok: false, error: 'fetch_failed' as const }
    const parsed = parseOpsBoard(decodeBase64Content(file.content))

    const item = parsed.sections.active.find((i) => i.id === id)
    if (!item) {
      for (const s of ['urgent', 'backlog', 'completed'] as OpsSection[]) {
        if (parsed.sections[s].find((i) => i.id === id)) {
          return { ok: false, error: 'not_in_active' as const, current_section: s }
        }
      }
      return { ok: false, error: 'not_found' as const }
    }
    if (item.line_index == null) return { ok: false, error: 'no_line_index' as const }

    const today = isoDate()
    const newRow = buildCompletedRow(item, summary, today, evidence_url)
    const completedBounds = parsed.bounds.completed
    if (!completedBounds || completedBounds.separator_line < 0) {
      return { ok: false, error: 'completed_section_missing' as const }
    }
    const insertBeforeRemove = completedBounds.separator_line + 1

    const newLines = moveLine(parsed.raw_lines, item.line_index, insertBeforeRemove, newRow)
    const newContent = newLines.join('\n')

    const putRes = await putFile(
      OPS_BOARD_PATH,
      newContent,
      file.sha,
      `ops_board.complete: ${id} → COMPLETED`,
      headers
    )
    if (!putRes.ok) {
      if (putRes.status === 409) return { ok: false, error: 'sha_stale' as const, retry: true }
      return { ok: false, error: 'worker_4xx' as const, status: putRes.status, detail: putRes.detail }
    }
    return {
      ok: true as const,
      board_sha: putRes.commit_sha,
      commit_url: putRes.commit_url,
      moved_id: id,
    }
  })
}

// Guard-Layer-wrapped variant of completeOpsItem. When IDEMPOTENCY_KEYS is unbound,
// falls back to the direct path so a partial rollout never blocks promotions.
async function completeOpsItemGuarded(
  env: Env,
  item: OpsItem,
  summary: string,
  evidence_url: string | undefined,
  ctx: { trigger: { type: 'github_webhook' | 'manual'; details: Record<string, unknown> } }
): Promise<{
  result:
    | { ok: true; board_sha?: string; commit_url?: string; moved_id: string }
    | { ok: false; error: string; current_section?: string; status?: number; detail?: string }
  guard_layer?: { outcome: string; action_id: string; verifier_outcome: string }
}> {
  if (!env.IDEMPOTENCY_KEYS) {
    const result = await completeOpsItem(env, item.id, summary, evidence_url)
    return { result }
  }

  // carpenter-h3-validator C5: validator-aware + paper-design bypass.
  // Runs BEFORE the Guard Layer verifier pass so paper-design rows
  // (which have no deployable health URL) and validator-already-substantiated
  // rows can close without health_probe blocking. Existing verifier path
  // is preserved verbatim for rows hitting neither bypass.
  const bypass = await resolveBypass(item.status_note, env)
  if (bypass.kind !== 'none') {
    const result = await completeOpsItem(env, item.id, summary, evidence_url)
    const ts = new Date().toISOString()
    // Audit emission is soft-fail; the promote already happened.
    await commitBypassAudit(
      bypass.kind === 'validator'
        ? {
            type: 'ops_board_complete_bypass',
            kind: 'validator',
            ops_id: item.id,
            timestamp: ts,
            validator_run_id: bypass.entry.run_id,
            validator_file: bypass.entry.file,
          }
        : {
            type: 'ops_board_complete_bypass',
            kind: 'paper_design',
            ops_id: item.id,
            timestamp: ts,
          },
      env,
    )
    return {
      result,
      guard_layer: {
        outcome: `bypassed_${bypass.kind}`,
        action_id: `bypass-${item.id}-${Date.parse(ts)}`,
        verifier_outcome: 'skipped',
      },
    }
  }

  // Build verifier params from the OPS row's status_note. Convention v1:
  //   - status_note may include "health=https://..." to specify substrate probe URL
  //   - commit_sha is taken from the webhook payload for ci_run_check
  // If no health URL is parseable, the verifier returns passed:false → Guard
  // Layer blocks promotion (FALSE COMPLETE risk averted, Ship's Doctor pings).
  const healthUrl = extractHealthUrl(item.status_note)
  const commit_sha =
    typeof ctx.trigger.details.commit === 'string'
      ? (ctx.trigger.details.commit as string)
      : undefined
  const verifierParams: Record<string, unknown> = {
    url: healthUrl,
    expected_status: 200,
    repo: `${REPO_OWNER}/${REPO_NAME}`,
    commit_sha,
  }

  type PromoteResult =
    | { ok: true; board_sha?: string; commit_url?: string; moved_id: string }
    | { ok: false; error: string; current_section?: string; status?: number; detail?: string }
  // Use a box so TS doesn't narrow the let-binding to `null` after await.
  const promotedRef: { current: PromoteResult | null } = { current: null }

  const guardEnv = env as unknown as GuardLayerEnv
  const guardRes = await guardLayer(guardEnv, {
    actor: 'ops-board-agent',
    intent: 'ops_board_promote',
    trigger: ctx.trigger,
    action: {
      type: 'ops_board_promote',
      target: item.id,
      params: { from: item.section, to: 'COMPLETED', summary },
      evidence_url,
    },
    verifierParams,
    executeAction: async () => {
      const result = await completeOpsItem(env, item.id, summary, evidence_url)
      promotedRef.current = result
      if (!result.ok) {
        throw new Error(`promote_failed: ${result.error}`)
      }
      return {
        detail: `OPS ${item.id} promoted ${item.section}→COMPLETED via Guard Layer`,
        reversible_via: {
          command: 'ops_board_reopen',
          params: { id: item.id },
          estimated_difficulty: 'trivial',
          requires_confirmation: false,
        },
      }
    },
  })

  const summary_meta = {
    outcome: guardRes.outcome,
    action_id: guardRes.evidence.action_id,
    verifier_outcome: guardRes.evidence.verifier_outcome,
  }

  const promoted = promotedRef.current
  if (guardRes.outcome === 'applied' && promoted && promoted.ok) {
    return { result: promoted, guard_layer: summary_meta }
  }
  if (guardRes.outcome === 'blocked_verifier') {
    return {
      result: {
        ok: false,
        error: 'blocked_verifier',
        detail: guardRes.evidence.outcome_detail,
      },
      guard_layer: summary_meta,
    }
  }
  if (guardRes.outcome === 'noop_duplicate') {
    return {
      result: {
        ok: true,
        moved_id: item.id,
        board_sha: undefined,
        commit_url: undefined,
      },
      guard_layer: summary_meta,
    }
  }
  // failed_error or applied-but-execute-callback-threw
  return {
    result:
      promoted && !promoted.ok
        ? promoted
        : { ok: false, error: 'guard_layer_error', detail: guardRes.evidence.outcome_detail },
    guard_layer: summary_meta,
  }
}

function extractHealthUrl(status_note: string | null | undefined): string | undefined {
  if (!status_note) return undefined
  const m = status_note.match(/health=(\S+)/)
  return m ? m[1] : undefined
}

// POST /api/ops/complete — body { id, summary, evidence_url? }
// Wrapped through Guard Layer (P0.5) when IDEMPOTENCY_KEYS is bound:
//   - idempotency check (replay-safe)
//   - health_probe + ci_run_check verifiers BEFORE promotion
//   - audit log → brain/06-meta/auto-actions/
//   - Ship's Doctor ping on block/failure
// Falls back to direct call when KV is unbound (rollout-safe).
app.post('/api/ops/complete', async (c) => {
  let body: { id?: string; summary?: string; evidence_url?: string }
  try { body = await c.req.json() } catch { return c.json({ error: 'bad_json' }, 400) }
  const { id, summary, evidence_url } = body
  if (!id || !summary) return c.json({ error: 'missing_fields', hint: '{id, summary, evidence_url?}' }, 400)

  // Look up OPS item so Guard Layer can attribute the action correctly.
  // Avoid a fetch when KV is unbound (keeps the legacy path fast).
  if (!c.env.IDEMPOTENCY_KEYS) {
    const result = await completeOpsItem(c.env, id, summary, evidence_url)
    return c.json(
      result,
      result.ok ? 200 : (result.error === 'not_found' ? 404 : (result.error === 'not_in_active' ? 409 : 500))
    )
  }

  const headers = githubHeaders(c.env.GITHUB_TOKEN)
  const file = await getFileContent(OPS_BOARD_PATH, headers)
  const parsed = file ? parseOpsBoard(decodeBase64Content(file.content)) : null
  const item = parsed?.sections.active.find((i) => i.id === id)
  if (!item) {
    // Defer to legacy handler to keep error semantics (not_found vs not_in_active).
    const result = await completeOpsItem(c.env, id, summary, evidence_url)
    return c.json(
      result,
      result.ok ? 200 : (result.error === 'not_found' ? 404 : (result.error === 'not_in_active' ? 409 : 500))
    )
  }

  const guarded = await completeOpsItemGuarded(c.env, item, summary, evidence_url, {
    trigger: {
      type: 'manual',
      details: { route: '/api/ops/complete' },
    },
  })
  const r = guarded.result
  return c.json(
    { ...r, guard_layer: guarded.guard_layer },
    r.ok ? 200 : (r.error === 'not_found' ? 404 : (r.error === 'not_in_active' ? 409 : r.error === 'blocked_verifier' ? 409 : 500))
  )
})

// POST /api/ops/reopen — body { id, reason? }
// Reverse command for ops_board_promote (Guard Layer evidence
// reversible_via.command='ops_board_reopen'). Moves a COMPLETED row back to ACTIVE.
// Does NOT run substrate verifiers — reopen is intentionally permissive (recovery action).
app.post('/api/ops/reopen', async (c) => {
  let body: { id?: string; reason?: string }
  try { body = await c.req.json() } catch { return c.json({ error: 'bad_json' }, 400) }
  const { id, reason } = body
  if (!id) return c.json({ error: 'missing_fields', hint: '{id, reason?}' }, 400)

  const result = await reopenOpsItem(c.env, id, reason)
  return c.json(
    result,
    result.ok ? 200 : (result.error === 'not_found' ? 404 : (result.error === 'not_in_completed' ? 409 : 500))
  )
})

async function reopenOpsItem(
  env: Env,
  id: string,
  reason?: string
): Promise<
  | { ok: true; board_sha?: string; commit_url?: string; moved_id: string }
  | { ok: false; error: string; current_section?: string; status?: number; detail?: string }
> {
  const headers = githubHeaders(env.GITHUB_TOKEN)
  return await retryOnce(async () => {
    const file = await getFileContent(OPS_BOARD_PATH, headers)
    if (!file) return { ok: false, error: 'fetch_failed' as const }
    const parsed = parseOpsBoard(decodeBase64Content(file.content))

    const item = parsed.sections.completed.find((i) => i.id === id)
    if (!item) {
      for (const s of ['urgent', 'active', 'backlog'] as OpsSection[]) {
        if (parsed.sections[s].find((i) => i.id === id)) {
          return { ok: false, error: 'not_in_completed' as const, current_section: s }
        }
      }
      return { ok: false, error: 'not_found' as const }
    }
    if (item.line_index == null) return { ok: false, error: 'no_line_index' as const }

    const today = isoDate()
    // Title in completed rows is encoded as **ID — TITLE**. Strip the wrapper.
    const titleMatch = item.title.match(/\*\*\s*[A-Z]+-[\w-]+\s*—\s*(.+?)\*\*/)
    const cleanTitle = titleMatch ? titleMatch[1].trim() : item.title.replace(/[*]/g, '').trim()
    const reasonNote = reason ? ` (reopened ${today}: ${reason})` : ` (reopened ${today})`
    const newRow = `| ${id} | ${cleanTitle} | — | ${reasonNote.trim()} |`

    const activeBounds = parsed.bounds.active
    if (!activeBounds || activeBounds.separator_line < 0) {
      return { ok: false, error: 'active_section_missing' as const }
    }
    const insertBeforeRemove = activeBounds.last_data_line >= 0
      ? activeBounds.last_data_line + 1
      : activeBounds.separator_line + 1

    const newLines = moveLine(parsed.raw_lines, item.line_index, insertBeforeRemove, newRow)
    const newContent = newLines.join('\n')

    const putRes = await putFile(
      OPS_BOARD_PATH,
      newContent,
      file.sha,
      `ops_board.reopen: ${id} → ACTIVE${reason ? ` (${reason.slice(0, 60)})` : ''}`,
      headers
    )
    if (!putRes.ok) {
      if (putRes.status === 409) return { ok: false, error: 'sha_stale' as const, retry: true }
      return { ok: false, error: 'worker_4xx' as const, status: putRes.status, detail: putRes.detail }
    }
    return {
      ok: true as const,
      board_sha: putRes.commit_sha,
      commit_url: putRes.commit_url,
      moved_id: id,
    }
  })
}

// POST /api/ops/escalate — body { id, reason, severity? }
// Posts to /api/telegram per clue-1 contract; does NOT mutate the board.
// NOTE: /api/telegram is a known black hole per OPS-041; this route is contract-conformant
// but observably non-delivering until OPS-041 is closed. Surface the response transparently.
app.post('/api/ops/escalate', async (c) => {
  let body: { id?: string; reason?: string; severity?: 'warn' | 'critical' }
  try { body = await c.req.json() } catch { return c.json({ error: 'bad_json' }, 400) }
  const { id, reason, severity = 'warn' } = body
  if (!id || !reason) return c.json({ error: 'missing_fields', hint: '{id, reason, severity?}' }, 400)
  if (reason.length < 4) return c.json({ error: 'reason_too_short' }, 400)

  const headers = githubHeaders(c.env.GITHUB_TOKEN)
  const file = await getFileContent(OPS_BOARD_PATH, headers)
  let item: OpsItem | undefined
  let context_section: OpsSection | undefined
  if (file) {
    const parsed = parseOpsBoard(decodeBase64Content(file.content))
    for (const s of ['urgent', 'active', 'backlog', 'completed'] as OpsSection[]) {
      const found = parsed.sections[s].find((i) => i.id === id)
      if (found) { item = found; context_section = s; break }
    }
  }

  const sevEmoji = severity === 'critical' ? '🚨' : '⚠️'
  const lines = [
    `${sevEmoji} *${severity.toUpperCase()} — ${id}*`,
    item ? `_${item.title.replace(/[*_`]/g, '').slice(0, 200)}_` : null,
    `Section: ${context_section ?? 'unknown'}`,
    item?.domain ? `Domain: ${item.domain}` : null,
    '',
    `*Reason:* ${reason}`,
  ].filter(Boolean) as string[]
  const text = lines.join('\n')

  let telegramRes: { ok: boolean; status: number; body: string }
  try {
    const r = await fetch(TELEGRAM_RELAY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, severity, ops_id: id }),
    })
    telegramRes = { ok: r.ok, status: r.status, body: await r.text() }
  } catch (e) {
    return c.json({ ok: false, error: 'telegram_relay_unreachable', detail: String(e) }, 502)
  }

  // Telegram message_id may not be returned by /api/telegram (black hole per OPS-041);
  // surface whatever the relay returned so callers can audit delivery
  let telegram_message_id: number | null = null
  try {
    const j = JSON.parse(telegramRes.body)
    telegram_message_id = j?.message_id ?? j?.result?.message_id ?? null
  } catch { /* relay returned non-JSON; that's fine */ }

  return c.json({
    ok: telegramRes.ok,
    telegram_message_id,
    relay_status: telegramRes.status,
    relay_body: telegramRes.body,
    item: item ? stripInternal(item) : null,
    note: 'OPS-041: /api/telegram does not currently relay to Telegram. relay_status=200 does NOT prove delivery.',
  })
})

// ─── Playtester Reports ──────────────────────────────────────────
// CI-driven smoke test reports from aether-chronicles (Godot) + chefos (Playwright).
// Shipped 2026-05-16 to unblock Layer-1/Layer-2 playtester pipeline (Grok narrated
// implementation without write tools; chat-Claude drafted schema; this route ships it).

interface PlaytesterScreen {
  screen: string
  status: 'pass' | 'fail'
  error: string | null
  console?: string[]
}

interface PlaytesterPayload {
  app: 'chefos' | 'aether-chronicles'
  run_id: string
  timestamp: string
  status: 'pass' | 'fail' | 'partial'
  results: PlaytesterScreen[]
  meta?: Record<string, unknown>
}

const PLAYTESTER_APPS = new Set(['chefos', 'aether-chronicles'])
const PLAYTESTER_STATUSES = new Set(['pass', 'fail', 'partial'])
const PLAYTESTER_KV_TTL_SECONDS = 60 * 60 * 24 * 90 // 90 days

app.use('/api/playtester/*', async (c, next) => {
  // Health probe is public — no secret required
  if (c.req.path === '/api/playtester/health') {
    return next()
  }
  const secret = c.req.header('x-webhook-secret')
  if (!secret || secret !== c.env.WEBHOOK_SECRET) {
    return c.json({ error: 'Unauthorized — invalid or missing webhook secret' }, 401)
  }
  await next()
})

// GET /api/playtester/health — public probe (no auth)
app.get('/api/playtester/health', (c) => c.json({
  status: 'ok',
  worker: 'thechefos-brain-write',
  module: 'playtester',
  version: '0.7.0',
  routes: ['POST /api/playtester/report', 'GET /api/playtester/run/:app/:run_id']
}))

// POST /api/playtester/report — accept CI smoke test report
app.post('/api/playtester/report', async (c) => {
  let body: PlaytesterPayload
  try {
    body = await c.req.json<PlaytesterPayload>()
  } catch {
    return c.json({ error: 'bad_json' }, 400)
  }

  // Validation
  if (!body.app || !PLAYTESTER_APPS.has(body.app)) {
    return c.json({ error: 'invalid_app', hint: "must be 'chefos' or 'aether-chronicles'" }, 400)
  }
  if (!body.run_id || typeof body.run_id !== 'string' || body.run_id.length > 200) {
    return c.json({ error: 'invalid_run_id' }, 400)
  }
  if (!/^[A-Za-z0-9._-]+$/.test(body.run_id)) {
    return c.json({ error: 'invalid_run_id_chars', hint: 'alphanumeric + . _ - only' }, 400)
  }
  if (!body.status || !PLAYTESTER_STATUSES.has(body.status)) {
    return c.json({ error: 'invalid_status', hint: "must be 'pass', 'fail', or 'partial'" }, 400)
  }
  if (!body.timestamp || typeof body.timestamp !== 'string') {
    return c.json({ error: 'invalid_timestamp' }, 400)
  }
  if (!Array.isArray(body.results)) {
    return c.json({ error: 'invalid_results', hint: 'must be array of {screen, status, error}' }, 400)
  }

  const total = body.results.length
  const failures = body.results.filter((r) => r && r.status === 'fail')
  const failedScreens = failures.map((r) => r.screen).slice(0, 20)

  // 1. Write full report to KV
  const kvKey = `playtester:run:${body.app}:${body.run_id}`
  try {
    await c.env.SESSION_KV.put(kvKey, JSON.stringify(body), {
      expirationTtl: PLAYTESTER_KV_TTL_SECONDS,
    })
  } catch (err) {
    return c.json({ error: 'kv_write_failed', details: String(err) }, 500)
  }

  // 2. Write brain node (forensic record of every run, pass or fail)
  const isoDate = body.timestamp.slice(0, 10) // YYYY-MM-DD from ISO8601
  const brainPath = `brain/05-leads/_playtester/${isoDate}/${body.app}-${body.run_id}.json`
  const reportRecord = {
    ...body,
    summary: {
      total,
      failures: failures.length,
      failed_screens: failedScreens,
    },
    received_at: new Date().toISOString(),
  }
  const reportJson = JSON.stringify(reportRecord, null, 2)
  const contentBase64 = btoa(unescape(encodeURIComponent(reportJson)))
  const headers = githubHeaders(c.env.GITHUB_TOKEN)
  let brainCommitSha: string | null = null
  let brainWriteError: string | null = null

  try {
    const createRes = await fetch(
      `${GITHUB_API}/repos/${REPO_OWNER}/${REPO_NAME}/contents/${brainPath}`,
      {
        method: 'PUT',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: `playtester: ${body.app}/${body.run_id} ${body.status} (${failures.length}/${total} failed)`,
          content: contentBase64,
          committer: COMMITTER,
        }),
      }
    )
    if (createRes.ok) {
      const createData = await createRes.json() as { commit: { sha: string } }
      brainCommitSha = createData.commit.sha
    } else {
      const errText = await createRes.text()
      brainWriteError = `github ${createRes.status}: ${errText.slice(0, 200)}`
    }
  } catch (err) {
    brainWriteError = `fetch_failed: ${String(err).slice(0, 200)}`
  }

  // 3. On fail/partial: send Ship's Doctor Telegram ping
  let pingResult: 'sent' | 'skipped' | 'failed' = 'skipped'
  if (body.status !== 'pass') {
    const token = c.env.SHIPS_DOCTOR_BOT_TOKEN || c.env.MASTRO_BOT_TOKEN
    const chatId = c.env.TYLER_CHAT_ID || '6091970994'
    if (token) {
      const screensTxt = failedScreens.length > 0 ? failedScreens.join(', ') : '(no screens listed)'
      const msg =
        `🩺 Playtester ${body.status.toUpperCase()} — ${body.app}\n` +
        `Run: ${body.run_id}\n` +
        `Failed: ${failures.length}/${total} → ${screensTxt}\n` +
        `KV: ${kvKey}` +
        (brainCommitSha ? `\nBrain: ${brainPath}@${brainCommitSha.slice(0, 8)}` : '')
      try {
        const tgRes = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: chatId, text: msg }),
          signal: AbortSignal.timeout(8000),
        })
        pingResult = tgRes.ok ? 'sent' : 'failed'
      } catch {
        pingResult = 'failed'
      }
    }
  }

  return c.json({
    ok: true,
    kv_key: kvKey,
    brain_path: brainPath,
    brain_sha: brainCommitSha,
    brain_write_error: brainWriteError,
    ping: pingResult,
    summary: { total, failures: failures.length, status: body.status },
  })
})

// GET /api/playtester/run/:app/:run_id — fetch a specific run from KV
app.get('/api/playtester/run/:app/:run_id', async (c) => {
  const secret = c.req.header('x-webhook-secret')
  if (!secret || secret !== c.env.WEBHOOK_SECRET) {
    return c.json({ error: 'Unauthorized' }, 401)
  }
  const { app: appName, run_id } = c.req.param()
  if (!PLAYTESTER_APPS.has(appName)) {
    return c.json({ error: 'invalid_app' }, 400)
  }
  const kvKey = `playtester:run:${appName}:${run_id}`
  const raw = await c.env.SESSION_KV.get(kvKey)
  if (!raw) return c.json({ error: 'not_found', kv_key: kvKey }, 404)
  try {
    return c.json(JSON.parse(raw))
  } catch {
    return c.json({ error: 'corrupt_kv_payload', kv_key: kvKey }, 500)
  }
})

// Health check
app.get('/health', (c) => c.json({ status: 'ok', worker: 'thechefos-brain-write', version: '0.7.0', features: ['brain-push', 'session-state', 'github-webhook', 'ops-board', 'playtester'] }))

export default app

// ─── OPS-BOARD parser (LOCKED contract per clue-1 COMPLETE.md) ──

export function parseOpsBoard(content: string): ParsedOpsBoard {
  const lines = content.split('\n')
  const sections: Record<OpsSection, OpsItem[]> = {
    urgent: [],
    active: [],
    backlog: [],
    completed: [],
  }
  const bounds: Partial<Record<OpsSection, SectionBounds>> = {}

  let currentSection: OpsSection | null = null
  let currentBounds: SectionBounds | null = null
  let headerSeen = false
  let separatorSeen = false

  const closeOut = () => {
    if (currentSection && currentBounds) bounds[currentSection] = currentBounds
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    if (line.startsWith('## ')) {
      closeOut()
      let nextSection: OpsSection | null = null
      if (line.startsWith('## 🔴 URGENT')) nextSection = 'urgent'
      else if (line.startsWith('## ✅ COMPLETED')) nextSection = 'completed'
      else if (line.startsWith('## 🟡 ACTIVE')) nextSection = 'active'
      else if (line.startsWith('## 🟢 BACKLOG')) nextSection = 'backlog'

      currentSection = nextSection
      if (currentSection) {
        currentBounds = {
          h2_line: i,
          header_line: -1,
          separator_line: -1,
          first_data_line: -1,
          last_data_line: -1,
        }
      } else {
        currentBounds = null
      }
      headerSeen = false
      separatorSeen = false
      continue
    }

    if (!currentSection || !currentBounds) continue

    if (line.startsWith('|')) {
      if (!headerSeen) {
        currentBounds.header_line = i
        headerSeen = true
        continue
      }
      if (!separatorSeen) {
        currentBounds.separator_line = i
        separatorSeen = true
        continue
      }
      // Data row
      if (currentBounds.first_data_line === -1) currentBounds.first_data_line = i
      currentBounds.last_data_line = i

      const cells = line.split('|').slice(1, -1).map((c) => c.trim())
      if (cells.length < 2) continue

      let item: OpsItem
      if (currentSection === 'completed') {
        const taskCell = cells[0]
        const m = taskCell.match(/\*\*\s*([A-Z]+-[\w-]+)/)
        let id: string
        if (m) {
          id = m[1]
        } else {
          id = synthesizeId(taskCell)
        }
        item = {
          id,
          title: taskCell,
          section: 'completed',
          status_note: cells[1] ?? null,
          raw_line: line,
          line_index: i,
        }
      } else {
        let id = cells[0].replace(/[*`]/g, '').trim()
        const title = cells[1] ?? ''
        let domain: string | null = null
        let status_note: string | null = null

        if (currentSection === 'urgent') {
          status_note = cells[2] ?? null
        } else if (currentSection === 'active') {
          domain = cells[2] ?? null
          status_note = cells[3] ?? null
        } else if (currentSection === 'backlog') {
          domain = cells[2] ?? null
          status_note = cells[3] ?? null
        }

        if (!id) id = synthesizeId(title)
        item = {
          id,
          title,
          section: currentSection,
          domain,
          status_note,
          raw_line: line,
          line_index: i,
        }
      }
      sections[currentSection].push(item)
    }
  }
  closeOut()
  return { raw_lines: lines, sections, bounds }
}

function synthesizeId(seed: string): string {
  const cleaned = seed.replace(/[*_`]/g, '').trim().slice(0, 40)
  const slug = cleaned.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return `task-${slug || 'unknown'}`
}

function stripInternal(item: OpsItem): Omit<OpsItem, 'raw_line' | 'line_index'> {
  const { raw_line, line_index, ...rest } = item
  return rest
}

// Build new ACTIVE-table row from a URGENT/BACKLOG source item
function buildClaimRow(item: OpsItem, agent: string, today: string): string {
  // ACTIVE schema: | ID | Task | Domain | Notes |
  const id = item.id  // preserve original (with bold if it was synthesized that way)
  const cleanTitle = (item.title || '').trim()
  const domain = (item.domain && item.domain.length) ? item.domain : '—'
  // Strip any pre-existing claim annotation, then append the fresh one
  const baseNote = (item.status_note || '').replace(/\s*\(claimed by [^)]+, \d{4}-\d{2}-\d{2}\)\s*$/, '').trim()
  const claimAnnot = `(claimed by ${agent}, ${today})`
  const notes = baseNote ? `${baseNote} ${claimAnnot}` : claimAnnot
  return `| ${id} | ${cleanTitle} | ${domain} | ${notes} |`
}

// Build new COMPLETED-table row from an ACTIVE source item
function buildCompletedRow(item: OpsItem, summary: string, today: string, evidence_url?: string): string {
  // COMPLETED schema: | Task | Notes |  with ID embedded as **ID — TITLE**
  const titleClean = (item.title || '').replace(/^\*+\s*|\s*\*+$/g, '').trim()
  const evidence = evidence_url ? ` ([evidence](${evidence_url}))` : ''
  return `| **${item.id} — ${titleClean}** | ${today} — ${summary}${evidence} |`
}

// Single atomic line splice: remove fromIdx, insert newContent at toIdxBeforeRemove (interpreted in original line array)
function moveLine(lines: string[], fromIdx: number, toIdxBeforeRemove: number, newContent: string): string[] {
  const out = [...lines]
  out.splice(fromIdx, 1)
  const adjustedTo = fromIdx < toIdxBeforeRemove ? toIdxBeforeRemove - 1 : toIdxBeforeRemove
  out.splice(adjustedTo, 0, newContent)
  return out
}

// Extract the Notes cell from a row built for a given section
function extractStatusFromRow(row: string, section: OpsSection): string | null {
  const cells = row.split('|').slice(1, -1).map((c) => c.trim())
  if (section === 'urgent') return cells[2] ?? null
  if (section === 'active' || section === 'backlog') return cells[3] ?? null
  if (section === 'completed') return cells[1] ?? null
  return null
}

// Generic "try once, retry on retry-flagged failure" wrapper
async function retryOnce<T extends { ok: boolean; retry?: boolean; error?: string }>(
  op: () => Promise<T>
): Promise<T> {
  const first = await op()
  if (first.ok || !first.retry) return first
  // wait briefly to let GitHub catch up
  await sleep(750)
  return op()
}

function sleep(ms: number): Promise<void> { return new Promise((r) => setTimeout(r, ms)) }

function isoDate(): string {
  return new Date().toISOString().split('T')[0]
}

// PUT a file via GitHub Contents API; returns commit info or 4xx/5xx detail
async function putFile(
  path: string,
  content: string,
  sha: string,
  message: string,
  headers: Record<string, string>
): Promise<
  | { ok: true; commit_sha: string; commit_url: string; status: number }
  | { ok: false; status: number; detail: string }
> {
  const contentBase64 = btoa(unescape(encodeURIComponent(content)))
  const res = await fetch(
    `${GITHUB_API}/repos/${REPO_OWNER}/${REPO_NAME}/contents/${path}`,
    {
      method: 'PUT',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, content: contentBase64, sha, committer: COMMITTER }),
    }
  )
  if (!res.ok) {
    const detail = await res.text()
    return { ok: false, status: res.status, detail }
  }
  const data = await res.json() as { commit: { sha: string; html_url: string } }
  return { ok: true, commit_sha: data.commit.sha, commit_url: data.commit.html_url, status: res.status }
}

function githubHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'SuperClaude-Brain-Ops',
    'X-GitHub-Api-Version': '2022-11-28',
  }
}

// ─── Helpers (existing) ──────────────────────────────────────────

interface GitHubFileContent {
  sha: string
  content: string
}

async function fetchFileTextAtRef(
  path: string,
  ref: string,
  token: string,
): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  const url = `${GITHUB_API}/repos/${REPO_OWNER}/${REPO_NAME}/contents/${path}?ref=${ref}`
  try {
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github.raw',
        'User-Agent': 'thechefos-workers-complete-validator/1.0',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    })
    if (!res.ok) return { ok: false, error: `github_${res.status}` }
    const text = await res.text()
    return { ok: true, text }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

async function getFileContent(
  path: string,
  headers: Record<string, string>
): Promise<GitHubFileContent | null> {
  const res = await fetch(
    `${GITHUB_API}/repos/${REPO_OWNER}/${REPO_NAME}/contents/${path}`,
    { headers }
  )
  if (res.status === 404) return null
  if (!res.ok) return null
  const data = await res.json() as GitHubFileContent
  return data
}

async function appendToGraphIndex(
  nodePath: string,
  summary: string,
  headers: Record<string, string>
): Promise<void> {
  const indexPath = 'brain/GRAPH-INDEX.md'
  const existing = await getFileContent(indexPath, headers)
  if (!existing) return

  const currentContent = decodeBase64Content(existing.content)
  const today = new Date().toISOString().split('T')[0]
  const domain = domainFromPath(nodePath)
  const filename = nodePath.split('/').pop() ?? nodePath
  const newEntry = `\n| \`HOT\` | ${filename} | ${domain} | ${summary} | _auto-pushed ${today}_ |`
  const updatedContent = currentContent.trimEnd() + '\n' + newEntry + '\n'
  const contentBase64 = btoa(unescape(encodeURIComponent(updatedContent)))

  await fetch(
    `${GITHUB_API}/repos/${REPO_OWNER}/${REPO_NAME}/contents/${indexPath}`,
    {
      method: 'PUT',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: `brain-ops: auto-index ${filename}`,
        content: contentBase64,
        sha: existing.sha,
        committer: COMMITTER,
      }),
    }
  )
}

function decodeBase64Content(encoded: string): string {
  const cleaned = encoded.replace(/\n/g, '')
  return decodeURIComponent(escape(atob(cleaned)))
}

function domainFromPath(path: string): string {
  if (path.includes('00-inbox')) return 'inbox'
  if (path.includes('00-session')) return 'session'
  if (path.includes('01-daily')) return 'daily'
  if (path.includes('02-personal/family')) return 'family'
  if (path.includes('02-personal')) return 'personal'
  if (path.includes('03-professional/chef')) return 'chef'
  if (path.includes('04-projects')) return 'projects'
  if (path.includes('05-knowledge/connections')) return 'connections'
  if (path.includes('05-knowledge/patterns')) return 'patterns'
  if (path.includes('05-knowledge')) return 'knowledge'
  if (path.includes('06-meta')) return 'meta'
  return 'brain'
}

async function verifyGitHubSignature(
  secret: string,
  payload: string,
  signature: string
): Promise<boolean> {
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(payload))
  const expected =
    'sha256=' +
    Array.from(new Uint8Array(sig))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
  return expected.length === signature.length && expected === signature
}
