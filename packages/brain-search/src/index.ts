// packages/brain-search/src/index.ts
import { Hono } from 'hono'

const REPO_OWNER = 'AetherCreator'
const REPO_NAME = 'SuperClaude'
const GITHUB_API = 'https://api.github.com'
const EMBEDDING_MODEL = '@cf/baai/bge-base-en-v1.5'
const BATCH_SIZE = 20 // Vectorize upsert limit

export interface Env {
  AI: Ai
  VECTORIZE: VectorizeIndex
  GITHUB_TOKEN?: string
}

interface BrainFile {
  path: string
  content: string
}

interface SearchResult {
  path: string
  score: number
  preview: string
  githubUrl: string
}

const app = new Hono<{ Bindings: Env }>()

// --- Clue 1: Health check ---
app.get('/health', (c) =>
  c.json({ status: 'ok', worker: 'thechefos-brain-search', index: 'superclaude-brain' })
)

// --- Per-file ingest (for n8n auto-vectorize on push) ---
app.post('/api/brain/ingest', async (c) => {
  const body = await c.req.json<{ path: string; content: string }>()
  if (!body.path || !body.content) {
    return c.json({ error: 'Missing required fields: path, content' }, 400)
  }

  try {
    const content = stripFrontmatter(body.content)
    const text = content.slice(0, 1000)
    const embedding = await c.env.AI.run(EMBEDDING_MODEL, { text: [text] }) as { data: number[][] }

    const vector: VectorizeVector = {
      id: pathToVectorId(body.path),
      values: embedding.data[0],
      metadata: {
        path: body.path,
        domain: domainFromPath(body.path),
        node_type: detectNodeType(body.content),
        status: 'active',
        recency_tier: computeRecencyTier(body.path, body.content),
        preview: content.slice(0, 200),
      },
    }

    await c.env.VECTORIZE.upsert([vector])

    return c.json({
      ok: true,
      path: body.path,
      vectorId: pathToVectorId(body.path),
      domain: domainFromPath(body.path),
    })
  } catch (err) {
    return c.json({ error: 'Ingest failed', details: String(err) }, 500)
  }
})

// --- Clue 2: Brain indexer ---
app.post('/api/brain/index', async (c) => {
  const headers = githubHeaders(c.env.GITHUB_TOKEN)
  const errors: string[] = []

  // Paginated — run multiple times to index all nodes
  // ?offset=0&limit=20 (default), increment offset each run
  const offset = Number(c.req.query('offset') ?? 0)
  const pageSize = Math.min(Number(c.req.query('limit') ?? BATCH_SIZE), BATCH_SIZE)

  try {
    // 1 subrequest: get full tree
    const treeResp = await fetch(
      `${GITHUB_API}/repos/${REPO_OWNER}/${REPO_NAME}/git/trees/main?recursive=1`,
      { headers }
    )
    const treeBody = await treeResp.text()
    if (!treeResp.ok) {
      return c.json({ error: 'GitHub tree fetch failed', status: treeResp.status, details: treeBody }, 500)
    }
    const tree = JSON.parse(treeBody) as { tree?: { path: string; type: string }[] }
    if (!tree.tree) {
      return c.json({ error: 'GitHub tree missing', status: treeResp.status, details: treeBody.slice(0, 500) }, 500)
    }
    const allPaths = tree.tree
      .filter((f) => f.path.startsWith('brain/') && f.path.endsWith('.md') && f.type === 'blob')
      .map((f) => f.path)

    const total = allPaths.length
    const page = allPaths.slice(offset, offset + pageSize)

    if (page.length === 0) {
      return c.json({ indexed: 0, total, offset, done: true, message: 'All nodes indexed ✅' })
    }

    // Fetch file contents (pageSize subrequests)
    const files: BrainFile[] = []
    for (const path of page) {
      try {
        const r = await fetch(
          `${GITHUB_API}/repos/${REPO_OWNER}/${REPO_NAME}/contents/${path}`,
          { headers: { ...headers, Accept: 'application/vnd.github.v3.raw' } }
        )
        if (r.ok) files.push({ path, content: await r.text() })
      } catch (_) { errors.push(`fetch:${path}`) }
    }

    // Embed + upsert
    const texts = files.map((f) => stripFrontmatter(f.content).slice(0, 1000))
    const embeddings = await c.env.AI.run(EMBEDDING_MODEL, { text: texts }) as { data: number[][] }

    const vectors: VectorizeVector[] = files.map((file, idx) => ({
      id: pathToVectorId(file.path),
      values: embeddings.data[idx],
      metadata: {
        path: file.path,
        domain: domainFromPath(file.path),
        node_type: detectNodeType(file.content),
        status: 'active',
        recency_tier: computeRecencyTier(file.path, file.content),
        preview: stripFrontmatter(file.content).slice(0, 200),
      },
    }))

    await c.env.VECTORIZE.upsert(vectors)

    const nextOffset = offset + pageSize
    const done = nextOffset >= total

    return c.json({
      indexed: files.length,
      total,
      offset,
      nextOffset: done ? null : nextOffset,
      done,
      errors,
      message: done
        ? 'All nodes indexed! ✅'
        : `Run next: POST /api/brain/index?offset=${nextOffset}`,
    })
  } catch (err) {
    return c.json({ error: 'Indexing failed', details: String(err) }, 500)
  }
})

