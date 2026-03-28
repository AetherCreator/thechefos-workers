# Hunt: PARK-003 — Brain Write Webhook
Goal: A webhook endpoint at api.thechefos.app/brain/push that accepts a brain node payload and commits it to SuperClaude/brain/ via GitHub API. No desktop. No token management. Any app can push a brain node.
Repo: AetherCreator/thechefos-workers
Branch: feature/park-workers

## What this unlocks
Right now brain nodes require Claude Code or manual GitHub API calls with a token. With this webhook:
- One-min-capture can push from any surface
- ChefOS can push bake logs automatically
- Reminders triggers can auto-capture
- Any future app gets brain write access via a simple POST

## Clue Tree
1. **Brain Write Worker** → pass: packages/brain-write/ scaffolded, POST /api/brain/push accepts { path, content, message } and commits to AetherCreator/SuperClaude via GitHub API, returns commit SHA
2. **Validation + Safety** → pass: path must start with brain/, content size limited to 50KB, WEBHOOK_SECRET header required, duplicate detection (checks if file exists before creating, updates if it does)
3. **GRAPH-INDEX Auto-Update** → pass: after every successful push, Worker reads GRAPH-INDEX.md, appends new node entry with date/domain/summary, commits updated index
4. **Router Integration + One-Min-Capture** → pass: /api/brain/push wired into router, one-min-capture skill updated to call this endpoint instead of GitHub API directly, end-to-end test: idea: [text] in Chat → node appears in brain/

## Critical Rules
- GITHUB_TOKEN stored as wrangler secret (write-access PAT for SuperClaude repo only)
- WEBHOOK_SECRET stored as wrangler secret — required on every request
- Never allow writes outside brain/ path prefix
- All commits signed with "SuperClaude Brain Ops" as author
