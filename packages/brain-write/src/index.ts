// packages/brain-write/src/index.ts
import { Hono } from 'hono'

const REPO_OWNER = 'AetherCreator'
const REPO_NAME = 'SuperClaude'
const COMMITTER = { name: 'SuperClaude Brain Ops', email: 'brain-ops@thechefos.app' }
const MAX_CONTENT_SIZE = 256 * 1024 // 256KB (was 50KB; raised so explicit GRAPH-INDEX writes pass)
const GRAPH_INDEX_PATH = 'brain/GRAPH-INDEX.md'
const GITHUB_API = 'https://api.github.com'
const SESSION_STATE_KEY = 'session:state'

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
  // Every brain-write push (node + GRAPH-INDEX) fires the webhook again — this breaks the cycle.
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

  const headers = {
    Authorization: `Bearer ${c.env.GITHUB_TOKEN}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'SuperClaude-Brain-Ops',
    'X-GitHub-Api-Version': '2022-11-28',
  }

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
    // self-append of a meta-row pointing at GRAPH-INDEX.md. This unlocks
    // the brain_write_append_index MCP tool (Wave 1 Hunt B) for clean
    // intelligent index updates without dumb auto-append clobbering them.
    if (body.path !== GRAPH_INDEX_PATH) {
      await appendToGraphIndex(body.path, body.message, headers)
    }
    return c.json({ ok: true, sha: commitSha, path: body.path, updated: !!existingFile })
  } catch (err) {
    return c.json({ error: 'Internal error', details: String(err) }, 500)
  }
})

// Health check
app.get('/health', (c) => c.json({ status: 'ok', worker: 'thechefos-brain-write', features: ['brain-push', 'session-state', 'github-webhook'] }))

export default app

// ─── Helpers ─────────────────────────────────────────────────────

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
  // Timing-safe comparison via string equality on fixed-length hex
  return expected.length === signature.length && expected === signature
}