app.post('/api/brain/search', async (c) => {
  const body = await c.req.json<{
    query: string; limit?: number;
    domain?: string; node_type?: string; status?: string; recency_tier?: string;
  }>()
  const query = body.query?.trim()
  if (!query) {
    return c.json({ error: 'Missing required field: query' }, 400)
  }
  const limit = Math.min(body.limit ?? 5, 20)

  const filter: Record<string, string> = {}
  if (body.domain) filter.domain = body.domain
  if (body.node_type) filter.node_type = body.node_type
  if (body.status) filter.status = body.status
  if (body.recency_tier) filter.recency_tier = body.recency_tier

  return await performSearch(c.env, query, limit,
    Object.keys(filter).length > 0 ? filter : undefined)
})

// GET variant for quick testing
app.get('/api/brain/search', async (c) => {
  const query = c.req.query('q')?.trim()
  if (!query) {
    return c.json({ error: 'Missing query parameter: q' }, 400)
  }
  const limit = Math.min(Number(c.req.query('limit')) || 5, 20)

  const filter: Record<string, string> = {}
  if (c.req.query('domain')) filter.domain = c.req.query('domain')!
  if (c.req.query('node_type')) filter.node_type = c.req.query('node_type')!
  if (c.req.query('status')) filter.status = c.req.query('status')!
  if (c.req.query('recency_tier')) filter.recency_tier = c.req.query('recency_tier')!

  return await performSearch(c.env, query, limit,
    Object.keys(filter).length > 0 ? filter : undefined)
})

