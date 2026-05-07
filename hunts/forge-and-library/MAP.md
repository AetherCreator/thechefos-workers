# 🏭 The Forge & Library — MAP

**Hunt:** forge-and-library
**Bible:** 1.1 (with §A7 + §A8 + §A9 candidate applied)
**Substrate:** `/opt/scripts/auto-exec.sh` dispatcher → either `hunter-exec.py` (NARROW) or `claude-exec.sh` (SUBSTANTIAL) — wired via WF04 `POST auto-exec.sh` 2026-05-07
**Repo:** `AetherCreator/thechefos-workers`
**CHARTER:** `hunts/forge-and-library/CHARTER.md`

---

## Pre-flight gating (run at C1)

Before any clue fires, C1 verifies:

1. ✅ `hunter-exec.py` post-patch (line 259 has `d.get("exit") == 0` not `inner_obj.get("exit") == 0`)
2. ✅ `/opt/secrets/gemini-key` exists and is non-empty
3. ✅ Ollama running with at least one analysis model (`gemma2:9b` confirmed on InfiniVeg per boot script)
4. ✅ SearXNG reachable at `http://localhost:8888/search`
5. ✅ `/api/ops/*` and `/api/brain/push` Worker endpoints reachable
6. ✅ brain-write Worker token in `/opt/secrets/`
7. ✅ Cloudflare Workers deploy pipeline (`.github/workflows/deploy.yml`) green on `thechefos-workers` last 5 commits
8. ✅ At least Locke Lamora Telegram token present at `/opt/secrets/telegram-tokens/locke-lamora.token`
9. ⚠️ Librarian/SuperClaude/Foundry tokens — note as TODO if missing (Tyler creates via @BotFather)
10. ✅ `/opt/scripts/auto-exec.sh` smart dispatcher present + executable; both `claude-exec.sh` and `hunter-exec.py` resolvable; `/opt/secrets/hunterbot-token` present for Long John completion ping (added 2026-05-07 §A9 productionization)

C1 produces `pre-flight-report.md` capturing all of the above. The report determines which subsequent clues can fire — e.g., Foundry-side clues (C5–C7) require Council-side prerequisites.

---

## Clue DAG — under §A7 + §A8 + §A9

Every clue tagged with surface ([CHAT-OPUS] / [CODE-MANUAL] / [CODE-AUTONOMOUS]) AND reasoning class ([SYNTHESIS] / [DETERMINISTIC]) per Bible 1.2 §A8 candidate. `[CODE-AUTONOMOUS]` clues additionally tagged executor ([NARROW] / [SUBSTANTIAL]) per §A9 candidate.

