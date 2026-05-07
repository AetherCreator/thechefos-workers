# LIBRARIAN-SCHEMA.md — The Forge & Library Harvest Framework

**Status:** v1.1 (analysis tier swapped Gemini Flash → NIM Nemotron-120B 2026-05-07; rest of spec unchanged from v1.0)
**Substrate:** Cloudflare Worker per persona (`packages/{persona}-harvest/`), cron-scheduled via `wrangler.toml`, output via brain-write Worker at `https://api.thechefos.app/api/brain/push`
**Consumed by:** C3 (locke-harvest Worker scaffold reads this verbatim), C6 (Council Worker reads outputs validated against attached output schemas)
**Bible:** 1.1 + §A7 + §A8 + §A9 candidate

---

## 1. Purpose

The Librarian Schema is the **infrastructure contract** every hunter-style agent in the Forge & Library hunt MUST conform to. It defines schedule model, source pool, brain/ output paths, stop conditions, deduplication, telemetry, and failure modes. It does NOT define what a hunter searches for or how its output is shaped — those are persona-specific concerns delegated to (a) the persona's `SOUL.md`, (b) the persona's `prompts/{PERSONA}.md` template, and (c) a registered Output Schema document like `LOCKE-OUTPUT-SCHEMA.md`.

The Librarian Schema enables one Worker scaffold to serve many hunter personas. Locke Lamora is the first concrete agent (demand-signal hunter, output → `brain/05-leads/`). Future agents — a Layer-1 knowledge harvester writing wiki entries to `brain/05-knowledge-wiki/`, a competitor-tracking agent watching specific products, etc. — plug into the same scaffold by swapping SOUL and Output Schema bindings without touching the harvest pipeline code.

This separation matters because the Forge (Layer 2 — demand → Council → Foundry) and the Library (Layer 1 — knowledge wiki) share the same hunting mechanics but emit very different shapes for very different consumers. One scaffold, N personas.

## 2. Architectural Pattern — Persona Wiring

Every Librarian-conforming agent is composed of four parts:

1. **`{PERSONA}-SOUL.md`** — voice, principles, taste. Example: `LOCKE-LAMORA-SOUL.md`. Loaded into the analysis-model system prompt at hunt time.
2. **`prompts/{PERSONA}.md`** — concrete query plan and analysis instructions. Example: `prompts/HUNTER.md`. Loaded into the analysis-model user-prompt template at hunt time.
3. **`{PERSONA}-OUTPUT-SCHEMA.md`** — JSON shape the agent emits per find. Example: `LOCKE-OUTPUT-SCHEMA.md`. Validates every emit before brain-write.
4. **`wrangler.toml` binding** — declares the persona name, cron expression, and target brain path. Worker auto-resolves SOUL / PROMPT / SCHEMA from convention rooted at `hunts/forge-and-library/`.

`packages/locke-harvest/` (built in C3) is the first concrete instance. Future personas reuse the same Worker code with different bindings.

## 3. Schedule Model

Three trigger modes:

**(a) Cron, declared in `wrangler.toml`.** Persona-defined. Locke targets `0 0 * * SUN` (Sunday midnight UTC) per HUNTER.md §Hunt Schedule — note Cloudflare's cron parser rejects `0 0 * * 0`, hence the named-day form. A future Layer-1 knowledge harvester might run `0 5 * * *` (5 AM UTC daily). The Worker reads its own cron context to log the trigger source.

