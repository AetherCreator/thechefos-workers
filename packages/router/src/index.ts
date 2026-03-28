// packages/router/src/index.ts
import { Hono } from 'hono'
import { cors } from 'hono/cors'

export interface Env {
  SESSION_KV: KVNamespace
  // CHEFOS, SUPERCONCI, MOREWORDS bindings will be added when those workers are deployed
  AI_GATEWAY: Fetcher
}

const app = new Hono<{ Bindings: Env }>()

// CORS — all known frontend origins
app.use('*', cors({
  origin: [
    'https://chefos-six.vercel.app',
    'https://superconci.vercel.app',
    'https://morewords.vercel.app',
    'https://thechefos.com',
  ],
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization', 'x-api-key', 'x-product'],
}))

// Auth middleware — ChefOS routes only (product routes will be added when those workers are deployed)
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

// AI Gateway passthrough (router receives /ai/* and forwards)
app.all('/ai/*', (c) => c.env.AI_GATEWAY.fetch(c.req.raw))

// Health check
app.get('/health', (c) => c.json({ status: 'ok', worker: 'thechefos-router' }))

export default app
