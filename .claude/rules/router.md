---
description: Rules for editing the Hono router and AI Gateway workers
paths: ["packages/router/**", "packages/ai-gateway/**"]
---

# Router & AI Gateway Rules

## Router Dispatch
- All routes dispatch to service bindings via `c.req.raw` — pass the full URL, never strip paths
- Downstream workers receive full paths and use `forward()` helper to strip prefix
- CORS origins are explicitly listed — do not use wildcard `*` in production
  verify: Grep("\\*", "packages/router/src/") → 0 CORS wildcard matches [added: 2026-03-30]

## Route Map Integrity
- The dispatch map in CLAUDE.md must match actual router code
- Adding a new route requires: route handler + service binding in wrangler.toml + CLAUDE.md update
- Never remove a route without confirming the downstream worker is also being decommissioned

## AI Gateway
- All Anthropic API calls go through Cloudflare AI Gateway for logging/caching
- Kid-safety: requests with `x-product: superconci` or `x-product: morewords` MUST set `cf-aig-collect-log-payload: false`
- Never hardcode API keys — use environment bindings
  verify: Grep("sk-ant-", "packages/ai-gateway/") → 0 matches [added: 2026-03-30]

## Hono Patterns
- All workers use Hono framework
- TypeScript for all source files
- Environment types defined per worker in local types
