// packages/scout/src/index.ts
// thechefos-scout — Web fetching + search so Grok doesn't need paid tool calls
import { Hono } from 'hono'

export interface Env {
  SEARXNG_URL?: string  // e.g. https://searx.thechefos.app
  SHELL_BRIDGE_URL?: string  // n8n shell bridge for SearXNG proxy
  SHELL_BRIDGE_KEY?: string  // x-shell-key header value
  SCOUT_KV?: KVNamespace  // optional — degrades gracefully without it
}

interface SearchRequest {
  query: string
  limit?: number
}

interface FetchRequest {
  urls: string[]
}

interface SearchResult {
  url: string
  title: string
  snippet: string
}

interface PageResult {
  url: string
  title: string
  content: string
  cached: boolean
  error?: string
}

const app = new Hono<{ Bindings: Env }>()

const KV_TTL = 604800 // 7 days
const FETCH_TIMEOUT_MS = 8000
const MAX_CONTENT_LENGTH = 50000 // ~50KB per page max
const USER_AGENT = 'SuperClaude-Scout/1.0 (research assistant)'

// === HTML → clean text extraction ===
function extractText(html: string, url: string): { title: string; content: string } {
  // Extract title
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  const title = titleMatch ? titleMatch[1].replace(/\s+/g, ' ').trim() : url

  // Remove script, style, nav, footer, header, aside
  let text = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<nav[\s\S]*?<\/nav>/gi, '')
    .replace(/<footer[\s\S]*?<\/footer>/gi, '')
    .replace(/<header[\s\S]*?<\/header>/gi, '')
    .replace(/<aside[\s\S]*?<\/aside>/gi, '')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, '')

  // Convert common block elements to newlines
  text = text
    .replace(/<\/?(p|div|br|h[1-6]|li|tr|blockquote|section|article)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '') // strip remaining tags
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n') // collapse excess newlines
    .replace(/[ \t]+/g, ' ') // collapse whitespace
    .trim()

  // Truncate to max length
  if (text.length > MAX_CONTENT_LENGTH) {
    text = text.slice(0, MAX_CONTENT_LENGTH) + '\n\n[truncated]'
  }

  return { title, content: text }
}

// === Search via shell bridge (SearXNG on same VPS as n8n) ===
async function searchViaBridge(
  bridgeUrl: string,
  bridgeKey: string,
  query: string,
  limit: number
): Promise<{ results: SearchResult[]; error?: string }> {
  const escapedQuery = query.replace(/'/g, "'\\''")
  const cmd = `curl -s "http://localhost:8888/search?q=${encodeURIComponent(escapedQuery)}&format=json&engines=google,duckduckgo,bing&categories=general" -H "Accept: application/json"`

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 15000)

  const res = await fetch(bridgeUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-shell-key': bridgeKey,
    },
    body: JSON.stringify({ command: cmd }),
    signal: controller.signal,
  })
  clearTimeout(timer)

  if (!res.ok) {
    return { results: [], error: `Shell bridge returned ${res.status}` }
  }

  const bridgeResult = await res.json() as Array<{ stdout: string; stderr: string; returncode: number }>
  if (!bridgeResult?.[0]?.stdout) {
    return { results: [], error: 'Empty response from shell bridge' }
  }

  const data = JSON.parse(bridgeResult[0].stdout) as { results?: Array<{ url: string; title: string; content: string }> }
  const results: SearchResult[] = (data.results ?? [])
    .slice(0, limit)
    .map((r) => ({
      url: r.url,
      title: r.title || r.url,
      snippet: r.content || '',
    }))

  return { results }
}

