# 🏛️ The Archivist — Hunt MAP

**Mission:** Make SuperClaude's brain time-aware, filterable, layered, and self-maintaining.
**Repo:** `thechefos-workers` (all changes land here)
**Branch:** `feat/archivist`
**Inspired by:** MemPalace analysis — took the good ideas, rejected AAAK compression.

---

## THDD Methodology Addition: Clue Caches

Every `[CODE]` clue in this hunt has a **clue_cache** — a self-contained package
that gives Code everything it needs to execute without stalling. A clue_cache contains:

1. **What to build** (exact files, functions, schemas)
2. **Where it goes** (repo paths, Worker names, endpoints)
3. **What already exists** (current state — don't clobber this)
4. **Acceptance criteria** (how Code knows it's done)
5. **Handoff blockers** (things Chat pre-resolved so Code doesn't have to think)

If a CODE clue stalls because it's missing context, that's a CHAT clue failure.

---

## Hunt Structure

| Clue | Surface | Model | Description |
|------|---------|-------|-------------|
| 1 | CODE | Sonnet | D1 temporal schema migration |
| 2 | CODE | Sonnet | Vectorize metadata filtering |
| 3 | CODE | Sonnet | L1 Essential State generator |
| 4 | CODE | Sonnet | Auto-harvest watchkeeper (n8n) |

**Dependency chain:** 1 → 2 → 3 → 4 (4 can parallel with 3)

All clue_caches are in the full MAP at:
`hunts/the-archivist/MAP.md` in `thechefos-workers` repo.

---

## Current Infrastructure (verified 2026-04-07)

### D1 `brain_nodes` table (BEFORE):
```
id, title, domain, type, tags, created_at, updated_at,
connection_count, is_insight, summary
```
NO temporal fields. NO status. NO confidence.

### Vectorize metadata (BEFORE):
```
path, domain, preview
```
Domain stored but NEVER filtered. Search queries all vectors unfiltered.

### brain-graph Worker:
- Cognitive cache generator (daily cron 6am UTC)
- Pattern detection + graduation pipeline
- Session usage tracking + odometer
- `getFileContent()` and `putFileContent()` GitHub helpers available

### brain-search Worker:
- `@cf/baai/bge-base-en-v1.5` embeddings (768-dim)
- Paginated indexer: `POST /api/brain/index?offset=0&limit=20`
- Per-file ingest: `POST /api/brain/ingest`
- Search: `POST /api/brain/search` (no filter param)

---

## Treasure

SuperClaude's brain becomes:
- **Time-aware** — knows when facts were true, supersedes outdated info
- **Filterable** — +34% retrieval via domain/type/recency metadata filtering
- **Self-summarizing** — L1 loads in ~200 tokens, regenerates daily
- **Self-maintaining** — auto-harvest from VPS Code sessions every 30min

No custom compression dialect. No AAAK. Brain nodes stay in natural markdown.
The compression comes from smart loading (L1), not from encoding.
