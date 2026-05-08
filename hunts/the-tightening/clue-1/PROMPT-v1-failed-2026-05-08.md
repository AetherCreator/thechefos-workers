[CODE-AUTONOMOUS][DETERMINISTIC][SUBSTANTIAL]

# The Tightening — Clue 1: Cost-Telemetry Worker + Locke Defer Guard

**Hunt:** the-tightening
**Clue:** 1
**Source of truth:** `hunts/the-tightening/CHARTER.md` and `MAP.md` (read first)
**Reference patterns:** existing `packages/locke-harvest/` and `packages/council/` (Worker shape, Bearer auth on raw.githubusercontent.com, brain-read pattern, deploy.yml step-level $GITHUB_OUTPUT guard, staged-source cp pattern from forge-and-library C6/C7)
**Substrate discipline:** Bible 1.1 + §A7 audit-wrap + §A8 reasoning-weight + §A9 SUBSTANTIAL. Diagnostic-write-to-brain on errors. **Author COMPLETE.md at Task 7, BEFORE /health probes** (partial-complete antipattern mitigation).

---

## Goal

Ship a `cost-telemetry` Worker that gives the swarm visibility into Workers AI neuron consumption, plus patch Locke to defer when neurons are low.

After this clue:

- `https://cost-telemetry.tveg-baking.workers.dev/health` → 200 with `{ok:true, persona:"cost-telemetry", schema:"telemetry-1.0", model:null}`
- `https://cost-telemetry.tveg-baking.workers.dev/dashboard` → 200 with JSON `{traffic_light, neurons_used_estimate, neurons_remaining_estimate, neurons_cap, locke_fires_today, council_fires_today, schemer_fires_today, reviewer_fires_today, last_updated, basis}`
- `packages/locke-harvest/src/index.ts` contains a defer guard: BEFORE the first `env.AI.run()` call in `runHunt()`, fetch `https://cost-telemetry.tveg-baking.workers.dev/dashboard`; if `traffic_light === "red"` OR `traffic_light === "depleted"`, return `{kept:0, discarded:0, status:"deferred", reason:"neurons_low", session_id}` and write a session report with `status:"deferred"`. Wrap the dashboard fetch in try/catch — failure to reach telemetry should NOT block Locke (log warning, proceed).
- CI green on `main`.
- COMPLETE.md authored at Task 7.

---

## Calibration (MVP — approximate)

Since CF Workers AI doesn't expose per-account neuron counters via a free API, estimate from session reports. Calibration constants (start conservative; tune after observation):

- Each Locke fire (manual or cron): **~3000 neurons** (12 candidates × ~250 neurons per Kimi K2.6 analysis)
- Each Council fire: **~900 neurons** (3 judges × ~300 neurons each)
- Each Schemer fire: **~500 neurons** (one Kimi K2.6 plan synthesis)
- Each Reviewer fire: **~500 neurons**
- Each Builder fire: **0 neurons** (no LLM)
- Cap: `10000` (free tier daily allocation, resets ~midnight UTC)

These constants live in the Worker's `[vars]` block as `LOCKE_NEURONS_PER_FIRE`, etc. Tune later via observation.

Traffic light:
- `green`: estimated_used < 0.5 × cap
- `yellow`: 0.5–0.85 × cap
- `red`: 0.85–1.0 × cap
- `depleted`: ≥ cap

---

## Tasks (execute in order; do NOT skip Task 7)

### Task 1 — Read references

```bash
rtk cat packages/locke-harvest/src/index.ts | head -200
rtk cat packages/locke-harvest/wrangler.toml
rtk cat packages/council/src/index.ts | head -100
rtk cat packages/council/wrangler.toml
rtk cat .github/workflows/deploy.yml
rtk cat hunts/the-tightening/CHARTER.md
rtk cat hunts/the-tightening/MAP.md
```

Internalize the Worker shape: TypeScript, `compatibility_date` 2026-05-01, nodejs_compat, account_id `cc231edbff18405233612d7afb657f1f`, Bearer auth on `raw.githubusercontent.com` for private brain reads, brain-write Worker pattern for writing daily rollup nodes.

### Task 2 — Stage cost-telemetry Worker source

Write to `hunts/the-tightening/clue-1/staged/cost-telemetry/`:

