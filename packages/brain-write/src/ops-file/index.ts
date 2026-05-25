// /api/ops/file — insert a new row into OPS-BOARD.md with idempotency.
// Designed for automated callers (changelog-watcher, reflection-worker, etc.).
// Auth uses X-Brain-Write-Key header against BRAIN_WRITE_API_SECRET env var.

const REPO_OWNER = 'AetherCreator'
const REPO_NAME = 'SuperClaude'
const GITHUB_API = 'https://api.github.com'
const OPS_BOARD_PATH = 'brain/OPS-BOARD.md'
const COMMITTER = { name: 'SuperClaude Brain Ops', email: 'brain-ops@thechefos.app' }
const IDEMPOTENCY_TTL_SECONDS = 30 * 86400 // 30 days

export interface OpsFileEnv {
  GITHUB_TOKEN: string
  BRAIN_WRITE_API_SECRET?: string
  IDEMPOTENCY_KEYS?: KVNamespace
}

export interface OpsFilePayload {
  ops_id: string            // must match /^OPS-[A-Z0-9-]+$/
  priority: 'URGENT' | 'Normal' | 'Low'
  section: 'URGENT' | 'BACKLOG'
  title: string
  body: string
  auto_stale_at?: string    // ISO date; informational, stored in row if provided
  metadata?: Record<string, unknown>
}

interface IdempotencyRecord {
  ops_id: string
  commit_url: string
}

const OPS_ID_RE = /^OPS-[A-Z0-9-]+$/
const VALID_PRIORITIES = new Set(['URGENT', 'Normal', 'Low'])
const VALID_SECTIONS = new Set(['URGENT', 'BACKLOG'])

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

async function fetchOpsBoard(token: string): Promise<{ sha: string; content: string } | null> {
  const res = await fetch(
    `${GITHUB_API}/repos/${REPO_OWNER}/${REPO_NAME}/contents/${OPS_BOARD_PATH}`,
    { headers: ghHeaders(token) },
  )
  if (!res.ok) return null
  return res.json() as Promise<{ sha: string; content: string }>
}

function decodeB64(encoded: string): string {
  return decodeURIComponent(escape(atob(encoded.replace(/\n/g, ''))))
}

// Insert newRow after the last data row (|…) of the target section.
// sectionMarker = '## 🔴 URGENT' | '## 🟢 BACKLOG'
// If the section has no rows yet, inserts right after the table separator line.
export function insertRowIntoSection(content: string, sectionMarker: string, newRow: string): string {
  const lines = content.split('\n')
  let inSection = false
  let lastDataLine = -1
  let separatorLine = -1  // the `|---|---|` line within the section header

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    if (line.startsWith('## ')) {
      if (inSection) break  // hit the next section; stop scanning
      if (line.startsWith(sectionMarker)) inSection = true
      continue
    }

    if (!inSection) continue

    if (line.startsWith('|')) {
      if (separatorLine === -1 && line.match(/^\|[-| ]+\|/)) {
        separatorLine = i  // the `|----|` separator row
        continue
      }
      lastDataLine = i
    }
  }

  if (!inSection) return content  // section not found; no-op

  const insertAt = lastDataLine >= 0
    ? lastDataLine + 1
    : separatorLine >= 0
      ? separatorLine + 1
      : lines.length

  const result = [...lines]
  result.splice(insertAt, 0, newRow)
  return result.join('\n')
}

// Build the OPS-BOARD row string for the target section.
// URGENT  schema: | ID | Task | Status |      (3 cols)
// BACKLOG schema: | ID | Task | Domain | Priority | (4 cols)
function buildRow(p: OpsFilePayload): string {
  const domain = (p.metadata as Record<string, unknown>)?.domain as string || 'infra'
  if (p.section === 'URGENT') {
    return `| ${p.ops_id} | ${p.body} | ${p.priority} Open |`
  }
  return `| ${p.ops_id} | ${p.body} | ${domain} | ${p.priority} |`
}

export async function handleOpsFile(env: OpsFileEnv, req: Request): Promise<Response> {
  // Auth
  const key = req.headers.get('X-Brain-Write-Key')
  if (!key || key !== env.BRAIN_WRITE_API_SECRET) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Parse body
  let payload: OpsFilePayload
  try {
    payload = await req.json() as OpsFilePayload
  } catch {
    return Response.json({ error: 'bad_json' }, { status: 400 })
  }

  // Validate
  if (!payload.ops_id || !OPS_ID_RE.test(payload.ops_id)) {
    return Response.json({ error: 'invalid_ops_id', hint: 'must match /^OPS-[A-Z0-9-]+$/' }, { status: 400 })
  }
  if (!payload.priority || !VALID_PRIORITIES.has(payload.priority)) {
    return Response.json({ error: 'invalid_priority', hint: 'URGENT|Normal|Low' }, { status: 400 })
  }
  if (!payload.section || !VALID_SECTIONS.has(payload.section)) {
    return Response.json({ error: 'invalid_section', hint: 'URGENT|BACKLOG' }, { status: 400 })
  }
  if (!payload.title || typeof payload.title !== 'string') {
    return Response.json({ error: 'missing_title' }, { status: 400 })
  }
  if (!payload.body || typeof payload.body !== 'string') {
    return Response.json({ error: 'missing_body' }, { status: 400 })
  }

  // Idempotency check
  const idempKey = await sha256Hex(payload.ops_id)
  if (env.IDEMPOTENCY_KEYS) {
    const hit = await env.IDEMPOTENCY_KEYS.get(idempKey, 'json') as IdempotencyRecord | null
    if (hit) {
      return Response.json({ ok: true, ops_id: payload.ops_id, commit_url: hit.commit_url, idempotency_hit: true })
    }
  }

  // Fetch OPS-BOARD
  const file = await fetchOpsBoard(env.GITHUB_TOKEN)
  if (!file) {
    return Response.json({ error: 'ops_board_fetch_failed' }, { status: 502 })
  }
  const current = decodeB64(file.content)

  // Insert row into the right section
  const sectionMarker = payload.section === 'URGENT' ? '## 🔴 URGENT' : '## 🟢 BACKLOG'
  const newRow = buildRow(payload)
  const updated = insertRowIntoSection(current, sectionMarker, newRow)

  // PUT updated file
  const contentBase64 = btoa(unescape(encodeURIComponent(updated)))
  const putRes = await fetch(
    `${GITHUB_API}/repos/${REPO_OWNER}/${REPO_NAME}/contents/${OPS_BOARD_PATH}`,
    {
      method: 'PUT',
      headers: { ...ghHeaders(env.GITHUB_TOKEN), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: `ops_file: ${payload.ops_id} → ${payload.section} (${payload.priority})`,
        content: contentBase64,
        sha: file.sha,
        committer: COMMITTER,
      }),
    },
  )

  if (!putRes.ok) {
    const detail = await putRes.text()
    return Response.json(
      { error: 'github_put_failed', github_status: putRes.status, detail: detail.slice(0, 500) },
      { status: 502 },
    )
  }

  const putData = await putRes.json() as { commit: { sha: string; html_url: string } }
  const commit_url = putData.commit.html_url

  // Cache result in IDEMPOTENCY_KEYS
  if (env.IDEMPOTENCY_KEYS) {
    const record: IdempotencyRecord = { ops_id: payload.ops_id, commit_url }
    await env.IDEMPOTENCY_KEYS.put(idempKey, JSON.stringify(record), {
      expirationTtl: IDEMPOTENCY_TTL_SECONDS,
    })
  }

  return Response.json({ ok: true, ops_id: payload.ops_id, commit_url, idempotency_hit: false })
}
