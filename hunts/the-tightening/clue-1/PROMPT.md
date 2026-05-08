[CODE-AUTONOMOUS][DETERMINISTIC][SUBSTANTIAL]

# The Tightening — Clue 1 (Variant B): Cost-Telemetry Worker via Batched Writes

**Hunt:** the-tightening
**Clue:** 1 — Variant B (batched-writes recovery)
**Previous fire:** ⚠️ FALSE COMPLETE 2026-05-08T14:08-14:12Z (single ~150-line synthesis call hit ~120s NIM upstream timeout). Forensic: `brain/02-knowledge/the-tightening-c1-2026-05-08-synthesis-budget-data.md` (SuperClaude repo). Preserved alongside as `PROMPT-v1-failed-2026-05-08.md`.
**Source of truth:** `hunts/the-tightening/CHARTER.md` and `MAP.md` (read first).
**Reference patterns:** `packages/locke-harvest/`, `packages/council/` (Worker shape, Bearer auth, deploy.yml step-level `$GITHUB_OUTPUT` guard).
**Bible:** 1.2 §3 row 2 batched-writes empirical test. §A7 audit-wrap + §A8 reasoning-weight high + §A9 SUBSTANTIAL.
**Author COMPLETE.md at Task 11, BEFORE /health probes** (partial-complete antipattern mitigation).
**Phantom rule:** `rtk` is NOT installed on InfiniVeg. Use plain commands (Bible 1.2 §11).

---

## Goal

After this clue:
- `https://cost-telemetry.tveg-baking.workers.dev/health` → 200 with `{ok:true, persona:"cost-telemetry", schema:"telemetry-1.0", model:null}`
- `https://cost-telemetry.tveg-baking.workers.dev/dashboard` → 200 JSON `{traffic_light, neurons_used_estimate, neurons_remaining_estimate, neurons_cap, locke_fires_today, council_fires_today, schemer_fires_today, reviewer_fires_today, last_updated, basis}`
- `packages/locke-harvest/src/index.ts` has a defer guard before the first `env.AI.run()` in `runHunt()`. If telemetry says `traffic_light` is `red` or `depleted`, return `{kept:0, discarded:0, status:"deferred", reason:"neurons_low", session_id}` with a session report. Wrap dashboard fetch in try/catch — telemetry failure must NOT block Locke.
- CI green on `main`.

## Calibration constants

NEURON_CAP=10000; LOCKE_NEURONS_PER_FIRE=3000; COUNCIL_NEURONS_PER_FIRE=900; SCHEMER_NEURONS_PER_FIRE=500; REVIEWER_NEURONS_PER_FIRE=500.

Traffic light: green <50% used, yellow 50-85%, red 85-100%, depleted ≥100%.

---

## Budget discipline (Bible 1.2 §3 row 2 — THE STRESS-TEST CONSTRAINT)

**Hard rules:**
1. Per Write call: ≤80 lines, ≤90s wall-clock.
2. Per Edit/MultiEdit call: ≤60 lines new content per swap.
3. NO single tool call may write ≥100 lines from synthesis.
4. If you find yourself wanting to Write a >80-line file, split into (a) skeleton Write + (b) one or more Edits.
5. If any synthesis call exceeds 90s without returning, abort with `tool_hunt_complete(status="stuck", reason="synthesis_budget_exceeded_taskN")`. Do NOT retry the same large call.

These constraints populate §3 row 2's "batched writes" open column. Record per-call wall-clock + new-line counts in COMPLETE.md (Task 11).

---

## Tasks (execute in order; do NOT skip Task 11)

### Task 1 — Read references

```bash
cat hunts/the-tightening/CHARTER.md ; echo "AUDIT_DONE"
cat hunts/the-tightening/MAP.md ; echo "AUDIT_DONE"
cat packages/locke-harvest/src/index.ts | head -200 ; echo "AUDIT_DONE"
cat packages/locke-harvest/wrangler.toml ; echo "AUDIT_DONE"
cat packages/council/src/index.ts | head -100 ; echo "AUDIT_DONE"
cat packages/council/wrangler.toml ; echo "AUDIT_DONE"
cat .github/workflows/deploy.yml ; echo "AUDIT_DONE"
```

Internalize: TypeScript, `compatibility_date 2026-05-01`, `nodejs_compat`, account_id `cc231edbff18405233612d7afb657f1f`, brain-write at `https://api.thechefos.app/api/brain/push` with header `x-webhook-secret`.

### Task 2 — Stage directory

```bash
mkdir -p packages/cost-telemetry/src
```

