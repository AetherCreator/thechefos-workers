// packages/brain-write/src/index.ts
import { Hono } from 'hono'

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

  // Scan all commits for COMPLETE.md files
  let foundComplete = false
  for (const commit of payload.commits) {
    const allFiles = [
      ...(commit.added || []),
      ...(commit.modified || []),
    ]
    for (const file of allFiles) {
      if (file.endsWith('COMPLETE.md')) {
        foundComplete = true
        break
      }
    }
    if (foundComplete) break
  }

  if (!foundComplete) {
    return c.json({ ok: true, action: 'no COMPLETE.md detected' })
  }

  // Clear the active hunt clue
  const raw = await c.env.SESSION_KV.get(SESSION_STATE_KEY)
  const current: SessionState = raw ? JSON.parse(raw) : { active_hunt_clue: null }
  const previousClue = current.active_hunt_clue
  current.active_hunt_clue = null
  await c.env.SESSION_KV.put(SESSION_STATE_KEY, JSON.stringify(current))

  return c.json({
    ok: true,
    action: 'gate_cleared',
    previous_clue: previousClue,
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
  if (!body.path.startsWith('brain/')) {
    return c.json({ error: 'Path must start with brain/' }, 400)
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
      const updateRes = await fetch(
        `${GITHUB_API}/repos/${REPO_OWNER}/${REPO_NAME}/contents/${body.path}`,
        {
          method: 'PUT',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: body.message,
            content: contentBase64,
            sha: existingFile.sha,
            committer: COMMITTER,
          }),
        }
      )
      if (!updateRes.ok) {
        const err = await updateRes.text()
        return c.json({ error: 'GitHub API error (update)', details: err }, 502)
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
        const err = await createRes.text()
        return c.json({ error: 'GitHub API error (create)', details: err }, 502)
      }
      const createData = await createRes.json() as { commit: { sha: string } }
      commitSha = createData.commit.sha
    }

    // Skip auto-append when the explicit target IS GRAPH-INDEX itself —
    // otherwise an explicit GRAPH-INDEX update would trigger a recursive
    // self-append of a meta-row pointing at GRAPH-INDEX.md.
    if (body.path !== GRAPH_INDEX_PATH) {
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

// POST /api/ops/complete — body { id, summary, evidence_url? }
app.post('/api/ops/complete', async (c) => {
  let body: { id?: string; summary?: string; evidence_url?: string }
  try { body = await c.req.json() } catch { return c.json({ error: 'bad_json' }, 400) }
  const { id, summary, evidence_url } = body
  if (!id || !summary) return c.json({ error: 'missing_fields', hint: '{id, summary, evidence_url?}' }, 400)
  if (summary.length < 4) return c.json({ error: 'summary_too_short' }, 400)

  const headers = githubHeaders(c.env.GITHUB_TOKEN)
  const result = await retryOnce(async () => {
    const file = await getFileContent(OPS_BOARD_PATH, headers)
    if (!file) return { ok: false, error: 'fetch_failed' as const }
    const parsed = parseOpsBoard(decodeBase64Content(file.content))

    const item = parsed.sections.active.find((i) => i.id === id)
    if (!item) {
      // Differentiate not_in_active vs not_found
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
    // Prepend = insert as first data row (right after separator)
    const insertBeforeRemove = completedBounds.separator_line + 1

    const newLines = moveLine(parsed.raw_lines, item.line_index, insertBeforeRemove, newRow)
    const newContent = newLines.join('\n')

    const putRes = await putFile(OPS_BOARD_PATH, newContent, file.sha, `ops_board.complete: ${id} → COMPLETED`, headers)
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
  return c.json(
    result,
    result.ok ? 200 : (result.error === 'not_found' ? 404 : (result.error === 'not_in_active' ? 409 : 500))
  )
})

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

// Health check
app.get('/health', (c) => c.json({ status: 'ok', worker: 'thechefos-brain-write', version: '0.6.0', features: ['brain-push', 'session-state', 'github-webhook', 'ops-board'] }))

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
