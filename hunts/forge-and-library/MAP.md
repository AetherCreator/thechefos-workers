# 🏭 The Forge & Library — Hunt MAP

**Mission:** Build two autonomous systems on shared infrastructure — a knowledge hunter (The Librarian) and a product factory (The Foundry).
**Repo:** `thechefos-workers` (infra) + `SuperClaude` (outputs)
**Core dependency:** OpenClaw on VPS
**Inspired by:** Kitchen brigade pattern — Scanner=forager, Miner=prep, Council=sous, Schemer=expediter, Builder=line cook, Reviewer=health inspector

---

## Two Layers, Shared Spine

**Layer 1 — The Librarian:** Knowledge hunter. Runs daily. Builds wiki databases across Tyler's 5 domains. Feeds brain/. Zero human intervention. Valuable independently.

**Layer 2 — The Foundry:** Product factory. Runs weekly. Hunts demand signals → Designer Council (95% gate) → Schemer (THDD scaffold) → Builder (Claude Code) → Reviewer (Haiku QA). Ships micro-products autonomously.

Both share: OpenClaw (orchestration), Gemini Flash API (free research), Agent-Reach (structured web scraping), SearXNG (self-hosted search), Ollama (free local inference), Cloudflare Workers (APIs), GitHub (all outputs).

## Model Stack — Zero API Cost

| Role | Model | Search Layer | Cost |
|------|-------|-------------|------|
| Research/hunting | **Gemini Flash (free tier)** | SearXNG + Agent-Reach | $0 |
| Analysis/extraction | **Ollama (local)** | — | $0 |
| Council deliberation | **Ollama ×3 (local)** | — | $0 |
| MAP/schematic writing | **Gemini Flash** | — | $0 |
| Code execution | **Claude Code (Max)** | — | $0 marginal |
| Quality gate only | **Claude Haiku API** | — | ~$0.002/call |
| **Total monthly** | | | **~$9** (VPS only) |

**Why Gemini over Grok:** Gemini Flash has a true free tier — no credit card, no data sharing opt-in. 1,000 requests/day, no billing required. Grok's "free" requires data sharing for $150/mo credits. For autonomous systems running unattended, true-free is the right call.

**Why Agent-Reach over Grok's X search:** Agent-Reach provides structured Reddit scraping, YouTube transcripts, RSS feeds, and web reading via Jina — all the demand signal sources The Foundry needs. Grok's only unique advantage was live X/Twitter data, which isn't critical for product demand validation. Reddit and HN are where people actually complain about tools they need.

Claude touches ONLY: code execution (already paid) + final QA gates (Haiku, pennies).

## Search Infrastructure

| Tool | What it does | Already running? |
|------|-------------|-----------------|
| **SearXNG** | Meta-search across Google, Brave, DDG, Startpage | ✅ Yes (VPS port 8888) |
| **Agent-Reach** | Structured scraping: Reddit, YouTube, RSS, web | ❌ Install on VPS |
| **Jina** (via Agent-Reach) | Clean web page reading/extraction | ❌ Comes with Agent-Reach |

No paid search APIs needed. Everything runs through self-hosted infrastructure.

## The Foundry Pipeline (Revised)

```
HUNTER (Gemini + SearXNG + Agent-Reach)
  Reddit pain points, HN complaints, niche forums
  "What tool do people wish existed?"
       │
       ▼
DESIGNER COUNCIL (Ollama ×3, sequential)
  The Realist (feasibility) × The Economist (profitability) × The Skeptic (anti-failure)
  Geometric mean must be ≥ 95% or idea dies
       │ (only if ≥95%)
       ▼
SCHEMER (Gemini Flash)
  Writes complete THDD hunt: MAP.md + CLUE_CACHES.md
  Includes Stripe checkout scaffold + SEO plan
       │
       ▼
BUILDER (Claude Code on VPS, Max subscription)
  Executes THDD clues → pushes to GitHub → deploys to Vercel
       │
       ▼
REVIEWER (Claude Haiku API, ~$0.002/call)
  Automated QA: loads? Stripe works? Mobile responsive? UX check?
  If issues → generates fix PRs → re-triggers Builder
  If clear → SHIPPED notification via Telegram
```

## The Designer Council — 95% Gate

Three Ollama agents score independently, then debate:
- **The Realist** → feasibility (can Claude Code build this end-to-end?)
- **The Economist** → profitability (clear monetization, >10K market?)
- **The Skeptic** → anti-failure (legal risk? existing alternatives? embarrassment test?)

Score = geometric mean. Must be ≥95%. Prevents "brilliant but unprofitable" and "profitable but unbuildable" from leaking through.

## Build Phases

| Phase | What | Depends On |
|-------|------|-----------|
| 0 | SearXNG ✅ + Ollama + Agent-Reach on VPS | Montana move |
| 1 | OpenClaw install + Telegram + Gemini API key | Phase 0 |
| 2 | The Librarian (daily knowledge hunter) | Phase 1 |
| 3 | The Foundry (weekly product factory) | Phase 1 + 2 |
| 4 | Monitoring + revenue tracking | Phase 3 |

## Hunt Clues

| Clue | Surface | Model | Description |
|------|---------|-------|-------------|
| 1 | CODE | Sonnet | Ollama install + Agent-Reach + Gemini API key config |
| 2 | CODE | Sonnet | OpenClaw install + Telegram + model wiring |
| 3 | CHAT | Opus | Design Librarian prompts + output formats |
| 4 | CODE | Sonnet | Build librarian OpenClaw skill + wire to Workers |
| 5 | CHAT | Opus | Design Foundry prompts + Council scoring + Reviewer gates |
| 6 | CODE | Sonnet | Build foundry skills (hunter, council, schemer) |
| 7 | CODE | Sonnet | Build builder trigger + reviewer (Haiku gate) |
| 8 | CODE | Sonnet | Telegram notifications + dashboard + monitoring |

Clue_caches generated from CHAT clues 3 and 5 (prompt design sessions with Tyler).

## What This Does NOT Do

- Does not replace ChefOS (ChefOS is the primary product)
- Does not consume Claude tokens for research/analysis (Gemini + Ollama)
- Does not require Tyler's daily attention (fully autonomous)
- Does not ship products Tyler would be embarrassed by (95% gate)
- Does not depend on any paid API (Gemini free tier + Ollama local)
- Does not use AAAK or any custom encoding (natural language throughout)
- Does not require X/Twitter data (Reddit/HN are better demand signals)

## Relationship to Other Hunts

- **The Archivist** → brain temporal awareness feeds Librarian harvest quality
- **Grok Forge** → SUPERSEDED by this hunt. SearXNG tasks from Grok Forge Phase 0 already done.
- **The Conductor** → orchestrates THDD execution. Foundry's Builder step IS The Conductor.
- **The Surgeon** → token optimization already designed into this system via model tiering.
