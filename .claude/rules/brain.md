---
description: Rules for editing brain-search, brain-write, and brain-graph workers
paths: ["packages/brain-search/**", "packages/brain-write/**", "packages/brain-graph/**"]
---

# Brain Workers Rules

## brain-write
- Pushes to the SuperClaude GitHub repo's `brain/` directory
- MUST update GRAPH-INDEX.md when adding/modifying brain nodes
- GitHub token is an environment secret — never log or expose it
  verify: Grep("console\\.log.*token", "packages/brain-write/") → 0 matches [added: 2026-03-30]

## brain-search
- Uses Cloudflare Vectorize (superclaude-brain index, 768-dim cosine)
- Uses Workers AI for embeddings — do not import external embedding libraries
- Currently standalone (not wired through router) — note this in any routing changes

## brain-graph (planned)
- D1 database for structured brain graph queries
- D1 is not yet provisioned — verify with `d1_databases_list` before writing migration code

## Data Integrity
- Brain data is the user's personal knowledge graph — treat all operations as critical
- Write operations must be idempotent where possible
- Search results must include node IDs for traceability

## Post-Deploy Sync
- After deploying any brain worker, update SuperClaude brain/00-session/ACTIVE-STATE.md and brain/OPS-BOARD.md
- This is MANDATORY per CLAUDE.md — skipping caused a 6-clue hunt for already-existing infrastructure
