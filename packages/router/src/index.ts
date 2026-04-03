// packages/router/src/index.ts
import { Hono } from 'hono'
import { cors } from 'hono/cors'

export interface Env {
  AI_GATEWAY: Fetcher
  BRAIN_GRAPH: Fetcher
  BRAIN_SEARCH: Fetcher
  BRAIN_WRITE: Fetcher
  MCP_SERVER: Fetcher
  OAUTH_SERVER: Fetcher
  TELEGRAM_BOT: Fetcher
  PROXY: Fetcher
}

const app = new Hono<{ Bindings: Env }>()

/** Strip a path prefix before forwarding to a service binding */
function forward(req: Request, service: Fetcher, prefix: string): Promise<Response> {
  const url = new URL(req.url)
  url.pathname = url.pathname.slice(prefix.length) || '/'
  return service.fetch(new Request(url.toString(), req))
}

// CORS — wildcard (personal API; Claude.ai artifacts use null/sandboxed origin)
app.use('*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization', 'x-api-key', 'x-product', 'x-webhook-secret', 'x-github-token', 'Mcp-Session-Id'],
}))

// OAuth authorization server — strip /oauth so downstream sees /authorize, /token
app.all('/oauth/*', (c) => forward(c.req.raw, c.env.OAUTH_SERVER, '/oauth'))
app.get('/.well-known/oauth-authorization-server', (c) => c.env.OAUTH_SERVER.fetch(c.req.raw))

// Brain dashboard — aggregated endpoint
app.get('/api/brain/dashboard', (c) => forward(c.req.raw, c.env.BRAIN_GRAPH, '/api/brain'))

// Pattern detection — convenience routes to brain-graph (clue 7)
app.get('/api/brain/patterns/scan', (c) => forward(c.req.raw, c.env.BRAIN_GRAPH, '/api/brain'))
app.post('/api/brain/patterns/graduate', (c) => forward(c.req.raw, c.env.BRAIN_GRAPH, '/api/brain'))

// OPS vitals — convenience route to brain-graph (clue 7)
app.get('/api/brain/ops/vitals', (c) => forward(c.req.raw, c.env.BRAIN_GRAPH, '/api/brain'))

// Instinct pipeline — pattern graduation + rule push (instinct-pipeline hunt)
app.get('/api/brain/patterns/ready', (c) => forward(c.req.raw, c.env.BRAIN_GRAPH, '/api/brain'))
app.get('/api/brain/instinct/pending', (c) => forward(c.req.raw, c.env.BRAIN_GRAPH, '/api/brain'))
app.post('/api/brain/instinct/graduate', (c) => forward(c.req.raw, c.env.BRAIN_GRAPH, '/api/brain'))

// Cognitive cache — generate and push to all repos (cognitive-cache hunt)
app.post('/api/brain/cognitive-cache/generate', (c) => forward(c.req.raw, c.env.BRAIN_GRAPH, '/api/brain'))

// Brain graph — structured D1 queries (must be before brain-write catch-all)
app.all('/api/brain/graph/*', (c) => forward(c.req.raw, c.env.BRAIN_GRAPH, '/api/brain/graph'))

// Brain search — pass full request unchanged; brain-search routes live at /api/brain/search
// fix: do NOT strip prefix — worker owns the full /api/brain/search path
app.all('/api/brain/search', (c) => c.env.BRAIN_SEARCH.fetch(c.req.raw))
app.all('/api/brain/search/*', (c) => c.env.BRAIN_SEARCH.fetch(c.req.raw))
app.all('/api/brain/index', (c) => c.env.BRAIN_SEARCH.fetch(c.req.raw))
app.all('/api/brain/index/*', (c) => c.env.BRAIN_SEARCH.fetch(c.req.raw))

// Session odometer (brain-graph D1)
// fix: prefix must be '/api' so BRAIN_GRAPH receives '/session/odometer' (not a garbled slice)
app.get('/api/session/odometer', (c) => forward(c.req.raw, c.env.BRAIN_GRAPH, '/api'))
app.post('/api/session/odometer/weekly-reset', (c) => forward(c.req.raw, c.env.BRAIN_GRAPH, '/api'))

// Session usage tracking (brain-graph D1)
app.post('/api/session/usage', (c) => forward(c.req.raw, c.env.BRAIN_GRAPH, '/api'))
app.get('/api/session/usage', (c) => forward(c.req.raw, c.env.BRAIN_GRAPH, '/api'))
app.get('/api/session/usage/summary', (c) => forward(c.req.raw, c.env.BRAIN_GRAPH, '/api'))

// Brain session state (brain-write) — catch-all must come AFTER specific session routes above
app.all('/api/session/*', (c) => forward(c.req.raw, c.env.BRAIN_WRITE, '/api/session'))

// Brain write webhook (catch-all for /api/brain/*) — must come AFTER specific brain routes above
app.all('/api/brain/*', (c) => c.env.BRAIN_WRITE.fetch(c.req.raw))

// Proxy — universal tool proxy (strip /api/proxy so downstream sees /github/*, /vercel/*, etc.)
app.all('/api/proxy/*', (c) => forward(c.req.raw, c.env.PROXY, '/api/proxy'))

// MCP context server — strip /api/mcp so downstream sees /, /.well-known/...
app.all('/api/mcp', (c) => forward(c.req.raw, c.env.MCP_SERVER, '/api/mcp'))
app.all('/api/mcp/*', (c) => forward(c.req.raw, c.env.MCP_SERVER, '/api/mcp'))

// Lamora — Telegram bot
app.all('/api/telegram', (c) => c.env.TELEGRAM_BOT.fetch(c.req.raw))
app.all('/api/telegram/*', (c) => c.env.TELEGRAM_BOT.fetch(c.req.raw))

// AI Gateway passthrough
app.all('/api/claude', (c) => c.env.AI_GATEWAY.fetch(c.req.raw))
app.all('/ai/*', (c) => c.env.AI_GATEWAY.fetch(c.req.raw))

// Health check
app.get('/health', (c) => c.json({
  status: 'ok',
  worker: 'thechefos-router',
  routes: ['/oauth', '/api/brain/dashboard', '/api/brain/patterns/scan', '/api/brain/patterns/ready', '/api/brain/patterns/graduate', '/api/brain/instinct/pending', '/api/brain/instinct/graduate', '/api/brain/ops/vitals', '/api/brain/cognitive-cache/generate', '/api/brain/graph', '/api/brain/search', '/api/brain/index', '/api/session/odometer', '/api/session/usage', '/api/session', '/api/brain', '/api/proxy', '/api/mcp', '/api/telegram', '/api/claude', '/ai']
}))

export default app