### Task 3 — Write `packages/cost-telemetry/wrangler.toml` (single Write, ~30 lines)

Mirror Council's wrangler.toml. Fields:
- `name = "cost-telemetry"`, `main = "src/index.ts"`, `compatibility_date = "2026-05-01"`, `compatibility_flags = ["nodejs_compat"]`
- `account_id = "cc231edbff18405233612d7afb657f1f"`
- `[vars]`: `PERSONA="cost-telemetry"`, `TELEMETRY_SCHEMA_VERSION="telemetry-1.0"`, `NEURON_CAP="10000"`, `LOCKE_NEURONS_PER_FIRE="3000"`, `COUNCIL_NEURONS_PER_FIRE="900"`, `SCHEMER_NEURONS_PER_FIRE="500"`, `REVIEWER_NEURONS_PER_FIRE="500"`, `BRAIN_RAW_BASE="https://raw.githubusercontent.com/AetherCreator/SuperClaude/main"`, `BRAIN_GH_API_BASE="https://api.github.com/repos/AetherCreator/SuperClaude/contents"`, `BRAIN_WRITE_URL="https://api.thechefos.app/api/brain/push"`
- `[[kv_namespaces]]`: `binding = "KV"`, `id = "REPLACE_ME"` (Task 10 fills this in)
- `[triggers]`: `crons = ["0 * * * *"]`
- **NO `[ai]` binding** — this Worker burns zero neurons.

### Task 4 — Write `packages/cost-telemetry/package.json` (single Write, ~15 lines)

Mirror Council's: `{"name":"cost-telemetry","version":"0.1.0","private":true,"scripts":{"deploy":"wrangler deploy"},"devDependencies":{"wrangler":"^3","typescript":"^5","@cloudflare/workers-types":"^4"}}`

### Task 5 — Write `src/index.ts` skeleton (single Write, ≤60 lines)

ONLY: imports, Env interface, type aliases, stubs for `fetch` + `scheduled` exports. The `fetch` handler switches on `url.pathname` with `/health` fully implemented (returns persona/schema/model:null JSON), other paths returning 501. The `scheduled` export is empty async. NO logic for /dashboard, /run-manual, or recompute yet. Add stubs:

```typescript
async function loadRollup(_env: Env): Promise<Rollup> { throw new Error("not yet implemented"); }
async function recomputeRollup(_env: Env): Promise<Rollup> { throw new Error("not yet implemented"); }
function trafficLight(used: number, cap: number): "green"|"yellow"|"red"|"depleted" {
  if (used >= cap) return "depleted";
  if (used >= 0.85*cap) return "red";
  if (used >= 0.5*cap) return "yellow";
  return "green";
}
```

Stay under 60 lines total.

### Task 6 — Edit `src/index.ts`: implement `loadRollup` + add `/dashboard` (single Edit/MultiEdit, ≤60 lines new)

- Replace `loadRollup` body: read KV key `rollup:YYYY-MM-DD` (today UTC). If present and `last_updated` within 10 minutes, return cached. Otherwise call `recomputeRollup`, write to KV (no expiration; use `last_updated` field), return.
- Inside `fetch`, before the 501 fallback, add the `GET /dashboard` branch: call `loadRollup`, return Response.json with shape per pass conditions.

`recomputeRollup` is still stubbed — Task 7 implements.

### Task 7 — Edit `src/index.ts`: implement `recomputeRollup` + add `/run-manual` + scheduled body (single Edit/MultiEdit, ≤60 lines new)

- Body of `recomputeRollup(env)`: list `brain/05-leads/_sessions/` via GitHub Contents API with `Authorization: Bearer ${env.GITHUB_TOKEN}`. Filter filenames by today's UTC `YYYY-MM-DD` and prefixes `locke-lamora-`, `council-`, `schemer-`, `reviewer-`. Count fires per persona, multiply by per-fire neuron constants (parse `Number(env.LOCKE_NEURONS_PER_FIRE)` etc), compute `neurons_used_estimate`, `neurons_remaining_estimate = NEURON_CAP - used`, `traffic_light` via `trafficLight()`. Return `Rollup` with `last_updated = new Date().toISOString()`, `basis = "session-file-count × calibration-constants"`.
- Inside `fetch`, before the 501 fallback, add `POST /run-manual`: check `?secret=` matches `env.TELEMETRY_RUN_SECRET`; if not, 401. Otherwise `recomputeRollup`, write KV, return same JSON as /dashboard.
- Body of `scheduled`: call `recomputeRollup`, write KV. If current UTC hour is 23, also POST a daily rollup to `BRAIN_WRITE_URL` (path: `brain/02-knowledge/cost-rollup-YYYY-MM-DD.md`, content: brief markdown summary, headers: `Content-Type: application/json`, `x-webhook-secret: ${env.BRAIN_WRITE_SECRET}`).

