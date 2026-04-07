# 🏭 The Forge & Library — Hunt MAP

**Mission:** Build two autonomous systems on shared infrastructure — a knowledge hunter (The Librarian) and a product factory (The Foundry).
**Repo:** `thechefos-workers` (infra) + `SuperClaude` (outputs)
**Core dependency:** OpenClaw on VPS
**Inspired by:** Kitchen brigade pattern — Scout=forager, Miner=prep, Council=sous, Schemer=expediter, Builder=line cook, Reviewer=health inspector

---

## Two Layers, Shared Spine

**Layer 1 — The Librarian:** Knowledge hunter. Runs daily. Builds wiki databases across Tyler's 5 domains. Feeds brain/. Zero human intervention. Valuable independently.

**Layer 2 — The Foundry:** Product factory. Runs weekly. Hunts demand signals → Designer Council (95% gate) → Schemer (THDD scaffold) → Builder (Claude Code) → Reviewer (Haiku QA). Ships micro-products autonomously.

Both share: OpenClaw (orchestration), Grok API (free research), Ollama (free local inference), Cloudflare Workers (APIs), GitHub (all outputs).

## Token Economics

| Role | Model | Cost |
|------|-------|------|
| Research/hunting | Grok API | $0 ($150/mo free) |
| Analysis/extraction | Ollama local | $0 |
| Council deliberation | Ollama ×3 | $0 |
| MAP/schematic writing | Grok | $0 |
| Code execution | Claude Code (Max) | $0 marginal |
| Quality gate only | Claude Haiku API | ~$0.002/call |
| **Total monthly** | | **~$9-14** |

Claude touches ONLY: code execution (already paid) + final QA gates (Haiku, pennies).

## The Designer Council — 95% Gate

Three Ollama agents score independently, then debate:
- **The Realist** → feasibility (can Claude Code build this end-to-end?)
- **The Economist** → profitability (clear monetization, >10K market?)
- **The Skeptic** → anti-failure (legal risk? existing alternatives? embarrassment test?)

Score = geometric mean. Must be ≥95%. This prevents "brilliant but unprofitable" and "profitable but unbuildable" from leaking through.

## Build Phases

| Phase | What | Depends On |
|-------|------|-----------|
| 0 | VPS upgrade + SearXNG + Ollama | Montana move |
| 1 | OpenClaw install + Telegram + model connections | Phase 0 |
| 2 | The Librarian (daily knowledge hunter) | Phase 1 |
| 3 | The Foundry (weekly product factory) | Phase 1 + 2 |
| 4 | Monitoring + revenue tracking | Phase 3 |

## Hunt Clues

| Clue | Surface | Model | Description |
|------|---------|-------|-------------|
| 1 | CODE | Sonnet | VPS upgrade + SearXNG + Ollama install |
| 2 | CODE | Sonnet | OpenClaw install + Telegram + model wiring |
| 3 | CHAT | Opus | Design Librarian prompts + output formats |
| 4 | CODE | Sonnet | Build librarian OpenClaw skill + wire Workers |
| 5 | CHAT | Opus | Design Foundry prompts + Council scoring + Reviewer gates |
| 6 | CODE | Sonnet | Build foundry skills (hunter, council, schemer) |
| 7 | CODE | Sonnet | Build builder trigger + reviewer (Haiku gate) |
| 8 | CODE | Sonnet | Telegram notifications + dashboard + monitoring |

Full clue_caches in CLUE_CACHES.md (to be generated from CHAT clues 3 and 5).
