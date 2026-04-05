# Grok Forge — Claude Code Execution Prompt
*Surface: [CODE] | Priority: High | Est: 2-3 hours*

## Context
An Opus Chat session already completed Phases 1-2 of the Grok Forge build:
- ✅ AI Gateway updated with Grok/xAI proxy route (`/ai/grok/*`)
- ✅ Scout Worker deployed and tested (`/api/scout/fetch` confirmed working)
- ✅ Router updated with scout routes + service binding
- ✅ D1 schema updated with `wiki_topics` + `wiki_articles` tables
- ✅ GitHub Actions CI updated with scout deploy job

## Remaining Tasks (do these IN ORDER)

### Task 0: Quick Fixes (~5 min)
1. Set the XAI_API_KEY secret on the ai-gateway Worker:
   ```bash
   cd /opt/repos/thechefos-workers/packages/ai-gateway
   # Get the key from Tyler — it was shared in the Chat session
   echo "$XAI_API_KEY" | npx wrangler secret put XAI_API_KEY
   ```

2. Set CLOUDFLARE_API_TOKEN env var for wrangler (needed for all wrangler commands):
   ```bash
   export CLOUDFLARE_API_TOKEN="<get from GitHub repo secrets or CF dashboard>"
   export CLOUDFLARE_ACCOUNT_ID="cc231edbff18405233612d7afb657f1f"
   ```

3. Trigger D1 migration (creates wiki tables):
   ```bash
   curl -X POST https://superclaude-brain-graph.tveg-baking.workers.dev/migrate
   ```
   Expected: `{"success":true,"message":"Schema migration complete..."}`

4. Test Grok gateway:
   ```bash
   curl -s -X POST https://api.thechefos.app/ai/grok/v1/chat/completions \
     -H "Content-Type: application/json" \
     -d '{"model":"grok-3-mini-fast","messages":[{"role":"user","content":"Say hello in 5 words"}],"max_tokens":50}'
   ```

### Task 1: Create SCOUT_KV Namespace (~5 min)
```bash
cd /opt/repos/thechefos-workers/packages/scout
npx wrangler kv namespace create SCOUT_KV
```
Take the ID from the output and update `packages/scout/wrangler.toml`:
- Uncomment the `[[kv_namespaces]]` block
- Paste the namespace ID
- Redeploy: `npx wrangler deploy --keep-vars`

### Task 2: Set Up SearXNG on VPS (~15 min)
```bash
mkdir -p /opt/searxng
cd /opt/searxng

cat > docker-compose.yml << 'EOF'
version: '3'
services:
  searxng:
    image: searxng/searxng:latest
    container_name: searxng
    restart: unless-stopped
    ports:
      - "8888:8080"
    volumes:
      - ./config:/etc/searxng
    environment:
      - SEARXNG_SECRET=$(openssl rand -hex 32)
EOF

mkdir -p config
cat > config/settings.yml << 'EOF'
use_default_settings: true
server:
  secret_key: "CHANGE_ME_TO_RANDOM_STRING"
  bind_address: "0.0.0.0"
search:
  formats:
    - html
    - json
engines:
  - name: google
    engine: google
    shortcut: g
  - name: duckduckgo
    engine: duckduckgo
    shortcut: ddg
  - name: bing
    engine: bing
    shortcut: b
EOF

docker compose up -d
```

Then add a Cloudflare Tunnel route for `searx.thechefos.app` pointing to `http://localhost:8888`.

**IMPORTANT:** Workers can't reach localhost. SearXNG needs the Cloudflare Tunnel.
```bash
cd /opt/repos/thechefos-workers/packages/scout
echo "https://searx.thechefos.app" | npx wrangler secret put SEARXNG_URL
```

Test:
```bash
curl -s -X POST https://api.thechefos.app/api/scout/search \
  -H "Content-Type: application/json" \
  -d '{"query":"sourdough fermentation science","limit":3}'
```

### Task 3: Grok Harvester n8n Workflow (~45 min)
Build in n8n UI at https://n8n.thechefos.app

**Workflow: "Grok Brain Harvester"**

Nodes:
1. **Telegram Trigger** → listens for `/idea`, `/dump`, `/scan`
2. **Switch** → route by command
3. **HTTP Request** → POST to `https://api.thechefos.app/ai/grok/v1/chat/completions`
   - Body: `{"model":"grok-4.1-fast","response_format":{"type":"json_object"},"messages":[system_prompt, user_content]}`
   - System prompt for /idea and /dump (harvest mode):
     ```
     You are a knowledge extraction engine for Tyler's personal brain graph.
     Tyler is an Executive Pastry Chef, indie game developer, and father building a personal AI OS called SuperClaude.
     His five domains: chef, gamedev, family, finance, learning, meta.
     Given the input, extract 1-8 atomic knowledge nodes.
     Output ONLY JSON: {"nodes":[{"title":"kebab-case","domain":"...","tags":["#tag"],"insight":"2-4 sentences","connections":["connects to: ..."]}]}
     ```