Wrap KV writes, brain fetches, and brain writes in try/catch. On error, write a diagnostic stub via brain-write Worker to `brain/05-leads/_drafts/cost-telemetry-error-{ISO}.json` (best-effort; do not throw further).

### Task 8 — Edit `packages/locke-harvest/src/index.ts` (Locke defer guard, single Edit/MultiEdit, ≤25 lines new)

Add helper near top (after imports):

```typescript
async function checkTelemetry(): Promise<{traffic_light: string; neurons_remaining_estimate?: number}> {
  try {
    const r = await fetch("https://cost-telemetry.tveg-baking.workers.dev/dashboard", { signal: AbortSignal.timeout(5000) });
    if (!r.ok) return { traffic_light: "unknown" };
    return await r.json();
  } catch {
    return { traffic_light: "unknown" };
  }
}
```

Insert guard at start of `runHunt()` before first `env.AI.run()`:

```typescript
const tel = await checkTelemetry();
if (tel.traffic_light === "red" || tel.traffic_light === "depleted") {
  // write deferred session report (use existing session-report writer)
  // return { kept: 0, discarded: 0, status: "deferred", reason: "neurons_low", session_id };
}
```

Match existing Locke session-report pattern. Try/catch ensures `unknown` status proceeds normally — telemetry failure must NOT block Locke.

### Task 9 — Edit `.github/workflows/deploy.yml` (single Edit, ≤30 lines new)

Add `deploy-cost-telemetry` job mirroring `deploy-council`:
- `runs-on: ubuntu-latest`
- Step `check`: bash echo to `$GITHUB_OUTPUT` (`exists=true|false` based on `packages/cost-telemetry/wrangler.toml` presence)
- Step `setup`: actions/checkout + setup-node@v4 with node 20, gated `if: steps.check.outputs.exists == 'true'`
- Step `deploy`: `cd packages/cost-telemetry && npm install && npx wrangler deploy`, env `CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}`, gated `if: steps.check.outputs.exists == 'true'`

**Step-level `$GITHUB_OUTPUT` guard** — NOT job-level `if: hashFiles()` (broken pattern, banked 2026-05-07).

### Task 10 — Create KV namespace + substitute id

```bash
export CLOUDFLARE_API_TOKEN=$(cat /opt/secrets/cf-api-token)
cd packages/cost-telemetry
npm install
npx wrangler kv namespace create cost-telemetry-rollup 2>&1 | tee /tmp/kv-create.log ; echo "AUDIT_DONE"
KV_ID=$(grep -oE 'id = "[a-f0-9]+"' /tmp/kv-create.log | head -1 | grep -oE '[a-f0-9]{16,}')
echo "KV_ID=$KV_ID"
cd ../..
```

Then Edit `packages/cost-telemetry/wrangler.toml`: replace `id = "REPLACE_ME"` with `id = "$KV_ID"` (substitute literal).

If `wrangler kv namespace create` fails: capture stderr to `hunts/the-tightening/clue-1/kv-create-error.log` and call `tool_hunt_complete(status="stuck", reason="kv_namespace_create_failed")`.

### Task 11 — Author COMPLETE.md (BEFORE /health probes)

Write `hunts/the-tightening/clue-1/COMPLETE.md`:

```markdown
# Clue 1 — COMPLETE (Variant B)

**Status:** ✅
**Variant:** B (batched writes — Bible 1.2 §3 row 2 stress test)
**Substrate evidence (3-axis):**
- Source: packages/cost-telemetry/{src/index.ts, wrangler.toml, package.json} on main; packages/locke-harvest/src/index.ts has checkTelemetry + defer guard; deploy.yml has deploy-cost-telemetry job
- CI: deploy-cost-telemetry conclusion = success on commit {SHA_FINAL}
- Runtime: /health returns 200 with persona=cost-telemetry, schema=telemetry-1.0, model=null

**Commits this clue:**
- {SHA_TELE} packages/cost-telemetry/* (new Worker; built via 3 calls: skeleton Write + 2 Edits)
- {SHA_LOCKE} packages/locke-harvest/src/index.ts (defer guard)
- {SHA_DEPLOY} .github/workflows/deploy.yml

**KV namespace:** id={KV_ID} (cost-telemetry-rollup)

**Synthesis budget telemetry (Bible 1.2 §3 row 2 datapoint):**
- Task 5 (skeleton Write): {SECONDS}s, {LINES} lines
- Task 6 (/dashboard Edit): {SECONDS}s, {LINES} lines new
- Task 7 (/run-manual + scheduled Edit): {SECONDS}s, {LINES} lines new
- Task 8 (Locke patch Edit): {SECONDS}s, {LINES} lines new
- Task 9 (deploy.yml Edit): {SECONDS}s, {LINES} lines new
- Cumulative wall-clock for synthesis tasks: {TOTAL}s

**Traffic light at completion:** {traffic_light}

**Patterns observed:** (Hunter fills in any new Bible 1.2 candidates)

**Next:** C2 PROMPT to be authored Chat-side after this completes.
```

