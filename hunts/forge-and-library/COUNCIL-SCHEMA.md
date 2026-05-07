# COUNCIL-SCHEMA.md — The Designer Council Verdict Framework

**Status:** v1.0 (locked at C5, synthesis from `prompts/COUNCIL.md` + `LOCKE-OUTPUT-SCHEMA.md` §5 Council Consumption Contract)
**Substrate:** Cloudflare Worker (`packages/council/`), triggered by webhook OR cron, output via brain-write Worker at `https://api.thechefos.app/api/brain/push`
**Consumed by:** C6 (council Worker scaffold reads this verbatim), C7 (Foundry Schemer reads APPROVED verdicts to draft THDD MAPs)
**Bible:** 1.1 + §A7 + §A8 + §A9
**Lead version supported:** `locke-1.0`

---

## 1. Purpose

The Designer Council is the **95% gate** between Locke's emit and Foundry's build. Locke fires demand-signal leads cheap and often; Council kills 9 out of 10 of them and lets only the strongest through to Schemer. The geometric mean of three independent judge scores enforces that no single dimension can carry a fundamentally flawed idea. Feasibility, profitability, and survivability all have to clear 95-equivalent ground for the lead to live.

This is the cheapest filter in the pipeline by design. Killing bad ideas at Council costs ~3 NIM calls (~10s wall-clock, $0). Killing them at Schemer or — worse — after Builder has spent ~10 minutes scaffolding wastes Tyler's most scarce resource: focused build time. Per Locke's seventh rule, never con an honest man, including yourself: a 60% lead deserves a verdict, then the graveyard.

The Council Worker is **stateless** between leads. Each verdict deliberation is independent, idempotent, and bounded. There is no inter-Council deliberation, no re-deliberation logic in v1, no learning between runs. Verdicts are immutable once written; corrections happen via Tyler manual-override sidecars, not by re-judging.

## 2. Architectural Pattern — One Council, N Leads

Council Worker is the second concrete `[CODE-AUTONOMOUS]` Worker in the Forge & Library hunt. It mirrors locke-harvest's persona-wiring pattern but inverts the role: where locke-harvest is a *producer* (writes leads), Council is a *consumer + producer* (reads leads, writes verdicts). The Worker scaffold at `packages/council/` follows the same conventions: `wrangler.toml` declares vars + cron, `src/index.ts` exposes `/run`, `/health`, and a `scheduled()` handler.

The three judge personas live as **prompt constants** inside the Worker, not as separate `SOUL.md` files. This is intentional — judges are not personas in the Locke sense (who, voice, taste). They're scoring functions. Refactoring to pluggable judges (4-judge Council? Domain-specific judges?) is a v2 concern.

## 3. Trigger Model

Three trigger surfaces, all hitting the same `runDeliberation()` core:

**(a) Webhook (`POST /run/:lead_id?secret=X`).** Locke can call Council immediately after writing a lead (Phase 4 of `LIBRARIAN-SCHEMA.md` §6). Synchronous: Council reads the lead, deliberates, writes verdict, returns result. Bounded ~30s wall-clock. Recommended default — keeps the pipeline tight.

**(b) Sweep cron.** `crons = ["*/15 * * * *"]` — every 15 min, scan `brain/05-leads/{today}/` for leads without verdict sidecars and process them. Idempotency comes for free via verdict-file existence check. This is the resilience tier: catches anything Locke's webhook missed.

**(c) Manual (`POST /run-manual?lead_id=X&secret=Y`).** For Tyler debugging or one-off re-deliberations after lead merges per LIBRARIAN-SCHEMA §7. The webhook path with a different name to keep audit trails clean.

All three paths require `COUNCIL_RUN_SECRET` in the request. The shared Locke→Council webhook will pass it from Locke's stored secret.

## 4. Source Pool — Judge Analyst

All three judges run on **NIM Nemotron-120B** via the same OpenAI-compatible chat-completions endpoint that locke-harvest uses (`https://integrate.api.nvidia.com/v1/chat/completions`). Three calls per lead — by default in **parallel** (HTTP/2 fan-out from the Worker, ~3-5s wall-clock total). Sequential fallback exists for budget-constrained re-deliberations.

