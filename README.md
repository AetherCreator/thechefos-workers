# thechefos-workers

Cloudflare Workers monorepo for ChefOS — a two-worker architecture.

## Architecture

### Router (`packages/router`)
Central routing worker that receives all incoming requests and dispatches them to downstream services. Uses Hono as the web framework.

**Service bindings:**
- `CHEFOS` → chefos-worker
- `SUPERCONCI` → superconci-worker
- `MOREWORDS` → morewords-worker
- `AI_GATEWAY` → thechefos-ai-gateway

**KV namespace:**
- `SESSION_KV` — session state storage

### AI Gateway (`packages/ai-gateway`)
Handles AI/LLM request proxying and management. Currently a stub returning 200 OK.

## Development

```bash
# Install dependencies
npm install

# Dry-run deploy (no CF credentials needed)
npm run dry-run:router
npm run dry-run:gateway

# Deploy (requires CF credentials)
npm run deploy:router
npm run deploy:gateway
```

## Workspace Structure

This is an npm workspaces monorepo. Each package in `packages/` is an independent Cloudflare Worker with its own `wrangler.toml`.
