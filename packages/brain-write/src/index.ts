// packages/brain-write/src/index.ts
import { Hono } from 'hono'

const REPO_OWNER = 'AetherCreator'
const REPO_NAME = 'SuperClaude'
const COMMITTER = { name: 'SuperClaude Brain Ops', email: 'brain-ops@thechefos.app' }
const MAX_CONTENT_SIZE = 50 * 1024 // 50KB
const GITHUB_API = 'https://api.github.com'

export interface Env {
  GITHUB_TOKEN: string
  WEBHOOK_SECRET: string
}

interface BrainPushPayload {
  path: string
  content: string
  message: string
}

const app = new Hono<{ Bindings: Env }>()

// Auth middleware — require WEBHOOK_SECRET on every request
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

  // --- Validation ---
  if (!body.path || !body.content || !body.message) {
    return c.json({ error: 'Missing required fields: path, content, message' }, 400)
  }

  // Path must start with brain/
  if (!body.path.startsWith('brain/')) {
    return c.json({ error: 'Path must start with brain/' }, 400)
  }

  // Block path traversal
  if (body.path.includes('..')) {
    return c.json({ error: 'Path traversal not allowed' }, 400)
  }

  // Content size limit
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
    // --- Duplicate detection: check if file already exists ---
    const existingFile = await getFileContent(body.path, headers)
    const contentBase64 = btoa(unescape(encodeURIComponent(body.content)))

    let commitSha: string

    if (existingFile) {
      // Update existing file
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
      // Create new file
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

    // --- GRAPH-INDEX auto-update ---
    await appendToGraphIndex(body.path, body.message, headers)

    return c.json({ ok: true, sha: commitSha, path: body.path, updated: !!existingFile })
  } catch (err) {
    return c.json({ error: 'Internal error', details: String(err) }, 500)
  }
})

// Health check
app.get('/health', (c) => c.json({ status: 'ok', worker: 'thechefos-brain-write' }))

export default app

// --- Helpers ---

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

  // Determine domain from path
  const domain = domainFromPath(nodePath)
  const filename = nodePath.split('/').pop() ?? nodePath

  // Append entry below the last line
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
  // GitHub returns base64 with newlines
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