- **`src/index.ts`** — TypeScript Worker. NO LLM (no `[ai]` binding, `model:null` in /health).
  - `Env` interface: `PERSONA, TELEMETRY_SCHEMA_VERSION, NEURON_CAP, LOCKE_NEURONS_PER_FIRE, COUNCIL_NEURONS_PER_FIRE, SCHEMER_NEURONS_PER_FIRE, REVIEWER_NEURONS_PER_FIRE, BRAIN_RAW_BASE, BRAIN_GH_API_BASE, BRAIN_WRITE_URL, GITHUB_TOKEN, BRAIN_WRITE_SECRET, TELEMETRY_RUN_SECRET, KV: KVNamespace`
  - `GET /health` → `{ok:true, persona:"cost-telemetry", schema:"telemetry-1.0", model:null}`
  - `GET /dashboard` → reads cached rollup from KV key `rollup:YYYY-MM-DD` (today UTC); if missing or older than 10 min, recomputes from brain (scan `brain/05-leads/_sessions/` for `*-{today}*.json` matching prefix `locke-lamora-`, `council-`, `schemer-`, `reviewer-`); returns JSON per pass condition shape; caches back to KV with 10-min TTL via timestamp field
  - `POST /run-manual?secret=X` → forces a fresh recompute; same response shape as /dashboard
  - `scheduled()` handler → runs at cron `0 */1 * * *` (hourly): recomputes, writes daily rollup to `brain/02-knowledge/cost-rollup-YYYY-MM-DD.md` via brain-write Worker (only on the hourly fire that crosses 23:00 UTC, write the final day's rollup; otherwise just refresh KV cache)
  - **Diagnostic-write-to-brain pattern** on errors: if brain read fails or rollup write fails, write `_drafts/cost-telemetry-error-{session}.json` with stack trace
  - `404` on other paths

- **`wrangler.toml`** — mirror Council's shape:
  - `name = "cost-telemetry"`, `main = "src/index.ts"`, `compatibility_date = "2026-05-01"`, `compatibility_flags = ["nodejs_compat"]`
  - `account_id = "cc231edbff18405233612d7afb657f1f"`
  - `[vars]` block with PERSONA, TELEMETRY_SCHEMA_VERSION="telemetry-1.0", NEURON_CAP="10000", LOCKE_NEURONS_PER_FIRE="3000", COUNCIL_NEURONS_PER_FIRE="900", SCHEMER_NEURONS_PER_FIRE="500", REVIEWER_NEURONS_PER_FIRE="500", BRAIN_RAW_BASE, BRAIN_GH_API_BASE, BRAIN_WRITE_URL, INTEL_LOG_URL
  - `[[kv_namespaces]]` — bind a NEW KV namespace `binding = "KV"`. Generate KV id via wrangler: `npx wrangler kv namespace create cost-telemetry-rollup` and put the returned id in wrangler.toml. (Hunter creates the namespace as part of this task; CI deploy will use the existing id.)
  - `[triggers]` block: `crons = ["0 * * * *"]` (hourly)
  - **No `[ai]` binding** — this Worker burns zero neurons.

- **`package.json`** — mirror Council shape: `{name:"cost-telemetry", version:"0.1.0", private:true, scripts:{deploy:"wrangler deploy"}, devDependencies:{"wrangler":"^3","typescript":"^5","@cloudflare/workers-types":"^4"}}`

### Task 3 — Stage Locke patch

Write to `hunts/the-tightening/clue-1/staged/locke-patch/index.ts.patch` a unified diff against `packages/locke-harvest/src/index.ts` that:

- Adds a `checkTelemetry(env)` async helper that fetches `https://cost-telemetry.tveg-baking.workers.dev/dashboard`, returns `{traffic_light, neurons_remaining_estimate}` or `{traffic_light:"unknown"}` on fetch fail
- Inserts a guard at the start of `runHunt()` (around the location of the first Kimi call): if `checkTelemetry()` returns `traffic_light === "red"` OR `"depleted"`, write a session report with `status:"deferred"`, `reason:"neurons_low"`, telemetry snapshot in `nim_text_preview`, return early
- Wraps `checkTelemetry` itself in try/catch; on fetch fail log warning, proceed (telemetry must not block Locke)

### Task 4 — Stage deploy.yml addition

Write to `hunts/the-tightening/clue-1/staged/deploy.yml.patch` — adds a `deploy-cost-telemetry` job mirroring the existing `deploy-council` job pattern, with step-level `$GITHUB_OUTPUT` guard (NOT job-level `if: hashFiles()` — that pattern is broken per partial-complete antipattern banked 2026-05-07).

Job structure: `runs-on: ubuntu-latest` → checkout → setup-node 20 → `cd packages/cost-telemetry && npm install && npx wrangler deploy` → uses GHA secret `CLOUDFLARE_API_TOKEN`. Step-level guard: a `check` step writes `exists=true|false` to `$GITHUB_OUTPUT`; deploy step gates on `if: steps.check.outputs.exists == 'true'`.

### Task 5 — Create KV namespace + populate id

Run on InfiniVeg WSL:

```bash
cd ~/thechefos-workers/packages/cost-telemetry  # will exist after Task 6 cp
# from /tmp staged location for now:
cd /tmp/the-tightening/clue-1/staged/cost-telemetry
npx wrangler kv namespace create cost-telemetry-rollup
```

Capture the returned id (looks like `id = "abc123..."`). Substitute into `wrangler.toml` `[[kv_namespaces]]` block.

If `wrangler` not on PATH, install: `npm install -g wrangler` (or use npx with a temporary install).

### Task 6 — cp staged → real package paths

```bash
mkdir -p packages/cost-telemetry/src
cp -r /tmp/the-tightening/clue-1/staged/cost-telemetry/. packages/cost-telemetry/
# apply locke patch
cd packages/locke-harvest && patch -p1 < /tmp/the-tightening/clue-1/staged/locke-patch/index.ts.patch
# apply deploy.yml patch
cd ../.. && patch -p1 < /tmp/the-tightening/clue-1/staged/deploy.yml.patch
```

### Task 7 — Author COMPLETE.md (BEFORE /health probe)

Write `hunts/the-tightening/clue-1/COMPLETE.md`:

```markdown
# Clue 1 — COMPLETE

**Status:** ✅
**Substrate evidence (3-axis):**
- Source: `packages/cost-telemetry/src/index.ts` exists, byte-equal to staged version
- CI: latest `deploy-cost-telemetry` job conclusion = success on commit {SHA}
- Runtime: `/health` returns 200 with persona=cost-telemetry, schema=telemetry-1.0

**Commits:**
- {SHA1} packages/cost-telemetry/* (new Worker)
- {SHA2} packages/locke-harvest/src/index.ts (defer guard)
- {SHA3} .github/workflows/deploy.yml (deploy-cost-telemetry job)

**KV namespace:** id={KV_ID} (cost-telemetry-rollup)

**Traffic light at completion:** {green|yellow|red|depleted}

**Patterns banked this clue:**
- (Hunter fills in any new patterns observed during execution)

**Next:** C2 PROMPT to be authored Chat-side after this completes.
```

Substitute the real {SHA}, {KV_ID}, {traffic_light} values from execution output.

### Task 8 — Commit + push

```bash
rtk git add packages/cost-telemetry packages/locke-harvest/src/index.ts .github/workflows/deploy.yml hunts/the-tightening/clue-1/staged hunts/the-tightening/clue-1/COMPLETE.md
rtk git commit -m "the-tightening C1: cost-telemetry Worker + Locke defer guard"
rtk git push origin main
```

### Task 9 — Verify CI green

Poll `gh run list --limit 1 --workflow deploy.yml` (or curl GitHub Actions API) until conclusion is `success`. Max wait: 5 min.

### Task 10 — Verify /health + /dashboard

```bash
curl -sS https://cost-telemetry.tveg-baking.workers.dev/health
curl -sS https://cost-telemetry.tveg-baking.workers.dev/dashboard
```

Both must return 200 with the expected schema. If /dashboard returns `traffic_light: "depleted"`, that is **expected** given current neuron exhaustion — not a failure.

### Task 11 — Long John ping

claude-exec.sh's built-in completion hook fires the 🏴‍☠️ ping automatically on exit 0. Nothing to do here.

---

## Pass conditions (final)

- [ ] `packages/cost-telemetry/{src/index.ts, wrangler.toml, package.json}` exists on `main`
- [ ] `packages/locke-harvest/src/index.ts` contains `checkTelemetry` + defer guard
- [ ] `.github/workflows/deploy.yml` has `deploy-cost-telemetry` job with step-level `$GITHUB_OUTPUT` guard
- [ ] `hunts/the-tightening/clue-1/COMPLETE.md` committed BEFORE the /health probe (verifiable by commit timestamp ordering)
- [ ] `https://cost-telemetry.tveg-baking.workers.dev/health` returns 200 with expected schema
- [ ] `https://cost-telemetry.tveg-baking.workers.dev/dashboard` returns 200 with expected schema (any traffic_light value acceptable)
- [ ] CI deploy-cost-telemetry conclusion = success
- [ ] Long John 🏴‍☠️ ping fired

---

## On error

If any task fails irrecoverably after best-effort retry:
1. Write `hunts/the-tightening/clue-1/PARTIAL.md` with: which task failed, what was attempted, what state the repo is in, any debugging signal collected
2. Long John pings will surface the exit code regardless
3. Tyler resumes manually from PARTIAL.md state

Do NOT author `COMPLETE.md` if any pass condition fails. Partial-complete antipattern check.
