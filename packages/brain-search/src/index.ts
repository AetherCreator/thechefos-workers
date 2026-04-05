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
  GITHUB_TOKEN: string
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
    const text = stripFrontmatter(body.content).slice(0, 1000)
    const embedding = await c.env.AI.run(EMBEDDING_MODEL, { text: [text] }) as { data: number[][] }

    const vector: VectorizeVector = {
      id: pathToVectorId(body.path),
      values: embedding.data[0],
      metadata: {
        path: body.path,
        domain: domainFromPath(body.path),
        preview: stripFrontmatter(body.content).slice(0, 200),
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
    const tree = await treeResp.json() as { tree: { path: string; type: string }[] }
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
  const body = await c.req.json<{ query: string; limit?: number }>()
  const query = body.query?.trim()
  if (!query) {
    return c.json({ error: 'Missing required field: query' }, 400)
  }
  const limit = Math.min(body.limit ?? 5, 20)

  return await performSearch(c.env, query, limit)
})

// GET variant for quick testing
app.get('/api/brain/search', async (c) => {
  const query = c.req.query('q')?.trim()
  if (!query) {
    return c.json({ error: 'Missing query parameter: q' }, 400)
  }
  const limit = Math.min(Number(c.req.query('limit')) || 5, 20)

  return await performSearch(c.env, query, limit)
})

async function performSearch(env: Env, query: string, limit: number): Promise<Response> {
  try {
    // Embed the query
    const embedding = await env.AI.run(EMBEDDING_MODEL, { text: [query] }) as { data: number[][] }
    const queryVector = embedding.data[0]

    // Query Vectorize
    const matches = await env.VECTORIZE.query(queryVector, {
      topK: limit,
      returnMetadata: 'all',
    })

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

// --- GitHub helpers ---

function githubHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'SuperClaude-Brain-Search',
    'X-GitHub-Api-Version': '2022-11-28',
  }
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
  // Replace / with -- for URL-safe vector IDs
  return path.replace(/\//g, '--')
}

function vectorIdToPath(id: string): string {
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