Substitute real values from execution.

### Task 12 — Commit + push

```bash
git add packages/cost-telemetry packages/locke-harvest/src/index.ts .github/workflows/deploy.yml hunts/the-tightening/clue-1/COMPLETE.md
git commit -m "the-tightening C1 (Variant B): cost-telemetry Worker + Locke defer guard via batched writes"
git push origin main
```

### Task 13 — Verify CI green (poll up to 5 min)

```bash
GH_TOKEN=$(cat /opt/secrets/github-token)
for i in $(seq 1 30); do
  STATUS=$(curl -sS -H "Authorization: Bearer $GH_TOKEN" -H "Accept: application/vnd.github.v3+json" "https://api.github.com/repos/AetherCreator/thechefos-workers/actions/runs?branch=main&per_page=1" | jq -r '.workflow_runs[0].conclusion // "pending"')
  echo "poll $i: $STATUS ; AUDIT_DONE"
  if [ "$STATUS" = "success" ]; then break; fi
  if [ "$STATUS" = "failure" ]; then exit 1; fi
  sleep 10
done
```

### Task 14 — Verify /health + /dashboard

```bash
curl -sS -w "\nHTTP_STATUS=%{http_code}\n" https://cost-telemetry.tveg-baking.workers.dev/health ; echo "AUDIT_DONE"
curl -sS -w "\nHTTP_STATUS=%{http_code}\n" https://cost-telemetry.tveg-baking.workers.dev/dashboard ; echo "AUDIT_DONE"
```

`/dashboard` returning `traffic_light: "depleted"` is EXPECTED (current neuron exhaustion) — not a failure.

### Task 15 — Long John ping (automatic)

`claude-exec.sh`'s built-in completion hook fires the 🏴‍☠️ ping on exit 0. Nothing to do here.

---

## Pass conditions (final)

- [ ] `packages/cost-telemetry/{src/index.ts, wrangler.toml, package.json}` exists on `main`
- [ ] `packages/cost-telemetry/src/index.ts` was built via 3 separate tool calls (skeleton Write + 2 Edits) — verifiable in jsonl trace
- [ ] `packages/locke-harvest/src/index.ts` contains `checkTelemetry` + defer guard
- [ ] `.github/workflows/deploy.yml` has `deploy-cost-telemetry` job with step-level `$GITHUB_OUTPUT` guard
- [ ] `hunts/the-tightening/clue-1/COMPLETE.md` committed BEFORE `/health` probe (verifiable via commit timestamp ordering)
- [ ] `https://cost-telemetry.tveg-baking.workers.dev/health` returns 200 with expected schema
- [ ] `https://cost-telemetry.tveg-baking.workers.dev/dashboard` returns 200 (any traffic_light value)
- [ ] CI deploy-cost-telemetry conclusion = success
- [ ] Long John 🏴‍☠️ ping fired
- [ ] Per-call synthesis telemetry recorded in COMPLETE.md (the §3 row 2 datapoint)

---

## STUCK escape hatches (Bible 1.2 §8)

If any fire:
- `wrangler kv namespace create` fails → `tool_hunt_complete(status="stuck", reason="kv_namespace_create_failed")`
- Any single Write/Edit call exceeds 90s wall-clock → `tool_hunt_complete(status="stuck", reason="synthesis_budget_exceeded_taskN")`
- `git push` fails → `tool_hunt_complete(status="stuck", reason="push_failed")`
- CI conclusion = `failure` → `tool_hunt_complete(status="stuck", reason="ci_failed")`
- "command not found" on `rtk` or `wrangler` → tool not installed; STUCK with reason. Do NOT explore the environment.

## On partial-complete

If any pass condition fails after best-effort retry, write `hunts/the-tightening/clue-1/PARTIAL.md` documenting the failure mode. Do NOT author `COMPLETE.md` if any pass condition fails (partial-complete antipattern).