| # | Clue | Surface | Class | §A9 Exec | Description | Depends on |
|---|---|---|---|---|---|---|
| 1 | Pre-flight inventory | `[CODE-AUTONOMOUS]` | `[DETERMINISTIC]` | `[SUBSTANTIAL]` | Verify infra readiness; produce `pre-flight-report.md`. **THE FIRE-AND-WALK-AWAY PROOF.** All shell steps STRICT-or-AUDIT-wrapped per §A7. Empirically classed `[SUBSTANTIAL]` after first attempt under hunter-exec.py hit recursive-planning ceiling; reran clean under claude-exec.sh. | none |
| 2 | Librarian schema design | `[CHAT-OPUS]` | `[SYNTHESIS]` | — | Synthesize from existing LOCKE-LAMORA-SOUL.md + HUNTER.md → produce `LIBRARIAN-SCHEMA.md` + `LOCKE-OUTPUT-SCHEMA.md`. Defines: lead JSON shape, brain/ harvest paths, daily schedule, stop conditions. | C1 |
| 3 | Locke harvest worker | `[CODE-AUTONOMOUS]` | `[DETERMINISTIC]` | `[SUBSTANTIAL]` | Build `packages/locke-harvest/` Cloudflare Worker. PROMPT carries the full worker source code verbatim — Hunter writes `src/index.ts`, `wrangler.toml`, package.json verbatim, commits, push triggers `deploy.yml` CI. Worker reads schema from C2, calls SearXNG + Gemini Flash, writes Lead JSON to brain/. Hourly cron. Multi-file Worker scaffold + CI verify → SUBSTANTIAL. | C2 |
| 4 | Locke smoke test | `[CODE-AUTONOMOUS]` | `[DETERMINISTIC]` | `[NARROW]` | Fire one harvest cycle (Telegram `/hunt` to @LockeLamoraBot OR direct curl to worker `/run`). Capture ≥1 valid Lead JSON in brain/05-leads/. PROMPT scopes single subreddit, ≤5 candidate threads, no Council step yet. Single fire + verify → NARROW. | C3 |
| 5 | Council schema + 95% gate | `[CHAT-OPUS]` | `[SYNTHESIS]` | — | Synthesize from existing COUNCIL.md → produce `COUNCIL-SCHEMA.md` with: Realist + Economist + Skeptic prompt templates (Ollama), geometric-mean scoring formula, verdict format, edge cases (tie-breaking, abstentions, low-confidence rejects). | C4 |
| 6 | Council worker | `[CODE-AUTONOMOUS]` | `[DETERMINISTIC]` | `[SUBSTANTIAL]` | Build `packages/council/` Worker. Hunter writes verbatim from PROMPT. Triggered by new lead in brain/05-leads/. Calls Ollama 3× (or until 1 of 3 abstains), computes geometric mean, writes verdict alongside lead. Multi-file Worker → SUBSTANTIAL. | C5 |
| 7 | Foundry pipeline | `[CODE-AUTONOMOUS]` | `[DETERMINISTIC]` | `[SUBSTANTIAL]` | Build `packages/foundry/` Worker that orchestrates Schemer → Builder → Reviewer for Council-passed leads. Schemer (Gemini) writes a THDD MAP.md from a passed lead. Builder fires `/build` via existing Mastro path. Reviewer (Haiku) gates ship via Vercel deploy hook. PROMPT carries all 3 sub-handler bodies verbatim. Multi-package + cross-Worker orchestration → SUBSTANTIAL. | C6 |
| 8 | TREASURE + retro | `[CHAT-OPUS]` | `[SYNTHESIS]` | — | Validate fire-and-walk-away end-to-end. Empirical metrics: how many of C1/C3/C4/C6/C7 fired without Tyler bouncing? §A7 + §A8 + §A9 violations? Bible 1.2 incorporation if everything held. | C7 |

**Surface alternation pattern:** every odd clue 1/3/4/6/7 is `[CODE-AUTONOMOUS][DETERMINISTIC]` — fires from Telegram, runs unattended. Every even clue 2/5/8 is `[CHAT-OPUS][SYNTHESIS]` — Tyler authors output verbatim, baked into next clue's PROMPT. This is exactly the §A8 hybrid-clue split pattern.

---

## §A9 candidate (Executor classification)

Every `[CODE-AUTONOMOUS]` clue carries a third tag — `[NARROW]` or `[SUBSTANTIAL]` — that determines which executor `auto-exec.sh` dispatches the work to:

- **`[NARROW]`** → `hunter-exec.py` (NIM Nemotron-120B native tool-calling, 5-tool surface, ≤10-turn deterministic file ops, ~2 min wall-clock). **Default when tag is missing** (backwards-compat).
- **`[SUBSTANTIAL]`** → `claude-exec.sh` (Claude Code 2.x headless via free-cc-proxy → NIM, full Bash+Edit+Read+Write+git, multi-repo, multi-file, synthesis-tolerant, ~5–10 min wall-clock).

**PROMPT-author duty.** Classifier appears in two places:
1. MAP clue table (§A9 Exec column above) — design-time visibility
2. PROMPT.md first line — runtime read by `auto-exec.sh`

The runtime read is what actually routes. `auto-exec.sh` fetches `hunts/<hunt>/clue-<N>/PROMPT.md` from GitHub via Contents API, scans the first line for `[NARROW]` or `[SUBSTANTIAL]`, dispatches accordingly. Default = NARROW.