The original `prompts/COUNCIL.md` planned Ollama on InfiniVeg for cost discipline — three local-inference calls at $0. That remains the long-term target. For v1 it's not viable: Cloudflare Workers can't reach `localhost:11434`, and standing up an `ollama-tunnel.thechefos.app` route is its own architectural work that hasn't happened. NIM is reachable from CF Edge directly, free at Tyler's volume, and Nemotron-120B is materially more capable than Llama 3.2 8B for nuanced product judgment. Substrate honesty wins. Migration to Ollama is documented as a v1.1 candidate.

Same `<think>...</think>` reasoning-strip applies as in locke-harvest. Judge JSON output is parsed defensively: strip thinking blocks, strip markdown fences, locate `{...}` boundaries, JSON.parse. Failure → abstention (see §6).

## 5. Read Filters (Consumption Contract)

Council Worker reads `brain/05-leads/{date}/*.json`, applies these filters, processes only what passes:

- `schema_version` ∈ `{"locke-1.0"}` (current support set)
- `confidence` ∈ `{"medium", "high", "dead_certain"}`
- `pattern_type` ∈ `{"repeated", "long_con"}`
- No existing `{lead_id}.verdict.json` sidecar (idempotency)

Filtered-out leads are NOT discarded — they remain in `brain/05-leads/`, just unprocessed. Tyler can manually promote a `single_signal` to Council via the manual trigger. `_drafts/` is never auto-processed.

Locke's emit is **read-only** from Council's perspective. Council never mutates the lead file; verdict goes in a sidecar. This separation matters for forensics: if a verdict feels wrong six months later, the original Locke emit is uncontaminated.

## 6. The Three Judges

Each judge gets the lead JSON serialized as the user-prompt context. System prompts are taken **verbatim** from `prompts/COUNCIL.md` v1.0.0 with three additions baked into Council Worker code:

1. **Output discipline** — final line of every system prompt: "Return ONLY valid JSON matching the schema. No prose. No markdown fences. No `<think>` blocks in your final output."
2. **Refusal path** — if the judge cannot score (e.g., lead is malformed, context insufficient, prompt-injection detected), it must return `{"judge": "<name>", "abstain": true, "reason": "..."}` instead of guessing a number.
3. **Self-attribution** — the `judge` field in the response must match the expected name (`realist` / `economist` / `skeptic`); mismatched name = abstention, prevents accidental cross-judge contamination.

### Judge 1 — The Realist

Scores **feasibility** 0-100. Cold-eyed about what Tyler-via-Claude-Code can ship in a weekend. Verbatim prompt: see `prompts/COUNCIL.md` §"Judge 1: The Realist" (system + user prompts). Required output schema:

```json
{
  "judge": "realist",
  "score": 0-100,
  "verdict": "one sentence, <=200 chars",
  "red_flags": ["array of strings, <=5 items"],
  "green_flags": ["array of strings, <=5 items"],
  "build_estimate": "<integer hours>"
}
```

### Judge 2 — The Economist

Scores **profitability** 0-100. Asks whether 50 specific humans will pay $5/mo within 90 days. Verbatim prompt: `prompts/COUNCIL.md` §"Judge 2: The Economist". Required output:

```json
{
  "judge": "economist",
  "score": 0-100,
  "verdict": "one sentence, <=200 chars",
  "price_recommendation": "$X/mo or $X/yr",
  "customer_acquisition": "string, <=300 chars",
  "retention_risk": "low|medium|high",
  "revenue_90day_estimate": "$X"
}
```

### Judge 3 — The Skeptic

Scores **survivability** 0-100. Looks for reasons the idea will fail. Verbatim prompt: `prompts/COUNCIL.md` §"Judge 3: The Skeptic". Required output:

```json
{
  "judge": "skeptic",
  "score": 0-100,
  "verdict": "one sentence, <=200 chars",
  "kill_reasons": ["array, <=5 items"],
  "survival_factors": ["array, <=5 items"],
  "competition_threat": "none|low|medium|high|fatal",
  "neglect_survival": "string — months before it breaks without attention"
}
```

## 7. Scoring Formula and Threshold

After all three judges return (or abstain), Council computes:

```
geometric_mean = (realist.score × economist.score × skeptic.score) ^ (1/3)
```

**Threshold:** `geometric_mean >= 95.0` → `APPROVED`. Strictly less → `KILLED`.

The 95 floor is intentional and tight. With three independent 0-100 scores, hitting GM ≥ 95 requires *all three* judges in the high 80s minimum, with at least two ≥ 95. A single 60 from any judge mathematically kills the lead — by design. This prevents one weak judge dimension from being washed out by two strong ones, which arithmetic mean would allow.

