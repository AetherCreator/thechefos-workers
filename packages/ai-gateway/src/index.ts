// packages/ai-gateway/src/index.ts
export interface Env {
  CF_ACCOUNT_ID: string
  CF_API_TOKEN: string
  XAI_API_KEY: string
  BRAIN_SEARCH_URL?: string
}

export interface AnthropicMessage {
  role: string
  content: string | unknown[]
}

export interface AnthropicRequestBody {
  model?: string
  messages?: AnthropicMessage[]
  system?: string
  max_tokens?: number
  [key: string]: unknown
}

interface BrainSearchResult {
  path: string
  score: number
  preview: string
}

interface BrainSearchResponse {
  results?: BrainSearchResult[]
}

const BRAIN_SEARCH_URL = 'https://thechefos-brain-search.tveg-baking.workers.dev/api/brain/search'
const BRAIN_SEARCH_TIMEOUT_MS = 2000
const BRAIN_SCORE_THRESHOLD = 0.5
const BRAIN_RESULT_LIMIT = 2

/** Extract the user's first/last message text for Vectorize query */
function extractUserQuery(messages: AnthropicMessage[]): string {
  const userMessages = messages.filter((m) => m.role === 'user')
  if (!userMessages.length) return ''
  const last = userMessages[userMessages.length - 1]
  if (typeof last.content === 'string') return last.content.slice(0, 300)
  if (Array.isArray(last.content)) {
    const textBlock = (last.content as Array<{ type: string; text?: string }>)
      .find((b) => b.type === 'text')
    return textBlock?.text?.slice(0, 300) ?? ''
  }
  return ''
}

/** Query brain-search Vectorize with 2s timeout — never throws */
async function searchBrain(query: string): Promise<BrainSearchResult[]> {
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), BRAIN_SEARCH_TIMEOUT_MS)
    const res = await fetch(BRAIN_SEARCH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, limit: BRAIN_RESULT_LIMIT }),
      signal: controller.signal,
    })
    clearTimeout(timer)
    if (!res.ok) return []
    const data: BrainSearchResponse = await res.json()
    return (data.results ?? []).filter((r) => r.score > BRAIN_SCORE_THRESHOLD)
  } catch {
    return []
  }
}

/** Build brain context block to prepend to system prompt */
function buildBrainContext(results: BrainSearchResult[]): string {
  if (!results.length) return ''
  const lines = results.map((r) => `[brain:${r.path}] ${r.preview}`)
  return `--- Tyler's Knowledge (Brain Context) ---\n${lines.join('\n')}\n---`
}

/** Handle Grok/xAI API proxy — direct passthrough to api.x.ai */
async function handleGrok(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url)
  // Strip /ai/grok prefix → keep the xAI API path (e.g. /v1/chat/completions)
  const xaiPath = url.pathname.replace(/^\/ai\/grok/, '')
  const xaiUrl = `https://api.x.ai${xaiPath}`

  const headers = new Headers()
  headers.set('Content-Type', 'application/json')
  headers.set('Authorization', `Bearer ${env.XAI_API_KEY}`)

  return fetch(xaiUrl, {
    method: request.method,
    headers,
    body: request.method === 'POST' ? request.body : undefined,
  })
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)

    // === Grok/xAI route ===
    if (url.pathname.startsWith('/ai/grok/')) {
      return handleGrok(request, env)
    }

    // === Anthropic route (existing) ===
    const anthropicPath = url.pathname.replace(/^\/ai/, '')

    const gatewayUrl =
      `https://gateway.ai.cloudflare.com/v1/${env.CF_ACCOUNT_ID}/default/anthropic${anthropicPath}${url.search}`

    const product = request.headers.get('x-product') ?? ''
    const isKidProduct = product === 'superconci' || product === 'morewords'

    const headers = new Headers(request.headers)
    headers.set('cf-aig-authorization', `Bearer ${env.CF_API_TOKEN}`)
    headers.set('cf-aig-collect-log-payload', isKidProduct ? 'false' : 'true')
    headers.delete('x-product')

    if (request.method !== 'POST' || isKidProduct) {
      return fetch(gatewayUrl, {
        method: request.method,
        headers,
        body: request.method !== 'GET' ? request.body : undefined,
      })
    }

    try {
      const bodyText = await request.text()
      const body: AnthropicRequestBody = JSON.parse(bodyText)

      const query = extractUserQuery(body.messages ?? [])
      const brainResults = query ? await searchBrain(query) : []
      const brainContext = buildBrainContext(brainResults)

      if (brainContext) {
        const existingSystem = typeof body.system === 'string' ? body.system : ''
        body.system = existingSystem
          ? `${brainContext}\n\n${existingSystem}`
          : brainContext
      }

      return fetch(gatewayUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      })
    } catch {
      return fetch(gatewayUrl, {
        method: 'POST',
        headers,
        body: request.body,
      })
    }
  },
}
