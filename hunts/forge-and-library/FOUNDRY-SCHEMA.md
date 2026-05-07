# FOUNDRY-SCHEMA — Foundry Pipeline Framework v1.0

**Schema version:** `foundry-1.0`
**Status:** draft (C7 MVP)
**Companions:** [LIBRARIAN-SCHEMA.md](./LIBRARIAN-SCHEMA.md) (harvest), [LOCKE-OUTPUT-SCHEMA.md](./LOCKE-OUTPUT-SCHEMA.md), [COUNCIL-SCHEMA.md](./COUNCIL-SCHEMA.md)

> Closes the autonomous swarm loop: **Locke** harvests → **Council** deliberates → **Foundry** builds & ships. After C7 ships, the swarm runs end-to-end manually; v1.1 wires the webhook chain.

---

## §1. Purpose & scope

The Foundry pipeline converts an APPROVED Council verdict (geometric mean ≥ 95.0 across 3 judges) into a deployable product. Three personas operate in sequence:

1. **The Schemer** — converts a validated demand signal into a complete THDD hunt scaffold (MAP.md + clue caches). Reads verdicts, writes plans. LLM-tier (Workers AI Kimi K2.6 in-network).
2. **The Builder** — orchestrates clue execution against the existing hunter substrate (Mastro `@Mastro_ClaudeBot` + `claude-exec.sh` + `hunter-exec.py`). **No LLM.** Pure orchestration.
3. **The Reviewer** — runs a 5-gate QA check on the shipped product. LLM-tier (Claude Haiku 4.5 via API, ~$0.002/review).

### v1.0 MVP scope (THIS clue, C7)

- All 3 Workers deployed, each with `/health` + `/run-manual` endpoints, CI deploy via `deploy.yml` step-level guards.
- **Schemer** produces a foundry-1.0 Plan from a verdict file (smoke against fixture).
- **Builder** logs intent (`status: "logged"`) without invoking Mastro — full Mastro integration deferred to v1.1.
- **Reviewer** runs Gates 1, 3, 4, 5 on a passed-in URL — Gate 2 (Stripe) deferred to v1.1.
- Webhook chain (Council→Schemer→Builder→Reviewer) **deferred** — manual `/run-manual` only.
- All crons **deferred** — `[triggers]` blocks omitted, restore in v1.1 named-day form.

### v1.1 polish (deferred, separate clue/hunt)

- Wire Council `deliberate()` to POST Schemer `/run/:lead_id` on `verdict === 'approved'`.
- Wire Schemer to POST Builder `/build/:product-slug` on plan-complete.
- Wire Builder to POST Reviewer `/review/:product-slug` on all-clues-complete.
- Add Mastro webhook integration in Builder (`MASTRO_TRIGGER_URL` secret).
- Add Stripe Gate 2 in Reviewer (`STRIPE_API_KEY` secret).
- Restore weekly crons: Schemer `0 2 * * SUN`, Builder + Reviewer webhook-only.

---

## §2. Architecture

```
  Council          Schemer             Builder             Reviewer
 (existing)        (new)               (new)               (new)
   |                |                   |                   |
   v                v                   v                   v
 verdict.json --> Plan (MAP.md +    --> build-status.json --> REVIEW.json
  brain/05-       clue caches)        brain/06-foundry/    brain/06-foundry/
   leads/         brain/06-foundry/   {date}/{slug}/       {date}/{slug}/
   {date}/        {date}/{slug}/MAP   build-status.json    REVIEW.json
   {id}.verdict   .md + clue-caches/  {clue→state map}     {gates → verdict}
   .json
```

### v1.0 trigger surfaces (manual only)

| Worker | Endpoint | Notes |
|---|---|---|
| Schemer | `POST /run-manual?lead_id=X&verdict_path=Y&secret=Z` | `verdict_path` optional — defaults to today/yesterday/_review/ scan |
| Builder | `POST /run-manual?plan_path=X&secret=Y` | v1.0: logs only, no Mastro fire |
| Reviewer | `POST /review-manual?product_url=X&product_slug=Y&secret=Z` | v1.0: skips Stripe gate |

All Workers also expose `GET /health` returning `{ok, persona, schema, model}`.

---

## §3. Model choices

| Persona | Model | Cost / call | Rationale |
|---|---|---|---|
| Schemer | `@cf/moonshotai/kimi-k2.6` (Workers AI binding, sync) | ~$0.01 | Mirrors Locke + Council post-pivot (vendor independence; escapes NIM edge 524). Reasoning model handles structured THDD generation. `max_tokens: 16384` per LIBRARIAN/Council Kimi rule. |
| Builder | _(none)_ | $0 | Orchestration shell — fetch+poll, no inference. |
| Reviewer | `claude-haiku-4-5-20251001` via Anthropic API | ~$0.002 (3 calls × ~500 tokens) | Per-call cost matters because Reviewer fires per-build. Haiku is fast + cheap + sufficient for QA. Use existing `ANTHROPIC_API_KEY` secret pattern. |

