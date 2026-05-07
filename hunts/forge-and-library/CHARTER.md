# 🏭 The Forge & Library — CHARTER

**Hunt name:** `forge-and-library`
**Repo (canonical):** `AetherCreator/thechefos-workers` (infrastructure + workers)
**Outputs flow to:** `AetherCreator/SuperClaude/brain/` (Librarian's harvest) and shipped product repos (Foundry's outputs)
**Bible:** 1.1 (with §A7 + §A8 candidates from the-pilgrimage applied at MAP-write-time)
**Substrate:** `hunter-exec.py` (post one-word patch shipped 2026-05-06)
**Status:** Re-chartered 2026-05-07 post-pilgrimage — was blocked on working autonomous Hunter, now unblocked

---

## Mission

Build two autonomous agent systems on shared infrastructure that run while Tyler bakes croissants and sleeps:

1. **The Librarian** — daily knowledge harvester. Hunts demand signals (Locke Lamora persona) + research targets across Tyler's 5 domains. Writes structured `Lead` JSON + brain nodes. Zero human intervention.
2. **The Foundry** — weekly product factory. Pipeline: Hunter signal → Designer Council 95% gate → Schemer (THDD scaffold) → Builder (autonomous via existing `/build` dispatch) → Reviewer (Haiku QA). Ships micro-products end-to-end.

Both share the substrate that pilgrimage just hardened: `hunter-exec.py` for execution, n8n WF04 for dispatch, Cloudflare Workers for runtime, GitHub for outputs.

---

## Why now

1. **`hunter-exec.py` is real.** The-bridge (6/6 ✅) and the-pilgrimage (6/6 ✅) proved autonomous Hunter execution end-to-end with the substrate bug fixed.
2. **Bible 1.1 + §A7 + §A8 conventions are documented.** Pilgrimage banked the discipline needed to author PROMPTs that fire-and-walk-away. This hunt is the first authored from the start under that discipline.
3. **Yellowstone funds the runway.** Tyler's pastry chef income covers a multi-month runway for the swarm to mature. The economics work even if Foundry ships zero revenue in the first 90 days.
4. **Pre-scaffolded thinking exists.** Locke Lamora SOUL, HUNTER prompt, COUNCIL prompt, SCHEMER + REVIEWER prompts, multi-bot Telegram architecture — all authored in earlier sessions, all in `hunts/forge-and-library/` ready to consume.

---

## Vision (Tyler's framing — preserved)

> "Agents build while Tyler bakes/sleeps. Tyler steers."

Concretely:
- Tyler authors hunt CHARTERs and reviews swarm output (~30 min/day max)
- Locke Lamora hunts demand signals overnight, posts a Telegram brief at 6am ("LOCKE LAMORA — Morning Brief")
- The Council scores leads at 9am; passing leads scaffold THDD hunts
- The Foundry's Builder fires `/build` autonomously when a hunt is ready
- The Reviewer (Haiku) gates ship — only QA-approved products go live
- Tyler reviews shipped products in the evening, not at every step

---

## Success criteria (measurable, 90-day window)

| Metric | Target | Measurement |
|---|---|---|
| Librarian uptime | ≥ 27 days/30 (90%) writing ≥3 brain nodes/day | brain/ commit log via existing brain-write Worker |
| Council pass rate | 5–15% of leads (sane gate, neither rubber-stamp nor death-trap) | Council verdict log in D1 |
| Foundry ships | ≥ 1 product/week for 4 of first 12 weeks | Vercel deploy log + shipped manifest |
| Total spend | ≤ $15/mo (target $9; ceiling $15) | Cloudflare + Anthropic Haiku usage |
| Tyler bouncing per hunt | ≤ 1 phone↔Chat round per hunt average | self-reported, captured in C8 retro |
| §A7 + §A8 violation rate | 0 PROMPTs miss classification | review every clue before fire |

---

## Out-of-scope (explicit)