// === Search endpoint ===
app.post('/search', async (c) => {
  const { query, limit = 5 }: SearchRequest = await c.req.json()

  // Prefer shell bridge (SearXNG on same VPS as n8n, avoids CF Worker → bare IP issues)
  if (c.env.SHELL_BRIDGE_URL && c.env.SHELL_BRIDGE_KEY) {
    try {
      const { results, error } = await searchViaBridge(
        c.env.SHELL_BRIDGE_URL, c.env.SHELL_BRIDGE_KEY, query, limit
      )
      if (error) return c.json({ error, results: [] }, 502)
      return c.json({ results })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown error'
      return c.json({ error: `Search failed: ${message}`, results: [] }, 502)
    }
  }

  // Fallback: direct SearXNG URL (works when SearXNG is on HTTPS/tunnel)
  const searxUrl = c.env.SEARXNG_URL
  if (!searxUrl) {
    return c.json({
      error: 'Neither SHELL_BRIDGE_URL nor SEARXNG_URL configured',
      results: [],
    }, 503)
  }

  try {
    const params = new URLSearchParams({
      q: query,
      format: 'json',
      engines: 'google,duckduckgo,bing',
      categories: 'general',
    })

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)

    const res = await fetch(`${searxUrl}/search?${params}`, {
      headers: { 'Accept': 'application/json' },
      signal: controller.signal,
    })
    clearTimeout(timer)

    if (!res.ok) {
      return c.json({ error: `SearXNG returned ${res.status}`, results: [] }, 502)
    }

    const data = await res.json() as { results?: Array<{ url: string; title: string; content: string }> }
    const results: SearchResult[] = (data.results ?? [])
      .slice(0, limit)
      .map((r) => ({
        url: r.url,
        title: r.title || r.url,
        snippet: r.content || '',
      }))

    return c.json({ results })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error'
    return c.json({ error: `SearXNG search failed: ${message}`, results: [] }, 502)
  }
})

// === Fetch endpoint ===
app.post('/fetch', async (c) => {
  const { urls }: FetchRequest = await c.req.json()

  if (!urls?.length) {
    return c.json({ error: 'No URLs provided', pages: [] }, 400)
  }

  const kv = c.env.SCOUT_KV // may be undefined

  const pages: PageResult[] = await Promise.all(
    urls.slice(0, 10).map(async (url): Promise<PageResult> => {
      try {
        // Check KV cache first
        if (kv) {
          const cached = await kv.get(url)
          if (cached) {
            const parsed = JSON.parse(cached) as PageResult
            return { ...parsed, cached: true }
          }
        }

        // Fetch the page
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)

        const res = await fetch(url, {
          headers: {
            'User-Agent': USER_AGENT,
            'Accept': 'text/html,application/xhtml+xml,text/plain',
          },
          redirect: 'follow',
          signal: controller.signal,
        })
        clearTimeout(timer)

        if (!res.ok) {
          return { url, title: '', content: '', cached: false, error: `HTTP ${res.status}` }
        }

        const contentType = res.headers.get('content-type') ?? ''
        const html = await res.text()

        let title: string
        let content: string

        if (contentType.includes('text/plain')) {
          title = url
          content = html.slice(0, MAX_CONTENT_LENGTH)
        } else {
          const extracted = extractText(html, url)
          title = extracted.title
          content = extracted.content
        }

        const result: PageResult = { url, title, content, cached: false }

        // Cache in KV (fire-and-forget)
        if (kv && content.length > 100) {
          c.executionCtx.waitUntil(
            kv.put(url, JSON.stringify({ url, title, content }), {
              expirationTtl: KV_TTL,
            })
          )
        }

        return result
      } catch (err) {
        const message = err instanceof Error ? err.message : 'fetch failed'
        return { url, title: '', content: '', cached: false, error: message }
      }
    })
  )

  return c.json({ pages })
})

// Health check
app.get('/', (c) => c.json({
  worker: 'thechefos-scout',
  status: 'ok',
  searxng: c.env.SEARXNG_URL ? 'configured' : 'not configured',
  kv: c.env.SCOUT_KV ? 'bound' : 'not bound',
}))

export default app