---

## §4. Output contracts

### §4.1 Schemer output — foundry-1.0 Plan

**Path:** `brain/06-foundry/{date}/{product-slug}/MAP.md` plus `clue-caches/{N}.md` per clue.

**MAP.md structure** (Schemer must produce this exact shape):

```markdown
# Hunt: {product-slug}
Schema: foundry-1.0
Generated: {ISO8601}
Source verdict: {verdict_path}
Source lead: {lead_id}
Goal: {one sentence — what ships}
Repo: {product-slug} (new)
Treasure: {what Tyler sees when it works}

## Clues

1. [CODE] [Sonnet] **Scaffold** — {one-line desc}
   pass: {explicit criterion incl. GitHub push step}

2. [CODE] [Sonnet] **{Title}** — {one-line desc}
   pass: {criterion}

(3-5 clues total)

## Estimated build time
{N} hours (must be ≤ 4)
```

**Schemer self-validation rules** (before brain-write):

- 3 ≤ N(clues) ≤ 5
- Every clue has explicit `pass:` line referencing GitHub push
- Every clue tagged `[CODE]` + tier tag (`[Sonnet]` or `[Haiku]`)
- Total estimated time ≤ 4 hours
- Clue 1 title contains "Scaffold" (deploy stub first)
- If `lead.estimated_price !~ /free|^\$0/i` → at least one clue title contains "Stripe" or "Payment"
- No forward dependency references (clue N may not require clue M for M > N)
- Reject generic targeting: any clue containing "everyone", "all users", "all developers" in pass criteria → re-prompt

If validation fails, re-prompt Kimi with specific rule violations cited inline. **Max 2 retries**, then write to `_drafts/{slug}-rejected-{session_id}.json` with full diagnostic + abstain.

### §4.2 Builder output — build-status.json

**Path:** `brain/06-foundry/{date}/{product-slug}/build-status.json`

```json
{
  "schema_version": "foundry-1.0",
  "product_slug": "string",
  "plan_path": "brain/06-foundry/{date}/{slug}/MAP.md",
  "started_at": "ISO8601",
  "ended_at": "ISO8601",
  "status": "logged | fired | complete | failed",
  "clues": [
    {
      "n": 1,
      "title": "Scaffold",
      "status": "logged | fired | complete | failed",
      "fired_at": "ISO8601 | null",
      "completed_at": "ISO8601 | null",
      "evidence": "commit_sha | null"
    }
  ],
  "next_step": "review | escalate | manual",
  "notes": "v1.0 MVP: status='logged' only — Mastro integration deferred to v1.1"
}
```

**v1.0 behavior:** Builder reads MAP.md, parses clue list, writes build-status.json with all clues at `status: "logged"` and `next_step: "manual"`. No Mastro POST. The shape is forward-compatible with v1.1 firing.

### §4.3 Reviewer output — REVIEW.json

**Path:** `brain/06-foundry/{date}/{product-slug}/REVIEW.json`

```json
{
  "schema_version": "foundry-1.0",
  "product_slug": "string",
  "product_url": "string",
  "reviewed_at": "ISO8601",
  "model": "claude-haiku-4-5-20251001",
  "gates": {
    "loads":         { "pass": true,  "ms": 234, "status_code": 200 },
    "stripe":        { "pass": null,  "skipped": "v1.0 deferred" },
    "mobile":        { "pass": true,  "issues": [], "severity": "none" },
    "copy":          { "pass": true,  "value_prop_clear": true, "cta_present": true, "issues": [] },
    "embarrassment": { "pass": true,  "risk": "none", "ship_recommendation": "ship", "reason": "..." }
  },
  "verdict": "shipped | fix_first | killed",
  "wall_clock_ms": 1234
}
```

**Gate severity → verdict mapping:**

- Gate 1 (loads): non-200 or > 5000ms → `verdict: "killed"`
- Gate 3 (mobile): `severity: "critical"` → `verdict: "fix_first"`
- Gate 4 (copy): `copy_quality: "poor"` → `verdict: "fix_first"`
- Gate 5 (embarrassment): `risk: "high"` → `verdict: "killed"`
- Otherwise → `verdict: "shipped"`

---

## §5. Brain paths

| Worker | Reads | Writes |
|---|---|---|
| Schemer | `brain/05-leads/{date}/{lead_id}.verdict.json` (verdict.approved) + lead JSON | `brain/06-foundry/{date}/{slug}/MAP.md`, `brain/06-foundry/{date}/{slug}/clue-caches/*.md` |
| Builder | `brain/06-foundry/{date}/{slug}/MAP.md` | `brain/06-foundry/{date}/{slug}/build-status.json` |
| Reviewer | _(passed in: product_url + slug)_ | `brain/06-foundry/{date}/{slug}/REVIEW.json` |