- ❌ ChefOS feature work (separate hunt; Foundry doesn't ship to ChefOS)
- ❌ Aether Chronicles work (separate hunt)
- ❌ Replacing Tyler's strategic role (the swarm steers nothing on its own)
- ❌ Replacing Yellowstone income in the 90-day window (this is a long-arc bet)
- ❌ Paid AI APIs beyond Haiku QA (Spirit Test: vendor-independent first)
- ❌ Custom encoding schemes (AAAK or similar) — natural language throughout
- ❌ X/Twitter as a primary signal source (Reddit + HN + niche forums are richer)

---

## Spirit Test — vendor-independence

Every architectural decision in this hunt must DECREASE vendor dependency, not increase it. Concrete tests:

- ✅ Self-hosted SearXNG (already running, port 8888)
- ✅ Local Ollama for analysis + Council deliberation
- ✅ Gemini Flash free-tier (no card, no opt-in to data sharing)
- ✅ Cloudflare Workers (Tyler-controlled account)
- ✅ GitHub for state (Tyler-owned repos)
- ⚠️ Haiku for QA — minimal vendor dependency, ~$0.002/call. Tolerable.
- ❌ Anything requiring a paid subscription beyond what's already in flight

If a clue tries to introduce a SaaS dependency that breaks the spirit test, that's grounds for clue rejection at MAP-review time.

---

## Pre-existing assets (carried forward, not re-authored)

| Asset | Path | Purpose |
|---|---|---|
| Locke Lamora SOUL | `hunts/forge-and-library/LOCKE-LAMORA-SOUL.md` | Demand-signal hunter persona — voice, briefing format, lead schema |
| HUNTER prompt | `hunts/forge-and-library/prompts/HUNTER.md` | Locke's operational prompt (consumed by his Telegram bot's runtime) |
| COUNCIL prompt | `hunts/forge-and-library/prompts/COUNCIL.md` | 3× Ollama agent specs (Realist + Economist + Skeptic) for 95% gate |
| SCHEMER + REVIEWER | `hunts/forge-and-library/prompts/SCHEMER-AND-REVIEWER.md` | THDD-scaffold writer + Haiku QA gate |
| Telegram architecture | `hunts/forge-and-library/TELEGRAM-ARCHITECTURE.md` | Multi-bot routing through Mastro/n8n (originally OpenClaw-VPS, will be updated for InfiniVeg in C2) |
| Existing legacy MAP | `hunts/forge-and-library/MAP.md` (about to be overwritten) | Pre-Bible-1.1 thinking — kitchen brigade pattern, model stack analysis, build phases. Embedded into new MAP under "## Pre-Bible-1.1 thinking (preserved)" section |

---

## Dependencies

**Met:**
- ✅ `hunter-exec.py` substrate (post-patch, line 259 fix shipped 2026-05-06)
- ✅ Bible 1.1 + §A7 + §A8 conventions (`brain/02-knowledge/hunter-exec-shell-execute-discipline.md`)
- ✅ n8n WF04 `/build` dispatch wired to hunter-exec.py
- ✅ SearXNG self-hosted on InfiniVeg (port 8888)
- ✅ Ollama local with embedding + analysis models
- ✅ brain-write Worker + ops_board_* MCP tools
- ✅ Cloudflare Workers monorepo deploy pipeline (`thechefos-workers/.github/workflows/deploy.yml`)

**Pending (C1 will inventory):**
- ⏳ Gemini Flash API key in `/opt/secrets/gemini-key`
- ⏳ 4 Telegram bot tokens in `/opt/secrets/telegram-tokens/` (locke-lamora ✅ exists, librarian/superclaude/foundry need creation via @BotFather)
- ⏳ Agent-Reach install on InfiniVeg (Reddit/YouTube/RSS structured scraping)

**Out:**
- 🔴 The original "OpenClaw on VPS" architecture — VPS decommissioned 2026-04-26. Substrate is now hunter-exec.py on InfiniVeg. The legacy MAP's "OpenClaw + VPS" framing is updated in the new MAP.

---

## Bible 1.1 R5 strike rule application

Forge & Library will surface things. Many things. The strike rule applies:

- **At any clue, 1 attempt budget.** If Hunter strikes, Tyler reviews, the clue gets root-caused — possibly via emergent successor hunt (the-bridge style).
- **3 strikes within the hunt → escalate to Claude Code.** Don't loop.
- **Mid-flight rescoping is allowed and encouraged.** Pilgrimage rescoped twice. Rescoping is an honest response to data, not a sign of failure.
- **TREASURE in C8 captures everything.** Bible 1.2 candidates that surface here ride forward.

---

## Cross-references

- `brain/05-knowledge/connections/thdd-bible-openclaw-1.1.md` — Bible 1.1
- `brain/02-knowledge/hunter-exec-shell-execute-discipline.md` — §A7 + §A8 conventions (must read at PROMPT-author time)
- `brain/02-knowledge/hunter-exec-substrate.md` — substrate overview
- `brain/02-knowledge/wf04-build-dispatch-architecture.md` — dispatch chain
- `hunts/the-pilgrimage/TREASURE.md` — the lessons this hunt is built on
- `hunts/the-bridge/TREASURE.md` — substrate replacement journey
- `hunts/REGISTRY.md` — hunt registry (forge-and-library row to be updated post-C1)
- `brain/OPS-BOARD.md` — task board (will gain forge-and-library row when C1 fires)

---

## Hunt motto

> "Agents build while Tyler bakes. Tyler steers. The Spirit Test holds."
