# TheChefOS Workers Constitution

## Identity
Cloudflare Workers monorepo powering the backend for ALL Tyler's products. The shared infrastructure layer.

## Non-Negotiables
- All Workers use Hono — no mixing frameworks
- Router is the single entry point — all products go through thechefos-router
- Kid-safety: x-product header (superconci/morewords) → cf-aig-collect-log-payload: false
- Service bindings for inter-Worker communication — never external HTTP between Workers
- State files are a cache, tools are truth — verify with Cloudflare tools before planning

## Quality Gates
- wrangler deploy --dry-run before push
- Test endpoints with curl after deploy
- Update SuperClaude ACTIVE-STATE.md after ANY deployment
- Complete files only — never fragments

## What This Is NOT
- Not microservices — it's a monorepo with service bindings
- Not public-facing except through router CORS origins
- Not independent of SuperClaude — deploys MUST update state files