**(b) Manual webhook (`POST /run`).** Each harvest Worker exposes a private `/run` endpoint protected by a shared secret in `/opt/secrets/forge-harvest-key`. Tyler triggers manually via `/hunt` Telegram command (resolved through Mastro's WF04 to a `curl` against the Worker), or directly during smoke testing.

**(c) Seed-refresh sub-cycle.** Every 14 days the Worker re-pulls a seed-domain list from `brain/05-knowledge-wiki/seeds/{persona}.json` (for Locke: subreddit names, HN tags, niche forums). This prevents query staleness without rewriting prompts.

## 4. Source Pool

Source mediation is centralized. Hunter Workers do NOT hit external APIs directly. They go through three centralized adapters:

- **SearXNG** at `https://searxng-tunnel.thechefos.app/search` (Cloudflare-tunneled, 4-hour cache) — Google, Brave, DDG, Startpage meta-search.
- **Agent-Reach** at `https://agent-reach.thechefos.app/extract` — Reddit, YouTube, RSS, web extraction. Install pending; C1 audit confirms.
- **NIM Nemotron-120B** at `https://integrate.api.nvidia.com/v1/chat/completions` — OpenAI-compatible chat-completions; synthesis, classification, persona narration. Swappable to any compat endpoint by changing `NIM_URL` + `NIM_MODEL` in `wrangler.toml`.

Each adapter has a fixed request/response shape. Hunter Workers compose calls but never mint new adapter logic. New source types (e.g., Twitter/X) require an adapter PR, not a Worker change. Analysis-tier swaps (e.g., to a different Nemotron rev or an alternate compat endpoint) are var-only — no code changes — provided the new endpoint speaks OpenAI chat-completions and supports `messages` + `temperature` + `max_tokens`.

## 5. Brain/ Harvest Paths

Outputs land at deterministic paths to enable deterministic dedup and Council consumption:

- **Leads (Locke + future demand-signal hunters):** `brain/05-leads/{YYYY-MM-DD}/{lead_id}.json`
- **Drafts (low-confidence, manual-triage queue):** `brain/05-leads/_drafts/{lead_id}.json`
- **Knowledge entries (future wiki harvesters):** `brain/05-knowledge-wiki/{domain}/{slug}.md`
- **Hunt session reports:** `brain/05-leads/_sessions/{persona}-{ISO_TIMESTAMP}.json` — one per `/run`, includes all candidate URLs scanned, kept-vs-discarded counts, total analysis-model calls.
- **Skiplist:** `brain/05-leads/_skiplist.json` — abandoned/low-quality lead_ids; matching emits get auto-rejected at write time.

The brain-write Worker (`POST https://api.thechefos.app/api/brain/push`) handles base64 + GitHub commit. Hunter Workers send plain-text `{path, content, message}` and authenticate with the brain-write secret loaded at deploy time (`BRAIN_WRITE_SECRET` env via `wrangler secret put`).

## 6. Stop Conditions (per /run)

A single hunt cycle MUST terminate when ANY of the following hits:

1. **Max leads kept** — 5 (configurable per persona). Higher-confidence finds displace lower ones until cap hit.
2. **Wall-clock budget** — 8 minutes. Beyond this, partial results are written and the Worker exits with `partial_timeout` status.
3. **Analysis-model quota** — 50 requests per `/run` hard ceiling (`NIM_BUDGET` env). NIM Nemotron-120B free-tier limits are higher than this; this ceiling exists to bound runaway loops, not to track a paid quota.
4. **SearXNG-error-burst** — 5 consecutive 5xx from SearXNG → bail with `source_unavailable`.
5. **No promising threads after Phase 1** — if SearXNG returned <3 emotion-bearing candidates, exit with `no_signal` and skip Phases 2–3.

Every termination writes a session report. `partial_timeout` and `no_signal` are NOT failures — they're valid honest outcomes per Locke's seventh rule ("never con an honest man" — including yourself).

## 7. Deduplication Policy

Three-layer dedup, applied in order:

- **By thread URL** — if a candidate URL was scanned in any session within 30 days, skip without scoring (KV-backed bloom filter across Worker invocations).
- **By lead_id slug** — Locke proposes `lead_id` like `invoice-reminder-solo`. If a file at `brain/05-leads/**/{lead_id}.json` already exists, MERGE: append source_threads, lift confidence to higher of two, append related_leads, update `harvested_at`. Never duplicate the file.
- **By content-hash** — sha256 of the normalized JSON payload; identical hash to a recent emit (within 7 days) → discard with `dup_content` log.

The Worker writes a dedup log entry per skip, observable via `/api/intel/log`.

## 8. Anti-Loop / Anti-Spam

- **Per-source rate limits** — never crawl same subreddit/HN-tag more than once per 6-hour window. Enforced via KV TTL.
- **Confidence floor** — only `medium`+ confidence leads reach Council. `low` leads land in `_drafts/` for manual triage.
- **Generic-pattern reject** — model outputs containing "everyone", "all developers", "many users" without specificity get auto-rejected by validator (see LOCKE-OUTPUT-SCHEMA §2).

## 9. Telemetry & Observability

Every meaningful event POSTs to `/api/intel/log` (D1 `hunt_intelligence` table):

- `harvest_start` — persona, trigger source (cron / manual), seed signature
- `query_executed` — query text, source, result count
- `lead_kept` / `lead_discarded` — lead_id, confidence, reason
- `nim_failed` — error text, session_id (renamed from `gemini_failed` in v1.1)
- `harvest_complete` — total_leads, nim_calls, wall_clock_seconds, exit_status

Tyler reads aggregate via `GET /api/intel/summary?days=7&persona=locke`.

## 10. Failure Modes

- **NIM 429** → exponential backoff (1s, 4s, 16s) + abort at 3rd retry. Session marked `quota_partial`.
- **brain-write 5xx** → 3 retries with 30s delay. If all fail, dump JSON to KV under `pending-writes:{ts}` for next-run flush.
- **Adapter timeouts** → log per-call, treat as missing data for that thread, continue with what's available.
- **Schema validation failure** → discard the lead, log `validation_error` with persona + lead_id + field-level diff. Never write malformed JSON to brain/.
- **Reasoning-block bleed-through** — Nemotron emits `<think>...</think>` reasoning before its final answer. The Worker strips these before JSON parse; failure to strip → `nim_failed` with parse error rather than malformed write.

## 11. Output Contract

Hunter Workers MUST validate every emit against the persona's registered Output Schema before calling brain-write. Validation failure = silent discard with telemetry, never a half-written file.

For Locke specifically, the contract is `LOCKE-OUTPUT-SCHEMA.md` (sibling document). Worker imports a generated `zod` schema from that doc and pipes every model response through it before any brain/ write.

## 12. Cost Ceiling

Per-run budgets (enforced):

- NIM Nemotron-120B: 50 requests/run × ~500 input tokens × ~3000 output tokens (Nemotron reasoning is verbose) — well within free-tier developer access.
- Workers CPU: 8-min wall-clock × ~50ms cron CPU avg → negligible.
- KV reads/writes: <100/run.
- D1 inserts: <50/run.

Monthly target: ~$0/mo across all hunter personas — NIM access is free at Tyler's volume, all other surfaces are CF-free-tier. The $9/mo Forge & Library budget remains an aspirational ceiling, not a tracked spend. Cost ceiling enforcement: any single `/run` exceeding 100 NIM calls triggers a `cost_breach` alert via intel_log + immediate exit.

## Cross-references

- `LOCKE-LAMORA-SOUL.md` (sibling) — Locke persona contract, prototype Lead JSON
- `LOCKE-OUTPUT-SCHEMA.md` (sibling) — concrete Lead JSON spec for the first persona
- `prompts/HUNTER.md` — Locke's hunting prompt template (Phase 1 → 2 → 3 strategy)
- `prompts/COUNCIL.md` — downstream consumer of Lead JSON
- `prompts/SCHEMER-AND-REVIEWER.md` — Foundry pipeline downstream of Council
- `MAP.md` — overall hunt structure; this schema feeds C3 (locke-harvest Worker)
- `CHARTER.md` — original cost discipline + Spirit Test
- `clue-1/pre-flight-report.md` — infra readiness audit C2 inherits

## v1.1 changelog (2026-05-07)

- §2: "Gemini system prompt" → "analysis-model system prompt" (vendor-agnostic phrasing)
- §3: Cron form noted as `0 0 * * SUN` (named day) — Cloudflare's parser rejects `0 0 * * 0`
- §4: Source pool entry swapped Gemini Flash → NIM Nemotron-120B; added swap-mechanism note (var-only, no code change)
- §6: "Gemini quota" → "Analysis-model quota" + clarification on NIM free-tier headroom
- §9: Telemetry event names updated (`gemini_failed` → `nim_failed`)
- §10: Failure mode names updated; new entry for Nemotron `<think>` reasoning-block stripping
- §12: Cost ceiling reflects NIM (not Gemini) — and notes the actual monthly spend is $0, with the $9/mo CHARTER number being an aspirational ceiling

This schema is **immutable v1.1** for the remaining clue-3 through clue-7 builds. Further revisions land as v1.2+ at C8 retro if empirical data demands it.
