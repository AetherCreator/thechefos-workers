# TheChefOS Workers Constitution

## Identity
Cloudflare Workers monorepo powering the backend for ALL Tyler's products. The shared infrastructure layer.

## Non-Negotiables
- All Workers use Hono — no mixing frameworks
  verify: Grep("Hono", "src/") → 1+ matches [added: 2026-03-30]
  verify: Grep("express\|fastify\|itty-router", "src/") → 0 matches [added: 2026-03-30]
- Router is the single entry point — all products go through thechefos-router
  verify: DirExists("src/thechefos-router/") [added: 2026-03-30]
- Kid-safety: x-product header (superconci/morewords) → cf-aig-collect-log-payload: false
  verify: Grep("cf-aig-collect-log-payload", "src/") → 1+ matches [added: 2026-03-30]
- Service bindings for inter-Worker communication — never external HTTP between Workers
  verify: Grep("service_binding\|services", "wrangler.toml") → 1+ matches [added: 2026-03-30]
- State files are a cache, tools are truth — verify with Cloudflare tools before planning
  verify: MANUAL — requires runtime Cloudflare tool invocation [added: 2026-03-30]

## Quality Gates
- wrangler deploy --dry-run before push
  verify: Grep("dry-run", "package.json") → 1+ matches [added: 2026-03-30]
- Test endpoints with curl after deploy
  verify: MANUAL — runtime behavioral check [added: 2026-03-30]
- Update SuperClaude ACTIVE-STATE.md after ANY deployment
  verify: Grep("ACTIVE-STATE", "CONSTITUTION.md") → 1+ matches [added: 2026-03-30]
- Complete files only — never fragments
  verify: MANUAL — requires judgment on file completeness [added: 2026-03-30]

## What This Is NOT
- Not microservices — it's a monorepo with service bindings
- Not public-facing except through router CORS origins
- Not independent of SuperClaude — deploys MUST update state files