async function performSearch(
  env: Env, query: string, limit: number,
  filter?: Record<string, string>
): Promise<Response> {
  try {
    // Embed the query
    const embedding = await env.AI.run(EMBEDDING_MODEL, { text: [query] }) as { data: number[][] }
    const queryVector = embedding.data[0]

    // Query Vectorize
    const queryOpts: VectorizeQueryOptions = { topK: limit, returnMetadata: 'all' }
    if (filter) queryOpts.filter = filter
    const matches = await env.VECTORIZE.query(queryVector, queryOpts)

    const headers = githubHeaders(env.GITHUB_TOKEN)

    // Fetch content for each match
    const results: SearchResult[] = await Promise.all(
      matches.matches.map(async (match) => {
        const path = (match.metadata?.path as string) || vectorIdToPath(match.id)
        const preview = (match.metadata?.preview as string) || ''
        let contentPreview = preview

        // Try to fetch fresh content from GitHub for a richer preview
        try {
          const content = await fetchFileContent(path, headers)
          if (content) {
            contentPreview = stripFrontmatter(content).slice(0, 200)
          }
        } catch {
          // Fall back to metadata preview
        }

        return {
          path,
          score: Math.round(match.score * 100) / 100,
          preview: contentPreview,
          githubUrl: `https://github.com/${REPO_OWNER}/${REPO_NAME}/blob/main/${path}`,
        }
      })
    )

    return new Response(JSON.stringify({ query, results }), {
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: 'Search failed', details: String(err) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}

// --- Metadata helpers ---

function detectNodeType(content: string): string {
  const lower = content.toLowerCase()
  if (lower.includes('## decision') || lower.includes('decided') || lower.includes('chose')) return 'decision'
  if (lower.includes('## insight') || lower.includes('## connections')) return 'insight'
  if (lower.includes('## pattern') || lower.includes('cross-domain')) return 'pattern'
  if (lower.includes('active-state') || lower.includes('## current')) return 'state'
  if (lower.includes('## log') || lower.includes('session log')) return 'log'
  return 'reference'
}

function computeRecencyTier(path: string, content: string): string {
  const dateMatch = content.match(/Date:\s*(\d{4}-\d{2}-\d{2})/i)
    || content.match(/(\d{4}-\d{2}-\d{2})/)
  if (dateMatch) {
    const daysAgo = (Date.now() - new Date(dateMatch[1]).getTime()) / 86_400_000
    if (daysAgo <= 30) return 'current'
    if (daysAgo <= 90) return 'recent'
    return 'archive'
  }
  if (path.includes('00-session')) return 'current'
  return 'recent'
}

// --- GitHub helpers ---

function githubHeaders(token?: string): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'SuperClaude-Brain-Search',
    'X-GitHub-Api-Version': '2022-11-28',
  }
  if (token) headers.Authorization = `Bearer ${token}`
  return headers
}

async function fetchBrainFiles(headers: Record<string, string>): Promise<BrainFile[]> {
  const files: BrainFile[] = []
  await walkTree('brain', headers, files)
  return files
}

async function walkTree(
  path: string,
  headers: Record<string, string>,
  files: BrainFile[]
): Promise<void> {
  const resp = await fetch(
    `${GITHUB_API}/repos/${REPO_OWNER}/${REPO_NAME}/contents/${path}`,
    { headers }
  )

  if (!resp.ok) return

  const items = (await resp.json()) as Array<{
    type: string
    path: string
    name: string
    download_url: string | null
  }>

  for (const item of items) {
    if (item.type === 'dir') {
      await walkTree(item.path, headers, files)
    } else if (item.type === 'file' && item.name.endsWith('.md')) {
      const content = await fetchFileContent(item.path, headers)
      if (content) {
        files.push({ path: item.path, content })
      }
    }
  }
}

async function fetchFileContent(
  path: string,
  headers: Record<string, string>
): Promise<string | null> {
  const resp = await fetch(
    `${GITHUB_API}/repos/${REPO_OWNER}/${REPO_NAME}/contents/${path}`,
    { headers: { ...headers, Accept: 'application/vnd.github.v3.raw' } }
  )
  if (!resp.ok) return null
  return resp.text()
}

// --- Utilities ---

function pathToVectorId(path: string): string {
  // Hash path to stay within Vectorize 64-byte ID limit.
  // Path is always stored in metadata.path — ID reversibility not needed.
  let h1 = 5381, h2 = 52711
  for (let i = 0; i < path.length; i++) {
    const c = path.charCodeAt(i)
    h1 = (((h1 << 5) + h1) ^ c) >>> 0
    h2 = (((h2 << 5) + h2) ^ c) >>> 0
  }
  return (h1.toString(36) + h2.toString(36)).padStart(14, '0')
}

function vectorIdToPath(id: string): string {
  // Only used as fallback when metadata.path is absent (legacy IDs)
  return id.replace(/--/g, '/')
}

function stripFrontmatter(content: string): string {
  // Remove YAML frontmatter (--- ... ---)
  const match = content.match(/^---\s*\n[\s\S]*?\n---\s*\n/)
  if (match) {
    return content.slice(match[0].length).trim()
  }
  return content.trim()
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

export default app
