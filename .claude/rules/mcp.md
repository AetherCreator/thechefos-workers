---
description: Rules for editing the MCP server and OAuth server workers
paths: ["packages/mcp-server/**", "packages/oauth-server/**"]
---

# MCP & OAuth Server Rules

## MCP Server
- Uses ClaudeFare McpAgent class — follow the McpAgent pattern for all tool definitions
- MCP endpoint is at `/api/mcp*` via router service binding
- Tool definitions must include clear descriptions and typed parameters
- Never expose internal worker URLs in MCP tool responses

## OAuth Server
- Handles OAuth flow for MCP authentication
- OAuth endpoints are at `/oauth/*` via router service binding
- Token storage uses KV (thechefos-router-SESSION_KV)
- NEVER log tokens, secrets, or OAuth codes
  verify: Grep("console\\.log.*token|console\\.log.*code|console\\.log.*secret", "packages/oauth-server/") → 0 matches [added: 2026-03-30]

## Security
- All auth endpoints must validate input before processing
- OAuth redirects must be validated against an allowlist
- Session tokens must have expiration — never create immortal tokens

## Deployment Order
- OAuth server must be deployed BEFORE MCP server (MCP depends on auth)
- Service bindings require the bound worker to be deployed first
