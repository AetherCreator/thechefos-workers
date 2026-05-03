// packages/ai-gateway/src/index.ts
export interface Env {
  CF_ACCOUNT_ID: string
  CF_API_TOKEN: string
  XAI_API_KEY: string
  BRAIN_SEARCH_URL?: string
  AI: Ai                          // Workers AI binding (from [ai] in wrangler.toml)
  NVIDIA_API_KEY?: string         // Optional fallback only — leave unset for now
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

import { anthropicReqToOpenAI, openAIRespToAnthropic, type OpenAIResponse } from './adapters'

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

    // Kid-product route for POST /ai/v1/messages: Workers AI primary with NIM fallback
    if (isKidProduct && request.method === 'POST' && url.pathname === '/ai/v1/messages') {
      try {
        const bodyText = await request.text()
        const body: AnthropicRequestBody = JSON.parse(bodyText)
        
        // Brain context injection (reuse existing functions)
        const query = extractUserQuery(body.messages ?? [])
        const brainResults = query ? await searchBrain(query) : []
        const brainContext = buildBrainContext(brainResults)
        if (brainContext) {
          body.system = body.system 
            ? `${brainContext}\n\n${body.system}`
            : brainContext
        }
        
        // Convert Anthropic → OpenAI shape
        const openaiBody = anthropicReqToOpenAI(body)
        
        // ============ PRIMARY: Workers AI ============
        try {
          console.log('workers_ai_primary', { product })
          const aiResp = await env.AI.run('@cf/meta/llama-3.3-70b-instruct-fp8-fast', {
            messages: openaiBody.messages,
            max_tokens: openaiBody.max_tokens ?? 512,
          }) as { response?: string; usage?: { prompt_tokens?: number; completion_tokens?: number } }
          
          // Wrap Workers-AI response into OpenAI shape so adapter can translate
          const openaiShape = {
            id: `wai-${crypto.randomUUID()}`,
            choices: [{ 
              index: 0,
              message: { role: 'assistant' as const, content: String(aiResp.response ?? '') },
              finish_reason: 'stop' as const,
            }],
            usage: {
              prompt_tokens: aiResp.usage?.prompt_tokens ?? 0,
              completion_tokens: aiResp.usage?.completion_tokens ?? 0,
            },
          }
          const anthropicResp = openAIRespToAnthropic(openaiShape)
          return new Response(JSON.stringify(anthropicResp), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        } catch (waiErr) {
          console.log('workers_ai_failed_trying_nim', String(waiErr))
          
          // ============ FALLBACK: NIM ============
          // Only if NVIDIA_API_KEY is set. If not, surface the WAI error.
          if (!env.NVIDIA_API_KEY) {
            return new Response(JSON.stringify({
              type: 'error',
              error: { type: 'api_error', message: 'Workers AI failed and no NIM fallback configured' },
            }), { status: 502, headers: { 'Content-Type': 'application/json' } })
          }
          
          const nimResp = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${env.NVIDIA_API_KEY}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              model: 'meta/llama-3.3-70b-instruct',
              messages: openaiBody.messages,
              max_tokens: openaiBody.max_tokens ?? 512,
              temperature: openaiBody.temperature ?? 0.7,
            }),
          })
          
          if (!nimResp.ok) {
            return new Response(JSON.stringify({
              type: 'error',
              error: { type: 'api_error', message: `Both routes failed: WAI(err) NIM(${nimResp.status})` },
            }), { status: 502, headers: { 'Content-Type': 'application/json' } })
          }
          
          const nimJson = await nimResp.json() as OpenAIResponse
          const anthropicResp = openAIRespToAnthropic(nimJson)
          return new Response(JSON.stringify(anthropicResp), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        }
      } catch (parseErr) {
        console.log('kid_product_route_parse_error', String(parseErr))
        return new Response(JSON.stringify({
          type: 'error',
          error: { type: 'invalid_request_error', message: 'Could not parse request body' },
        }), { status: 400, headers: { 'Content-Type': 'application/json' } })
      }
    }
    // Non-kid products fall through to existing Anthropic flow below (unchanged)
    
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