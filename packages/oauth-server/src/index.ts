import { Hono } from 'hono'

export interface Env {
  SESSION_KV: KVNamespace
}

const ISSUER = 'https://api.thechefos.app'
const AUTH_CODE_TTL = 600      // 10 minutes
const ACCESS_TOKEN_TTL = 86400 // 24 hours

const app = new Hono<{ Bindings: Env }>()

// OAuth metadata — public, no auth
app.get('/.well-known/oauth-authorization-server', (c) => {
  return c.json({
    issuer: ISSUER,
    authorization_endpoint: `${ISSUER}/oauth/authorize`,
    token_endpoint: `${ISSUER}/oauth/token`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
  })
})

// Also handle when accessed via /oauth prefix (router passes full path)
app.get('/oauth/.well-known/oauth-authorization-server', (c) => {
  return c.json({
    issuer: ISSUER,
    authorization_endpoint: `${ISSUER}/oauth/authorize`,
    token_endpoint: `${ISSUER}/oauth/token`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
  })
})

// GET /authorize — approval page (handles both /authorize and /oauth/authorize)
const handleGetAuthorize = (c: any) => {
  const clientId = c.req.query('client_id')
  const redirectUri = c.req.query('redirect_uri')
  const state = c.req.query('state')
  const codeChallenge = c.req.query('code_challenge')
  const codeChallengeMethod = c.req.query('code_challenge_method')

  if (clientId !== 'claude') {
    return c.text('Unknown client_id', 400)
  }
  if (!redirectUri) {
    return c.text('Missing redirect_uri', 400)
  }

  const html = `<!DOCTYPE html>
<html>
<head>
  <title>SuperClaude — Authorize</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    body { font-family: system-ui, sans-serif; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; background: #0a0a0a; color: #e0e0e0; }
    .card { background: #1a1a2e; border: 1px solid #333; border-radius: 12px; padding: 2rem; max-width: 400px; text-align: center; }
    h1 { font-size: 1.5rem; margin-bottom: 0.5rem; }
    p { color: #999; margin-bottom: 1.5rem; }
    .pirate { font-size: 2rem; margin-bottom: 1rem; }
    button { background: #6c5ce7; color: white; border: none; padding: 12px 32px; border-radius: 8px; font-size: 1rem; cursor: pointer; width: 100%; }
    button:hover { background: #5a4bd1; }
  </style>
</head>
<body>
  <div class="card">
    <div class="pirate">🏴‍☠️</div>
    <h1>SuperClaude</h1>
    <p>Allow <strong>Claude</strong> to access your Brain, OPS-BOARD, and skills?</p>
    <form method="POST" action="/oauth/authorize">
      <input type="hidden" name="client_id" value="${clientId}" />
      <input type="hidden" name="redirect_uri" value="${redirectUri}" />
      <input type="hidden" name="state" value="${state || ''}" />
      <input type="hidden" name="code_challenge" value="${codeChallenge || ''}" />
      <input type="hidden" name="code_challenge_method" value="${codeChallengeMethod || ''}" />
      <button type="submit">Allow</button>
    </form>
  </div>
</body>
</html>`

  return c.html(html)
}

app.get('/authorize', handleGetAuthorize)
app.get('/oauth/authorize', handleGetAuthorize)

// POST /authorize — generate auth code, redirect
const handlePostAuthorize = async (c: any) => {
  const body = await c.req.parseBody()
  const clientId = body['client_id'] as string
  const redirectUri = body['redirect_uri'] as string
  const state = body['state'] as string | undefined
  const codeChallenge = body['code_challenge'] as string | undefined
  const codeChallengeMethod = body['code_challenge_method'] as string | undefined

  if (clientId !== 'claude') {
    return c.text('Unknown client_id', 400)
  }
  if (!redirectUri) {
    return c.text('Missing redirect_uri', 400)
  }

  const code = crypto.randomUUID()

  await c.env.SESSION_KV.put(
    `oauth:code:${code}`,
    JSON.stringify({
      client_id: clientId,
      redirect_uri: redirectUri,
      code_challenge: codeChallenge || null,
      code_challenge_method: codeChallengeMethod || null,
      expires_at: Date.now() + AUTH_CODE_TTL * 1000,
    }),
    { expirationTtl: AUTH_CODE_TTL }
  )

  const url = new URL(redirectUri)
  url.searchParams.set('code', code)
  if (state) url.searchParams.set('state', state)

  return c.redirect(url.toString(), 302)
}

app.post('/authorize', handlePostAuthorize)
app.post('/oauth/authorize', handlePostAuthorize)

// POST /token — exchange code for access token
const handlePostToken = async (c: any) => {
  const body = await c.req.parseBody()
  const grantType = body['grant_type'] as string
  const code = body['code'] as string
  const clientId = body['client_id'] as string
  const codeVerifier = body['code_verifier'] as string | undefined

  if (grantType !== 'authorization_code') {
    return c.json({ error: 'unsupported_grant_type' }, 400)
  }
  if (!code) {
    return c.json({ error: 'invalid_request', error_description: 'Missing code' }, 400)
  }

  const stored = await c.env.SESSION_KV.get(`oauth:code:${code}`)
  if (!stored) {
    return c.json({ error: 'invalid_grant', error_description: 'Code expired or invalid' }, 400)
  }

  await c.env.SESSION_KV.delete(`oauth:code:${code}`)

  const codeData = JSON.parse(stored) as {
    client_id: string
    redirect_uri: string
    code_challenge: string | null
    code_challenge_method: string | null
    expires_at: number
  }

  if (codeData.expires_at < Date.now()) {
    return c.json({ error: 'invalid_grant', error_description: 'Code expired' }, 400)
  }
  if (clientId && clientId !== codeData.client_id) {
    return c.json({ error: 'invalid_client' }, 400)
  }

  if (codeData.code_challenge) {
    if (!codeVerifier) {
      return c.json({ error: 'invalid_request', error_description: 'Missing code_verifier' }, 400)
    }
    const encoder = new TextEncoder()
    const digest = await crypto.subtle.digest('SHA-256', encoder.encode(codeVerifier))
    const computed = btoa(String.fromCharCode(...new Uint8Array(digest)))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '')
    if (computed !== codeData.code_challenge) {
      return c.json({ error: 'invalid_grant', error_description: 'PKCE verification failed' }, 400)
    }
  }

  const accessToken = crypto.randomUUID()

  await c.env.SESSION_KV.put(
    `oauth:token:${accessToken}`,
    JSON.stringify({
      client_id: codeData.client_id,
      issued_at: Date.now(),
      expires_at: Date.now() + ACCESS_TOKEN_TTL * 1000,
    }),
    { expirationTtl: ACCESS_TOKEN_TTL }
  )

  return c.json({
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: ACCESS_TOKEN_TTL,
  })
}

app.post('/token', handlePostToken)
app.post('/oauth/token', handlePostToken)

app.get('/health', (c) => c.json({ status: 'ok', worker: 'thechefos-oauth-server' }))

export default app
