// packages/ai-gateway/src/index.ts
export interface Env {
  CF_ACCOUNT_ID: string
  CF_API_TOKEN: string
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)

    // Strip /ai prefix, keep /anthropic/... path
    const anthropicPath = url.pathname.replace(/^\/ai/, '')

    const gatewayUrl =
      `https://gateway.ai.cloudflare.com/v1/${env.CF_ACCOUNT_ID}/default/anthropic${anthropicPath}${url.search}`

    // Detect kid products — never store their prompts
    const product = request.headers.get('x-product') ?? ''
    const isKidProduct = product === 'superconci' || product === 'morewords'

    const headers = new Headers(request.headers)
    headers.set('cf-aig-authorization', `Bearer ${env.CF_API_TOKEN}`)
    headers.set('cf-aig-collect-log-payload', isKidProduct ? 'false' : 'true')
    // Remove x-product — it's internal routing only
    headers.delete('x-product')

    return fetch(gatewayUrl, {
      method: request.method,
      headers,
      body: request.method !== 'GET' ? request.body : undefined,
    })
  }
}
