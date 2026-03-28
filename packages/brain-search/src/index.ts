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

// --- Clue 2: Brain indexer ---
app.post('/api/brain/index', async (c) => {
  const headers = githubHeaders(c.env.GITHUB_TOKEN)
  const errors: string[] = []

  try {
    // Recursively fetch all markdown files from brain/
    const files = await fetchBrainFiles(headers)

    if (files.length === 0) {
      return c.json({ indexed: 0, errors: ['No brain files found'] })
    }

    let indexed = 0

    // Process in batches of BATCH_SIZE
    for (let i = 0; i < files.length; i += BATCH_SIZE) {
      const batch = files.slice(i, i + BATCH_SIZE)

      // Generate embeddings for the batch
      const texts = batch.map((f) => stripFrontmatter(f.content))
      const embeddings = await c.env.AI.run(EMBEDDING_MODEL, { text: texts }) as { data: number[][] }

      // Build vectors for upsert
      const vectors: VectorizeVector[] = batch.map((file, idx) => ({
        id: pathToVectorId(file.path),
        values: embeddings.data[idx],
        metadata: {
          path: file.path,
          domain: domainFromPath(file.path),
          preview: stripFrontmatter(file.content).slice(0, 200),
        },
      }))

      try {
        await c.env.VECTORIZE.upsert(vectors)
        indexed += batch.length
      } catch (err) {
        errors.push(`Batch ${i / BATCH_SIZE}: ${String(err)}`)
      }
    }

    return c.json({ indexed, total: files.length, errors })
  } catch (err) {
    return c.json({ error: 'Indexing failed', details: String(err) }, 500)
  }
})

// --- Clue 3: Search endpoint ---
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
