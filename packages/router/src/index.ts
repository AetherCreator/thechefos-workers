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
}

const app = new Hono<{ Bindings: Env }>()

/** Strip a path prefix before forwarding to a service binding */
function forward(req: Request, service: Fetcher, prefix: string): Promise<Response> {
  const url = new URL(req.url)
  url.pathname = url.pathname.slice(prefix.length) || '/'
  return service.fetch(new Request(url.toString(), req))
}

app.use('*', cors({
  origin: [
    'https://chefos-six.vercel.app',
    'https://superconci.vercel.app',
    'https://morewords.vercel.app',
    'https://thechefos.app',
    'https://api.thechefos.app',
    'https://claude.ai',
    'https://www.claude.ai',
  ],
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization', 'x-api-key', 'x-product', 'x-webhook-secret', 'x-github-token'],
}))

// OAuth authorization server — strip /oauth so downstream sees /authorize, /token
app.all('/oauth/*', (c) => forward(c.req.raw, c.env.OAUTH_SERVER, '/oauth'))
app.get('/.well-known/oauth-authorization-server', (c) => c.env.OAUTH_SERVER.fetch(c.req.raw))

// Brain dashboard — aggregated endpoint
app.get('/api/brain/dashboard', (c) => forward(c.req.raw, c.env.BRAIN_GRAPH, '/api/brain'))

// Brain graph — structured D1 queries (must be before brain-write catch-all)
app.all('/api/brain/graph/*', (c) => forward(c.req.raw, c.env.BRAIN_GRAPH, '/api/brain/graph'))

// Brain search — semantic Vectorize search
app.all('/api/brain/search', (c) => forward(c.req.raw, c.env.BRAIN_SEARCH, '/api/brain/search'))
app.all('/api/brain/search/*', (c) => forward(c.req.raw, c.env.BRAIN_SEARCH, '/api/brain/search'))

// Brain session state
app.all('/api/session/*', (c) => forward(c.req.raw, c.env.BRAIN_WRITE, '/api/session'))

// Brain write webhook (catch-all for /api/brain/*)
app.all('/api/brain/*', (c) => c.env.BRAIN_WRITE.fetch(c.req.raw))

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
  routes: ['/oauth', '/api/brain/dashboard', '/api/brain/graph', '/api/brain/search', '/api/session', '/api/brain', '/api/mcp', '/api/telegram', '/api/claude', '/ai']
}))

export default app