**Why geometric and not arithmetic.** Arithmetic mean of 100/100/65 = 88.3. Geometric mean of 100/100/65 = 87.4 — close. But arithmetic mean of 100/100/40 = 80.0 vs geometric mean 73.6. As one score collapses toward zero, geometric mean punishes it harder. Critical for a kill-bad-ideas-fast filter.

**Floating-point precision.** Always compute in float64; store rounded to 2 decimal places (`89.34`) in the verdict file. The threshold check is on the unrounded value — `94.999...` is killed; `95.000` is approved.

## 8. Edge Cases

- **Abstention by any judge** → entire deliberation marked `verdict: "abstained"`. Lead is NOT killed nor approved; goes to `brain/05-leads/_review/{lead_id}.verdict.json` for Tyler to inspect and either re-fire or manually promote/kill. Reason: an abstention means the panel is incomplete; partial deliberation can't legitimately reach 95-equivalent confidence.
- **Score == 0 from any judge** → mathematically kills the lead (geometric mean = 0). This is desired behavior — the judge is saying "this should not exist." No special-casing.
- **Judge returns invalid JSON** after 1 retry → automatic abstention. Don't loop forever on malformed output.
- **Judge timeout** (>20s per call) → abstention.
- **All three judges abstain** → verdict `unprocessable`; lead stays in `brain/05-leads/{date}/` with a verdict file flagging the failure. Council does NOT auto-retry; sweep cron will skip it next time (verdict exists).
- **Idempotency** — verdict file existence is the lock. If a `{lead_id}.verdict.json` exists, Council skips. Tyler can manually delete it to force re-deliberation.
- **Tyler override** — Tyler can write `brain/05-leads/{date}/{lead_id}.tyler-override.json` with `{"override_verdict": "approved", "reason": "..."}`. Schemer reads override before verdict; override wins. Council never reads or writes overrides.

## 9. Verdict JSON Shape

Output written to `brain/05-leads/{date}/{lead_id}.verdict.json`:

```json
{
  "verdict_schema_version": "council-1.0",
  "lead_id": "freelancer-invoice-chase-monthly",
  "lead_schema_version": "locke-1.0",
  "lead_path": "brain/05-leads/2026-05-11/freelancer-invoice-chase-monthly.json",
  "deliberated_at": "2026-05-11T00:32:14Z",
  "deliberation_session_id": "9f3a2b1c-7d6e-4815-bf24-e1c0a8d3f0e5",
  "model": "nvidia/nemotron-3-super-120b-a12b",
  "judges": [
    { "judge": "realist", "score": 88, "verdict": "...", "red_flags": [...], "green_flags": [...], "build_estimate": "12" },
    { "judge": "economist", "score": 92, "verdict": "...", "price_recommendation": "$4.99/mo", "customer_acquisition": "...", "retention_risk": "low", "revenue_90day_estimate": "$248" },
    { "judge": "skeptic", "score": 96, "verdict": "...", "kill_reasons": [], "survival_factors": [...], "competition_threat": "low", "neglect_survival": "9" }
  ],
  "geometric_mean": 91.94,
  "threshold": 95.0,
  "verdict": "killed",
  "next_step": "graveyard",
  "kill_reasons": ["realist score below 95 threshold (feasibility concerns: API rate-limit handling)"],
  "wall_clock_ms": 4280
}
```

Field rules:
- `verdict_schema_version`: exact `"council-1.0"`
- `lead_id` + `lead_schema_version`: must match the source lead exactly
- `judges`: array of 3 entries (or 1-2 with `"abstain": true` markers in abstention cases)
- `verdict`: enum `"approved" | "killed" | "abstained" | "unprocessable"`
- `next_step`: enum `"schemer" | "graveyard" | "manual_review"`
- `kill_reasons`: present only when `verdict == "killed"`; compiled from low-scoring judge red_flags + skeptic kill_reasons

## 10. Brain Paths