Misclassification surfaces empirically: NARROW under claude-exec wastes ~5 minutes for a 2-min job; SUBSTANTIAL under hunter-exec hits one of three ceilings (substrate, audit ambiguity, recursive planning past ~10 turns) and exits 3/4/5 with budget burned. C1 of this hunt was the empirical proof — first attempt failed at 25 turns under hunter-exec.py, succeeded cleanly under claude-exec.sh.

**Pairs with §A7 (audit-wrap) and §A8 (reasoning-weight) as the third PROMPT-author discipline axis.** Bible 1.2 candidate after this hunt's C8 retro.

---

## R11 Workspace Coherence Audit

Per Bible 1.1 R11, audit before fire:

- ✅ **Substrate match.** Bible 1.1 + §A7 + §A8 + §A9 + auto-exec.sh dispatcher post-WF04-rewire — all consistent.
- ✅ **Repo placement.** Code runs as Cloudflare Workers in thechefos-workers. Hunt lives there. ✅
- ✅ **No duplicate scaffolding.** Existing `hunts/forge-and-library/` files are referenced, not duplicated. Legacy MAP content embedded below.
- ✅ **Cross-hunt drift.** the-archivist (brain temporal awareness) feeds Librarian harvest quality — NOT a blocker but worth re-MAP review post-Forge if archivist surfaces useful patterns. Documented in CHARTER cross-references.
- ✅ **Brain integration.** Locke writes to `brain/05-leads/`. Council verdicts ride alongside leads. Foundry produces shipped manifests at `brain/06-shipped/`. All paths align with existing brain/ taxonomy.
- ✅ **Cost discipline.** Spirit Test passes — vendor-independence preserved. Cost ceiling $15/mo, target $9/mo.
- ✅ **Dispatcher coherence.** WF04 `POST auto-exec.sh` node calls `/opt/scripts/auto-exec.sh --hunt X --clue N`; auto-exec reads §A9 tag from PROMPT first line; routes to claude-exec.sh (SUBSTANTIAL) or hunter-exec.py (NARROW). Both executors emit Long John Telegram ping on completion (claude-exec.sh wired 2026-05-07; hunter-exec.py emits via existing intel_log → babysitter pipeline).

R11 audit: **CLEAN.**

---

## Strike rule (Bible 1.1 R5)

- **Per clue:** 1 attempt. If Hunter STUCK or PROMPT-author error surfaces, root-cause before retry. Use § A7+§A8+§A9 to diagnose: was the failure a missing wrap, a misclassified synthesis, a misclassified executor, or a substrate issue?
- **Per hunt:** 3 strikes → escalate to Claude Code session for joint debugging.
- **Mid-flight rescoping:** Allowed. Encouraged when data demands it. Document the rescope in the affected clue's COMPLETE.md with the rescope reason.
- **Successor hunt charter:** Allowed. If a substrate problem surfaces (the-bridge style), pause the hunt, charter a successor, close it, then resume.

---

## Pass conditions (per clue, summarized — full list in each clue's PROMPT)

- C1: 9-item pre-flight report on origin/main, all critical items ✅ or noted-TODO
- C2: 2 schema docs on origin/main, ≥800 words each, links to existing prompts files
- C3: locke-harvest Worker on Vercel/CF, deploy.yml green, `wrangler tail` shows successful test invocation
- C4: ≥1 Lead JSON in brain/05-leads/ matching schema from C2
- C5: COUNCIL-SCHEMA.md on origin/main with all 3 agent prompts + scoring formula
- C6: council Worker deployed, processes a test Lead, writes a verdict
- C7: foundry Worker deployed, end-to-end pipeline runs (test lead → council pass → schemer → builder → reviewer → ship-or-reject)
- C8: TREASURE.md ≥800 words, empirical metrics, Bible 1.2 candidates banked or §A7+§A8+§A9 validated

---

## Pre-Bible-1.1 thinking (preserved from legacy MAP)

