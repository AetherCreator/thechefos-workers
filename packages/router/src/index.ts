// packages/router/src/index.ts
import { Hono } from 'hono'
import { cors } from 'hono/cors'

export interface Env {
  AI_GATEWAY: Fetcher
  BRAIN_WRITE: Fetcher
  MCP_SERVER: Fetcher
  OAUTH_SERVER: Fetcher
  TELEGRAM_BOT: Fetcher
}

const app = new Hono<{ Bindings: Env }>()

app.use('*', cors({
  origin: [
    'https://chefos-six.vercel.app',
    'https://superconci.vercel.app',
    'https://morewords.vercel.app',
    'https://thechefos.app',
    'https://api.thechefos.app',
  ],
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization', 'x-api-key', 'x-product', 'x-webhook-secret'],
}))

// OAuth authorization server
app.all('/oauth/*', (c) => c.env.OAUTH_SERVER.fetch(c.req.raw))
app.get('/.well-known/oauth-authorization-server', (c) => c.env.OAUTH_SERVER.fetch(c.req.raw))

// Brain write webhook
app.all('/api/brain/*', (c) => c.env.BRAIN_WRITE.fetch(c.req.raw))

// MCP context server
app.all('/api/mcp', (c) => c.env.MCP_SERVER.fetch(c.req.raw))
app.all('/api/mcp/*', (c) => c.env.MCP_SERVER.fetch(c.req.raw))

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
  routes: ['/oauth', '/api/brain', '/api/mcp', '/api/telegram', '/api/claude', '/ai']
}))

export default app
