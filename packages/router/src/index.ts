// packages/router/src/index.ts
import { Hono } from 'hono'
import { cors } from 'hono/cors'

export interface Env {
  SESSION_KV: KVNamespace
  CHEFOS: Fetcher
  SUPERCONCI: Fetcher
  MOREWORDS: Fetcher
  AI_GATEWAY: Fetcher
  BRAIN_WRITE: Fetcher
  MCP_SERVER: Fetcher
  TELEGRAM_BOT: Fetcher
}

const app = new Hono<{ Bindings: Env }>()

// CORS — all known frontend origins
app.use('*', cors({
  origin: [
    'https://chefos-six.vercel.app',
    'https://superconci.vercel.app',
    'https://morewords.vercel.app',
    'https://thechefos.app',
    'https://api.thechefos.app',
  ],
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization', 'x-api-key', 'x-product', 'x-webhook-secret', 'x-mcp-token'],
}))

// Auth middleware — ChefOS routes only
app.use('/api/chefos/*', async (c, next) => {
  const authHeader = c.req.header('Authorization')
  const token = authHeader?.replace('Bearer ', '')

  if (!token) {
    return c.json({ error: 'Unauthorized' }, 401)
  }

  const userId = await c.env.SESSION_KV.get(`token:${token}`)
  if (!userId) {
    return c.json({ error: 'Invalid or expired token' }, 401)
  }

  await next()
})

// Product routes via Service Bindings
app.all('/api/chefos/*', (c) => c.env.CHEFOS.fetch(c.req.raw))
app.all('/api/conci/*',  (c) => c.env.SUPERCONCI.fetch(c.req.raw))
app.all('/api/words/*',  (c) => c.env.MOREWORDS.fetch(c.req.raw))

// Brain write webhook
app.all('/api/brain/*', (c) => c.env.BRAIN_WRITE.fetch(c.req.raw))

// MCP context server
app.all('/api/mcp', (c) => c.env.MCP_SERVER.fetch(c.req.raw))
app.all('/api/mcp/*', (c) => c.env.MCP_SERVER.fetch(c.req.raw))

// Lamora — Telegram bot
app.all('/api/telegram', (c) => c.env.TELEGRAM_BOT.fetch(c.req.raw))
app.all('/api/telegram/*', (c) => c.env.TELEGRAM_BOT.fetch(c.req.raw))

// AI Gateway passthrough
app.all('/ai/*', (c) => c.env.AI_GATEWAY.fetch(c.req.raw))

// Health check
app.get('/health', (c) => c.json({
  status: 'ok',
  worker: 'thechefos-router',
  routes: ['/api/chefos', '/api/conci', '/api/words', '/api/brain', '/api/mcp', '/api/telegram', '/ai']
}))

export default app