4. **JSON Parse** → extract nodes array
5. **Loop** → for each node:
   - **HTTP Request** → POST to `https://api.thechefos.app/api/brain/write` with node data
6. **Telegram Reply** → confirm harvest count + titles

For `/scan` (Mode 3):
- Fetch last 7 brain nodes via `https://api.thechefos.app/api/brain/graph/query?sort=updated_at&order=desc&limit=7`
- Pass to Grok with scan system prompt (includes web_search + x_search tools)
- Parse suggested_nodes + field_news
- Send digest via Telegram
- Wait for Tyler's approval before writing nodes

Also add a **Cron Trigger** for 8am MT daily (Mode 3 auto-scan).

### Task 4: Add Telegram Commands (~20 min)
Update `packages/telegram-bot/src/index.ts` to handle:
- `/idea [text]` → POST to n8n webhook `/webhook/grok-harvest` with `{mode:"idea", content:text}`
- `/dump [text]` → POST to n8n webhook with `{mode:"dump", content:text}`
- `/scan` → POST to n8n webhook with `{mode:"scan"}`
- `/research "[topic]" [depth]` → POST to n8n webhook `/webhook/researcher`
- `/wiki [query]` → GET `https://api.thechefos.app/api/wiki/search?q=query`

Push changes, GitHub Actions auto-deploys.

### Task 5: Researcher Agent n8n Workflow (~1.5 hours)
Build in n8n UI. This is the biggest piece.

**Workflow: "Researcher Agent"**

Four phases in sequence:

**Phase 1 - PLAN:**
- Input: topic + depth (surface=2, deep=4, exhaustive=6 articles per category)
- Grok call (no tools): decompose topic into categories x articles
- Write all nodes to D1 `wiki_topics` table with status=queued
- Telegram: "Research tree planned: N articles queued"

**Phase 2 - EXECUTE (loop):**
- For each article:
  1. POST `/api/scout/search` with article search_query
  2. POST `/api/scout/fetch` with result URLs
  3. Pass content to Grok for synthesis into wiki article
  4. Write to D1 `wiki_articles` + push to GitHub `wiki/[root-slug]/[category]/[article].md`
  5. Mark `wiki_topics` status=complete
  6. Every 10 articles: Telegram progress

**Phase 3 - CROSS-LINK:**
- One Grok call with all titles + summaries
- Output: related_slugs for each article
- UPDATE `wiki_articles.related_slugs`

**Phase 4 - INDEX:**
- One Grok call: build INDEX.md
- Push to GitHub `wiki/[root-slug]/INDEX.md`
- Telegram: "Wiki complete"

### Task 6: Wiki Search (~30 min)
If time permits, build a simple wiki search endpoint on brain-graph Worker.

## Test Checklist
After each task, verify:
- [ ] Task 0: `curl POST /ai/grok/...` returns Grok response
- [ ] Task 0: `curl POST .../migrate` returns success, wiki tables exist
- [ ] Task 1: Scout fetch caches to KV
- [ ] Task 2: `/api/scout/search` returns real search results
- [ ] Task 3: Telegram `/idea sourdough starters are basically pets` → brain node created
- [ ] Task 4: Telegram commands respond correctly
- [ ] Task 5: `/research "sourdough fermentation" surface` → wiki built

## DO NOT
- Rebuild any existing Worker from scratch
- Change existing D1 schema (only ADD)
- Touch ChefOS, SuperConci, or Aether Chronicles repos
- Skip test verification between tasks

## Key Info
- Cloudflare Account ID: cc231edbff18405233612d7afb657f1f
- D1 Database ID: c9f55aaf-ac80-4111-b78e-9339a2f8e377
- Telegram Chat ID: 6091970994
- n8n URL: https://n8n.thechefos.app
- VPS IP: 178.156.178.118

## Repo Location
```
/opt/repos/thechefos-workers
```
All Workers in `packages/` subdirectories. Push to main triggers GitHub Actions deploy.

## Full Build Spec
Read `brain/04-projects/GROK-FORGE-HANDOFF.md` in SuperClaude repo for complete API schemas, system prompts, and D1 table definitions.
