# Hunt: PARK-001 — Vectorize Brain Search
Goal: Ask "what do I know about lamination?" and get the 5 most relevant brain nodes back. Semantic search across all of brain/ using Cloudflare Vectorize + Workers AI embeddings. Free. No external API.
Repo: AetherCreator/thechefos-workers
Branch: feature/park-workers

## What this unlocks
Right now brain/ is only searchable by filename. You can find nodes if you know where to look.
With Vectorize, the meaning of every node is indexed. You can ask questions in plain English and get the most relevant knowledge back — across all domains, all nodes, instantly.

From Telegram: `/search what do I know about altitude baking`
Lamora returns the 5 most relevant brain nodes with previews.
From Chat: I can semantic-search your brain before answering any question.

## Architecture
```
Indexer (run once + on new nodes):
  GitHub API → read all brain/ markdown files
  Workers AI @cf/baai/bge-base-en-v1.5 → generate 768-dim embeddings
  Vectorize superclaude-brain → upsert vectors
  Vector ID = file path in brain/ (e.g. brain/03-professional/chef/fermentation.md)

Search endpoint:
  POST /api/brain/search { query, limit? }
  Workers AI → embed the query
  Vectorize → query top N by cosine similarity
  GitHub API → fetch content of top N nodes
  Return: [{ path, score, preview, url }]

Lamora integration:
  /search [query] command → calls /api/brain/search → formats results → sends to Telegram
```

## Clue Tree

### Clue 1: Vectorize Index + Worker Scaffold
- Create Vectorize index `superclaude-brain` (768 dims, cosine metric) via Cloudflare dashboard or wrangler
- Scaffold packages/brain-search/ with Hono, wrangler.toml
- wrangler.toml bindings: [[vectorize]] binding=VECTORIZE index_name=superclaude-brain, [ai] binding=AI
- GET /health returns { status: ok, index: superclaude-brain }

Pass: Worker deploys, /health returns correct index name, Vectorize index exists in Cloudflare

### Clue 2: Brain Indexer Endpoint
- POST /api/brain/index → reads all brain/ files from GitHub API using GITHUB_TOKEN
- Generates embeddings via env.AI.run('@cf/baai/bge-base-en-v1.5', { text: [content] })
- Upserts into Vectorize with vector ID = file path, metadata = { path, domain, preview }
- Preview = first 200 chars of file content (stripped of frontmatter)
- Returns { indexed: N, errors: [] }
- Process in batches of 20 (Vectorize upsert limit)

Pass: POST /api/brain/index returns count > 0, vectors appear in Vectorize index

### Clue 3: Search Endpoint
- POST /api/brain/search { query: string, limit?: number (default 5) }
- Embed the query with Workers AI same model
- Query Vectorize for top N matches
- Fetch node content from GitHub API for each match
- Return [{ path, score, preview, githubUrl }]
- GET /api/brain/search?q=[query] also works for quick testing

Pass: POST with { query: "lamination technique" } returns relevant chef nodes with scores

### Clue 4: Router Integration + Lamora /search command
- Wire /api/brain/search into thechefos-router (new BRAIN_SEARCH service binding)
- Update Lamora telegram-bot to handle /search [query] command:
  - Calls /api/brain/search via service binding
  - Formats top 3 results: filename, score, preview
  - Sends formatted message to Telegram
- Update thechefos-router wrangler.toml with BRAIN_SEARCH service binding

Pass: Send "/search altitude baking" to Lamora → he replies with top 3 brain nodes + previews

## Critical Rules
- GITHUB_TOKEN stored as wrangler secret — never in code
- Use @cf/baai/bge-base-en-v1.5 — 768 dims, free Workers AI model
- Batch upserts to 20 at a time — Vectorize limit
- Vector IDs must be URL-safe — replace / with -- in path
- Re-indexing is idempotent (upsert not insert)
- brain-search Worker needs both VECTORIZE binding AND AI binding AND GITHUB_TOKEN secret

## Worker Secrets Required
```
GITHUB_TOKEN = stored in Cloudflare (read-only SuperClaude PAT)
```

## Vectorize Index Creation (manual step — Clue 1)
The Vectorize index must be created via Cloudflare dashboard or wrangler BEFORE the Worker deploys:

Option A — Cloudflare dashboard:
Workers & Pages → Vectorize → Create Index
Name: superclaude-brain | Dimensions: 768 | Metric: Cosine

Option B — wrangler (from Claude Code):
npx wrangler vectorize create superclaude-brain --dimensions=768 --metric=cosine

## Success State
Tyler sends to Lamora: `/search what do I know about butter temperature`
Lamora replies:
🔍 Top 3 results for "butter temperature":

1. brain/03-professional/chef/lamination-butter-temp.md (score: 0.94)
   "Butter at 15°C gives optimal plasticity for croissant lamination..."

2. brain/03-professional/chef/compound-butter-rnd.md (score: 0.87)
   "Black garlic compound butter — flavor development notes..."

3. brain/00-session/1774711598659-hello.md (score: 0.71)
   "Hello? — test capture..."

From Chat: I search your brain automatically before answering chef questions.
No desktop. No browsing brain/. The knowledge finds you.
