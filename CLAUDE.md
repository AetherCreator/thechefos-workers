# TheChefOS Workers ÃÂ¢ÃÂÃÂ Claude Code Context
Last updated: 2026-03-28

## What This Is
Cloudflare Workers monorepo powering the backend for ALL Tyler's products.
Domain: api.thechefos.app (via Cloudflare custom domain on the router Worker)
Owner: Tyler Vegetabile ÃÂ¢ÃÂÃÂ iPhone-only workflow, Claude Max.

## Deployed Workers (7 live as of 2026-03-28)
| Worker | Package | Purpose |
|--------|---------|---------|
| thechefos-router | packages/router | Hono router ÃÂ¢ÃÂÃÂ CORS, service binding dispatch |
| thechefos-ai-gateway | packages/ai-gateway | Anthropic proxy via CF AI Gateway |
| thechefos-brain-search | packages/brain-search | Vectorize semantic search (Workers AI embeddings) |
| thechefos-brain-write | packages/brain-write | GitHub brain/ push + GRAPH-INDEX auto-update |
| thechefos-mcp-server | packages/mcp-server | ClaudeFare MCP endpoint (McpAgent class) |
| thechefos-oauth-server | packages/oauth-server | OAuth flow for MCP auth |
| thechefos-telegram-bot | packages/telegram-bot | Telegram bot (Lamora persona) |

## Data Stores
- KV: thechefos-router-SESSION_KV (session tokens, feature flags)
- Vectorize: superclaude-brain (768-dim cosine, brain/ semantic search)
- D1: none yet (planned for structured brain graph queries)
- R2: not enabled

## Cloudflare Account
- Account ID: cc231edbff18405233612d7afb657f1f
- Workers subdomain: tveg-baking.workers.dev
- set_active_account MUST be called before any Cloudflare operations

## Router Dispatch Map
```
/oauth/*        ÃÂ¢ÃÂÃÂ OAUTH_SERVER (service binding)
/api/brain/*    ÃÂ¢ÃÂÃÂ BRAIN_WRITE (service binding)
/api/mcp*       ÃÂ¢ÃÂÃÂ MCP_SERVER (service binding)
/api/telegram*  ÃÂ¢ÃÂÃÂ TELEGRAM_BOT (service binding)
/api/claude     ÃÂ¢ÃÂÃÂ AI_GATEWAY (service binding)
/ai/*           ÃÂ¢ÃÂÃÂ AI_GATEWAY (service binding)
```

CORS origins: chefos-six.vercel.app, superconci.vercel.app, morewords.vercel.app, thechefos.app, api.thechefos.app, claude.ai

## Known Gaps
- brain-search is NOT wired through router (standalone Worker, router sends /api/brain/* only to brain-write)
- No product-specific workers yet (chefos-worker, superconci-worker)
- MCP server rebuilt to McpAgent class but may need npm install + wrangler deploy
- Router lacks /api/brain/index route for brain-search indexing endpoint

## Architecture Rules
1. All Workers use Hono framework
2. Router passes c.req.raw to service bindings (full URL, not stripped)
3. Downstream Workers receive full paths ÃÂ¢ÃÂÃÂ use forward() helper to strip prefix
4. Workers service bindings require bound Worker to be deployed FIRST
5. Kid-safety: x-product header (superconci/morewords) ÃÂ¢ÃÂÃÂ cf-aig-collect-log-payload: false
6. GitHub Actions CF_API_TOKEN must include Workers KV Storage Edit scope

## Code Rules
- Complete files only, never fragments
- TypeScript for all Workers
- Environment types defined per Worker
- Test with wrangler deploy --dry-run before pushing

## Infrastructure Verification Rule
State files are claims, not truth. Tools are truth.
Before ANY infrastructure planning, run:
1. Cloudflare:workers_list ÃÂ¢ÃÂÃÂ deployed Workers
2. Cloudflare:d1_databases_list ÃÂ¢ÃÂÃÂ D1 databases
3. Cloudflare:kv_namespaces_list ÃÂ¢ÃÂÃÂ KV stores
If tools and state files disagree, tools win.

## Post-Session State Sync
After deploying or modifying ANY Worker:
- Update SuperClaude brain/00-session/ACTIVE-STATE.md
- Update SuperClaude brain/OPS-BOARD.md
- This is MANDATORY. The last deployment session skipped this and caused a 6-clue hunt to be designed for infrastructure that already existed.

## Related Repos
- SuperClaude (github.com/AetherCreator/SuperClaude) ÃÂ¢ÃÂÃÂ skills, brain/, state files
- ChefOS (github.com/AetherCreator/chefos) ÃÂ¢ÃÂÃÂ React PWA frontend
- SuperConci (github.com/AetherCreator/SuperConci) ÃÂ¢ÃÂÃÂ Kids learning PWA
- More (github.com/AetherCreator/more) ÃÂ¢ÃÂÃÂ MoreWords vocab app

<!-- COGNITIVE-CACHE-START -->
## 🧠 Tyler's Cognitive Context (auto-generated 2026-04-10)
<!-- This section is auto-generated daily from brain/ graph. Do not edit manually. -->

### Mental Models (top by connection density)
- **Hello**: Brain node: Hello (session/note) [session]
- **ACTIVE STATE**: Brain node: ACTIVE STATE (session/state) [session]
- **CAPABILITY INDEX**: Brain node: CAPABILITY INDEX (session/note) [session]
- **Harvest Full Session**: Brain node: Harvest Full Session (daily/daily) [daily]
- **Harvest Superclaude Setup**: Brain node: Harvest Superclaude Setup (daily/daily) [daily]

### Active Patterns
- progressive-disclosure-core-architecture: spans projects, meta, knowledge, professional [graduated]
- ratio-math-universal: spans professional, knowledge, projects, meta [graduated]

### Brain Health
- Nodes: 154 | Hot (7d): 0 | Patterns: 2
- Strongest: meta (43) | Weakest: session (3)

### How Tyler Thinks
- Native mental model: ratio-based scaling (baker's % = portfolio allocation = game stat curves)
- Decision protocol: feel-first, instruments verify
- Learning sequence: rhythm before tempo
- Information architecture: progressive disclosure (router + on-demand detail)
- Teaching method: let them fail once, then explain why
<!-- COGNITIVE-CACHE-END -->