> The following is the original MAP content from earlier 2026 sessions, before Bible 1.1's substrate canonicalization. Preserved for continuity and because the kitchen-brigade framing + cost analysis remain useful. Updated infrastructure assumptions (VPS → InfiniVeg, OpenClaw-only → hunter-exec.py canonical, then auto-exec.sh dispatcher) handled in clue PROMPTs.

### Two Layers, Shared Spine (legacy framing — still accurate)

**Layer 1 — The Librarian:** Knowledge hunter. Runs daily. Builds wiki databases across Tyler's 5 domains. Feeds brain/. Zero human intervention. Valuable independently.

**Layer 2 — The Foundry:** Product factory. Runs weekly. Hunts demand signals → Designer Council (95% gate) → Schemer (THDD scaffold) → Builder (Claude Code via existing /build) → Reviewer (Haiku QA). Ships micro-products autonomously.

Both share: hunter-exec.py + claude-exec.sh + auto-exec.sh dispatcher + Mastro dispatch (orchestration), Gemini Flash API (free research), Agent-Reach (structured web scraping), SearXNG (self-hosted search), Ollama (free local inference), Cloudflare Workers (APIs), GitHub (all outputs).

### Model Stack — ~$9/mo target

| Role | Model | Cost |
|------|-------|------|
| Research/hunting | **Gemini Flash (free tier)** | $0 |
| Analysis/extraction | **Ollama (local)** | $0 |
| Council deliberation | **Ollama ×3 (local)** | $0 |
| MAP/schematic writing | **Gemini Flash** | $0 |
| Code execution | **auto-exec.sh dispatcher → hunter-exec.py or claude-exec.sh via /build** | $0 marginal (NIM Nemotron via free-cc-proxy) |
| Quality gate only | **Claude Haiku API** | ~$0.002/call |
| **Total monthly** | | **~$9** (mostly Cloudflare + occasional Haiku) |

Why Gemini over Grok: Gemini Flash has a true free tier — no credit card, no data sharing opt-in. 1,000 requests/day. For autonomous systems running unattended, true-free is the right call.

### Search Infrastructure (legacy, current)

| Tool | What it does | Status |
|---|---|---|
| **SearXNG** | Meta-search across Google, Brave, DDG, Startpage | ✅ InfiniVeg port 8888 |
| **Agent-Reach** | Structured scraping: Reddit, YouTube, RSS, web | ⏳ Install pending — C1 audits |
| **Jina** (via Agent-Reach) | Clean web page reading/extraction | ⏳ Comes with Agent-Reach |

### The Foundry Pipeline (legacy diagram — accurate)

```
HUNTER (Locke Lamora — Gemini + SearXNG + Agent-Reach)
  Reddit pain points, HN complaints, niche forums
       │
       ▼
DESIGNER COUNCIL (Ollama ×3, sequential)
  Realist × Economist × Skeptic — geometric mean ≥ 95%
       │ (only if ≥95%)
       ▼
SCHEMER (Gemini Flash)
  Writes THDD MAP.md + clue-1 PROMPT for the new product
       │
       ▼
BUILDER (auto-exec.sh dispatcher → hunter-exec.py | claude-exec.sh via /build)
  Executes THDD clues → pushes to GitHub → deploys to Vercel
       │
       ▼
REVIEWER (Claude Haiku API)
  Automated QA: loads? Stripe works? Mobile responsive? UX check?
  If issues → fix PRs → re-trigger Builder
  If clear → SHIPPED notification via @TheFoundryBot
```

### What this DOES NOT do (legacy, all still valid)

- Does not replace ChefOS (separate hunt)
- Does not consume Claude tokens for research/analysis (Gemini + Ollama)
- Does not require Tyler's daily attention (autonomous)
- Does not ship products Tyler would be embarrassed by (95% gate)
- Does not depend on any paid API (Gemini free + Ollama local + minimal Haiku)
- Does not use AAAK or custom encoding (natural language throughout)
- Does not require X/Twitter data (Reddit/HN richer)

---

## Trigger phrase (REGISTRY)

```
Arrr matey, adventure awaits ye in main/hunts/forge-and-library/MAP.md
```

(Also appears in `hunts/REGISTRY.md` Active Hunts section.)