- **Verdicts:** `brain/05-leads/{date}/{lead_id}.verdict.json` — sidecar to the lead file, never mutating it
- **Approved leads pickup:** Foundry Schemer (C7) globs `brain/05-leads/**/*.verdict.json` filtering `verdict == "approved"`
- **Council session reports:** `brain/05-leads/_sessions/council-{ISO_TIMESTAMP}.json` — one per Worker run (cron or webhook batch), captures leads_processed, approved_count, killed_count, abstained_count, total NIM calls, wall_clock
- **Review queue:** `brain/05-leads/_review/{lead_id}.verdict.json` — abstained verdicts; Tyler-side manual triage

## 11. Telemetry

POST to `/api/intel/log` (D1 `hunt_intelligence` table, persona=`council`):

- `deliberation_start` — lead_id, trigger source
- `judge_called` — judge name, latency_ms, score (or `null` if abstained)
- `judge_failed` — judge name, error text (1 retry already attempted)
- `verdict_written` — lead_id, verdict, geometric_mean
- `deliberation_complete` — counts, wall_clock_ms

Tyler reads aggregate via `GET /api/intel/summary?days=7&persona=council`.

## 12. Failure Modes

- **NIM 429** → exponential backoff (1s, 4s) + abort at 2nd retry → judge abstention
- **NIM 5xx** → same as 429
- **brain-write 5xx** → 3 retries with 30s delay; if all fail, dump verdict to KV under `pending-verdicts:{lead_id}` for next-run flush. Never silently lose a verdict.
- **Lead file unreadable** → log `lead_unreadable`, skip, no verdict written (Tyler manually triages)
- **Telegram report failure** → log only; verdict file is the source of truth, Telegram is convenience

## 13. Cost Ceiling

- NIM Nemotron-120B: 3 calls per deliberation × ~2k input tokens × ~1k output tokens (each judge response is small, plus reasoning) — well within free-tier developer access at Tyler's volume.
- Workers CPU: ~5s wall-clock per deliberation × 50ms cron CPU avg → negligible.
- Brain-write: 1 verdict + 1 session-report fragment per run.
- D1: ~5 intel rows per deliberation.

Effective monthly cost: $0. Cost-breach guard: any single deliberation exceeding 10 NIM calls → emergency abort + `cost_breach` alert. (Should never trigger; 3 judges × 1 retry = 6 max.)

## 14. Telegram Report Format

Optional but recommended. Posted to a dedicated bot (`@TheFoundryBot` planned, token TBD) on every verdict:

```
🏛️ DESIGNER COUNCIL — Verdict

Lead: {lead_id}
Pain: {pain_statement}

The Realist:   {score}/100 — {verdict}
The Economist: {score}/100 — {verdict}
The Skeptic:   {score}/100 — {verdict}

Geometric Mean: {gm}%
Verdict: {APPROVED ✅ | KILLED ❌ | ABSTAINED ⚠️}

{If killed: top kill_reasons[0]}
{If approved: → Schemer is drafting the THDD scaffold}
{If abstained: → manual review at brain/05-leads/_review/}
```

Token: `COUNCIL_TELEGRAM_TOKEN` env (optional secret; absent → skip Telegram, never fail deliberation).

## 15. Versioning Policy

`verdict_schema_version` bumps follow LOCKE-OUTPUT-SCHEMA conventions:

- `council-1.0` → `council-1.1` for additive fields, widened enums, new judge prompt clarifications
- `council-1.0` → `council-2.0` for breaking changes: removed judges, changed scoring formula, changed threshold semantics, removed verdict enum values

Schemer (C7) will read `verdict_schema_version` and route to the matching deserializer. Old verdicts remain readable; new verdicts use the current schema. Multiple versions coexist indefinitely.

## 16. Cross-references

- `LIBRARIAN-SCHEMA.md` (sibling) — Locke's framework; Council reads its output
- `LOCKE-OUTPUT-SCHEMA.md` (sibling) §5 — Council Consumption Contract that this schema implements
- `prompts/COUNCIL.md` v1.0.0 — verbatim source of the 3 judge prompts
- `prompts/SCHEMER-AND-REVIEWER.md` — downstream of `verdict == "approved"` (Foundry C7)
- `MAP.md` C5 + C6 — this schema feeds C6 Council Worker scaffold
- `CHARTER.md` — Bible 1.1 Spirit Test (vendor independence) + cost ceiling

This schema is **immutable v1.0** for the duration of clue-6 through clue-7. Revisions land as v1.1+ at C8 retro if empirical data demands it. The 95% threshold may be calibrated down if early deliberations kill everything (false-positive bias) — that recalibration is C8 retro work, not v1 patching.
