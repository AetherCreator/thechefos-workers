# Hunt: PARK-001 — Vectorize Brain Search
Goal: Semantic search across brain/ nodes via Cloudflare Vectorize. Ask "what do I know about lamination?" and get the 5 most relevant brain nodes back.
Repo: AetherCreator/thechefos-workers
Branch: feature/park-workers

## What this unlocks
Brain/ has 100+ nodes but is only searchable by filename. Vectorize makes it searchable by meaning.
Every brain node becomes a vector embedding stored in Cloudflare Vectorize.
A new Worker endpoint at /api/brain/search returns the top N most semantically similar nodes.

## Clue Tree
1. **Vectorize Index** → pass: Cloudflare Vectorize index `superclaude-brain` created, namespace configured, Workers AI binding available
2. **Brain Indexer Worker** → pass: Worker reads all brain/ markdown files from GitHub API, generates embeddings via Workers AI (text embedding model), upserts into Vectorize index, returns count of indexed nodes
3. **Search Endpoint** → pass: POST /api/brain/search with { query, limit } returns top N nodes with similarity scores, content preview, and GitHub URL
4. **Router Integration** → pass: /api/brain/search route wired into thechefos-router, CORS correct, health check returns vector index stats

## Architecture
- Vectorize index: superclaude-brain (1536 dimensions for text-embedding-ada-002)
- Workers AI: @cf/baai/bge-base-en-v1.5 for embeddings (free, no external API needed)
- GitHub API: reads brain/ files using the stored GITHUB_TOKEN secret
- New Worker: packages/brain-search/

## Critical Rules
- GITHUB_TOKEN stored as wrangler secret, never in code
- Indexing is async — endpoint returns job ID, check /api/brain/index/status
- Each vector ID = the file path in brain/ (e.g., brain/03-professional/chef/fermentation.md)
- Upsert not insert — re-indexing is idempotent
