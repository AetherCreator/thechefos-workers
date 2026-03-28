# Hunt: PARK-005 — MCP OAuth Server
Goal: Add OAuth 2.1 to the MCP server so it can be connected via claude.ai's custom connector UI. No bearer token field in the UI — OAuth is the only supported auth path for web connectors.
Repo: AetherCreator/thechefos-workers
Branch: feature/park-workers

## Why OAuth
claude.ai custom connectors only support OAuth or authless servers.
The connector UI has no field for static bearer tokens (open bug filed March 2026).
OAuth is the correct long-term solution and enables the connector to work from iPhone, desktop, anywhere.

## What this unlocks
Once complete:
- claude.ai → Settings → Connectors → Add custom connector
- URL: https://api.thechefos.app/api/mcp
- Claude walks through OAuth flow once
- Every session auto-loads ACTIVE-STATE, OPS-BOARD, skills
- No token. No manual fetch. Ever.

## OAuth 2.1 Flow (simplified for single-user)
```
Claude → GET /api/mcp (no token)
              ↓ 401 + WWW-Authenticate pointing to metadata endpoint
Claude → GET /api/mcp/.well-known/oauth-protected-resource
              ↓ { authorization_servers: ["https://api.thechefos.app/oauth"] }
Claude → GET /api/mcp/.well-known/oauth-authorization-server (or /oauth/.well-known/...)
              ↓ { authorization_endpoint, token_endpoint, ... }
Claude → redirect Tyler to authorization_endpoint
              ↓ Tyler sees "Allow Claude to access SuperClaude?" → clicks Allow
              ↓ redirect back to Claude with auth code
Claude → POST /oauth/token (exchange code for access token)
              ↓ { access_token, expires_in }
Claude → GET /api/mcp with Authorization: Bearer {access_token}
              ✅ Tools load in Claude connector
```

## Architecture
Since this is single-user (Tyler only), OAuth is simplified:
- No user database needed
- One hardcoded authorization code flow
- KV stores: issued auth codes, access tokens
- Tokens expire in 24h, refresh on reconnect
- Uses existing SESSION_KV namespace

## Clue Tree

### Clue 1: OAuth Authorization Server scaffold
- New route group /oauth/* on thechefos-router (or new Worker packages/oauth-server/)
- GET /oauth/.well-known/oauth-authorization-server returns OAuth metadata JSON
- GET /oauth/authorize — renders simple "Allow Claude to access SuperClaude?" HTML page
- POST /oauth/token — exchanges auth code for access token, stores in KV
- All tokens stored in SESSION_KV: { code:XXX → pending, token:XXX → valid }

Pass: GET /oauth/.well-known/oauth-authorization-server returns valid OAuth metadata JSON

### Clue 2: MCP server Protected Resource Metadata
- Update packages/mcp-server to add /.well-known/oauth-protected-resource endpoint
- Returns { resource: "https://api.thechefos.app/api/mcp", authorization_servers: ["https://api.thechefos.app"] }
- On unauthenticated request: return 401 with WWW-Authenticate header pointing to metadata
- Valid Bearer token: pass through to existing MCP tools (existing MCP_AUTH_TOKEN auth still works as fallback)

Pass: GET /api/mcp without token returns 401 with correct WWW-Authenticate header

### Clue 3: Authorization flow + token validation
- GET /oauth/authorize: verify client_id is "claude", render approval HTML page
- POST /oauth/authorize: Tyler clicks Allow → generate auth code → store in KV (10 min TTL) → redirect back to Claude
- POST /oauth/token: validate code, issue access_token (UUID) → store in KV (24h TTL) → return token response
- MCP server validates Bearer token against KV on every request

Pass: Full flow works end-to-end in browser: /oauth/authorize → approve → token issued → MCP tools accessible

### Clue 4: Claude connector test
- Add SESSION_KV binding to OAuth routes
- Wire all OAuth routes through thechefos-router
- Add to Claude.ai: Settings → Connectors → Add custom connector → https://api.thechefos.app/api/mcp
- Complete OAuth flow in Claude UI
- Verify: get_active_state, get_ops_board, list_skills all return real data

Pass: SuperClaude connector appears in Claude chat, tools accessible, ACTIVE-STATE loads automatically

## Critical Rules
- OAuth client_id for Claude is always "claude" — hardcode this
- Claude's OAuth callback URL: https://claude.ai/api/mcp/auth_callback
- Auth codes: 10 minute TTL, single use
- Access tokens: 24 hour TTL
- Store tokens as KV values with TTL — never in code
- SESSION_KV already exists (e9dfcffc9e09...) — reuse it
- PKCE is optional for single-user but implement code_challenge if Claude sends it

## KV Schema
```
kv: oauth:code:{code} → { client_id, redirect_uri, expires_at } (TTL 600s)
kv: oauth:token:{token} → { client_id, issued_at, expires_at } (TTL 86400s)
```

## Success State
Tyler opens a new Brain Ops Chat.
No token paste. No manual fetch.
I say: "Session loaded — I have your ACTIVE-STATE and OPS-BOARD."
The connector did it automatically. 🏴‍☠️