**Conventions** (mirror Council/Locke):
- All reads use `Authorization: Bearer ${GITHUB_TOKEN}` against `raw.githubusercontent.com` (per `private-brain-bearer-on-raw` pattern).
- All writes go through `https://api.thechefos.app/api/brain/push` with `x-webhook-secret: ${BRAIN_WRITE_SECRET}` header.
- Telemetry to `https://api.thechefos.app/api/intel/log` (best-effort, never blocks).

`brain/06-foundry/` is a new top-level brain directory — created on first Schemer write.

---

## §6. Schedule

**v1.0 MVP: ALL MANUAL.** No `[triggers]` blocks in any wrangler.toml.

**v1.1 cron plan (deferred, separate clue):**

| Worker | Cadence | Form |
|---|---|---|
| Schemer | weekly, 1h after Council sweep | `crons = ["0 2 * * SUN"]` |
| Builder | webhook-only, no cron | — |
| Reviewer | webhook-only, no cron | — |

Use named-day form (`SUN-SAT`) per `cf-cron-strictness` pattern (Cloudflare's parser rejected `0 0 * * 0`).

---

## §7. Validation rules (consolidated)

See §4.1 (Schemer plan validation) and §4.3 (Reviewer gate severity). Cross-cutting rules:

- All Workers respond `403` on missing/invalid `?secret=` param.
- All Workers respond `400` on missing required query params.
- All Workers respond `404` on unknown path.
- All Workers MUST return `{schema_version: "foundry-1.0", ...}` on every JSON response (forward compat).
- Worker `/health` MUST include `{ok, persona, schema, model}` minimum (mirrors Locke + Council).

---

## §8. Failure modes & recovery

| Failure | Worker | Recovery |
|---|---|---|
| Kimi K2.6 returns empty content | Schemer | logIntel + write `_drafts/schemer-error-{session}.json` with full diagnostic; abstain |
| Plan validation fails | Schemer | re-prompt with specific rule violations; max 2 retries; write `_drafts/{slug}-rejected-{session}.json` if all fail |
| GitHub Contents API 404 (no verdict) | Schemer | return `{error: "verdict_not_found"}` 404 |
| MAP.md parse fails | Builder | log + return `{error: "plan_invalid"}` 422 |
| Mastro webhook unreachable | Builder | _(v1.1 only — v1.0 logs only)_ retry w/ backoff; mark clue `failed`; escalate Telegram |
| Haiku API 429/5xx | Reviewer | retry once with backoff; mark gate `pass: null, error: "..."`; continue other gates |
| Brain-write 5xx | any | Worker logs intel + throws into caller; do not partial-write |

**Diagnostic-write-to-brain pattern** (per Locke session-9): in any catch block where telemetry might be silently dropped, ALSO write a debug node to `brain/06-foundry/_drafts/{worker}-error-{session_id}.json` with full payload preview (≤5KB). Turns silent failures into visible failures within 1 iteration.

---

## §9. Cost ceiling

| Component | Per invocation | Per fire (1 build) | Per week (1 fire) | Per year |
|---|---|---|---|---|
| Schemer (Kimi K2.6, ~16k tokens) | ~$0.010 | $0.010 | $0.010 | $0.52 |
| Builder | $0 | $0 | $0 | $0 |
| Reviewer (Haiku, 3 calls × ~500 tok) | ~$0.002 | $0.002 | $0.002 | $0.10 |
| **Foundry total** | — | **~$0.012** | **~$0.012** | **~$0.62** |

Adds <$1/year to the autonomous swarm. Stays well under Tyler's $9/mo full-swarm budget. Combined with Locke (~$0.04/mo) + Council (~$0.04/mo) the entire swarm costs ~$0.10/mo at MVP cadence.

---

## §10. Versioning

| Version | Status | Scope |
|---|---|---|
| `foundry-1.0` | this version (C7) | MVP — all manual triggers, Builder logs-only, Reviewer 4/5 gates |
| `foundry-1.1` | planned (next clue or follow-up hunt) | webhook chain + Mastro integration + Stripe Gate 2 + crons |
| `foundry-2.0` | future | full automated product factory (real GitHub repos, real Vercel deploys, MRR tracking) |

Every output JSON includes `schema_version` for forward compat. v1.1 readers parse v1.0 fields gracefully; v1.1 adds **optional** fields only.

---

## §11. Spirit Test

Per system architectural rule: every proposal must decrease vendor dependency, not increase it.

- Schemer on Workers AI Kimi K2.6 — already in-network with Locke + Council. **No new vendor.** ✅
- Reviewer on Anthropic Haiku — Tyler is already paying Claude Max + Anthropic API. **No new vendor.** ✅
- Builder uses existing Mastro substrate (v1.1) — Tyler-owned. **No new vendor.** ✅
- All brain reads/writes through existing brain-write Worker. **No new vendor.** ✅

Foundry adds **zero** new vendor dependencies. Spirit Test ✅.

---

`HUNT_INTEGRATION: forge-and-library/C7 — Foundry pipeline schema for Schemer + Builder + Reviewer Workers. v1.0 MVP all-manual; v1.1 polish wires webhook chain + Mastro + Stripe + crons.`
