[CODE-AUTONOMOUS][DETERMINISTIC][NARROW]

# The Tightening — Clue 1 (Variant A): Pre-Cached cp+commit

**Hunt:** the-tightening
**Clue:** 1 — Variant A (pre-cached source recovery)
**Previous fires:**
- v1 (synthesis-from-spec): ⚠️ FALSE COMPLETE 2026-05-08T14:08-14:12Z (~150-line synthesis call → ~120s NIM upstream timeout)
- Variant B (batched writes): ⚠️ FALSE COMPLETE 2026-05-08T17:43-17:48Z (per-turn upstream ceiling hit on between-tool reasoning, NOT on a Write call itself; 13 successful tool calls, then 120s timeout reasoning about Task 7)

Forensic: `brain/02-knowledge/the-tightening-c1-2026-05-08-synthesis-budget-data.md` (SuperClaude). Both prior fires preserved at `PROMPT-v1-failed-2026-05-08.md` + `PROMPT-variant-b-failed-2026-05-08.md`.

**Source of truth:** `hunts/the-tightening/CHARTER.md` and `MAP.md` (read first — note: CHARTER cites Bible 1.1; this clue runs under Bible 1.2 — same goal, updated discipline).
**Bible:** 1.2. **§A9 NARROW** — pure mechanical `cp` + `git`, hunter-exec.py shape work. NIM-direct (~3-7s per tool call, no claude-exec ceiling exposure). §A7 audit-wrap on shell ops. §A8 deterministic.
**Author COMPLETE.md at Task 6, BEFORE /health probes** (partial-complete antipattern mitigation).
**Phantom rule:** `rtk` is NOT installed (Bible 1.2 §11). Use plain commands.

---

## Goal (unchanged from prior fires)

After this clue:
- `https://cost-telemetry.tveg-baking.workers.dev/health` → 200 with `{ok:true, persona:"cost-telemetry", schema:"telemetry-1.0", model:null}`
- `https://cost-telemetry.tveg-baking.workers.dev/dashboard` → 200 JSON `{traffic_light, neurons_used_estimate, neurons_remaining_estimate, neurons_cap, locke_fires_today, council_fires_today, schemer_fires_today, reviewer_fires_today, last_updated, basis}`
- `packages/locke-harvest/src/index.ts` has `checkTelemetry` + defer guard before any AI call
- `.github/workflows/deploy.yml` has `deploy-cost-telemetry` job
- CI green on `main`

## Why pre-cached works where batched did not

§3 row 2 catalog data: per-turn upstream timeout (~120s on claude-exec.sh + free-cc-proxy + NIM Nemotron-3-Super-120B) covers reasoning steps too, not just Write/Edit calls themselves. Batching Writes inside a single PROMPT does NOT save you when the model still has to reason about the next batch and that between-tool reasoning step exceeds budget. Variant A side-steps the ceiling entirely by pre-staging complete file content — Hunter's job is `cp` + `git`. No synthesis. No reasoning load. **And by tagging [NARROW], we route through hunter-exec.py instead of claude-exec.sh — different substrate, no per-turn 120s ceiling.**

KV namespace `cost-telemetry-rollup` is **already created** (id `fb64c3edbf8043e38814a9ce543e760c`) — staged wrangler.toml has the real id baked in. Hunter does no infra creation.

## Tasks

### Task 1 — Verify staged content exists

```bash
ls -la hunts/the-tightening/clue-1/staged/cost-telemetry/ ; echo "AUDIT_DONE"
ls -la hunts/the-tightening/clue-1/staged/cost-telemetry/src/ ; echo "AUDIT_DONE"
ls -la hunts/the-tightening/clue-1/staged/locke-harvest/src/ ; echo "AUDIT_DONE"
ls -la hunts/the-tightening/clue-1/staged/.github/workflows/ ; echo "AUDIT_DONE"
```

If any directory is missing → `tool_hunt_complete(status="stuck", reason="staged_content_missing")`.

### Task 2 — cp cost-telemetry/

```bash
mkdir -p packages/cost-telemetry/src
cp hunts/the-tightening/clue-1/staged/cost-telemetry/wrangler.toml packages/cost-telemetry/wrangler.toml
cp hunts/the-tightening/clue-1/staged/cost-telemetry/package.json packages/cost-telemetry/package.json
cp hunts/the-tightening/clue-1/staged/cost-telemetry/src/index.ts packages/cost-telemetry/src/index.ts
ls -la packages/cost-telemetry/ packages/cost-telemetry/src/ ; echo "AUDIT_DONE"
```

### Task 3 — Replace locke-harvest/src/index.ts + deploy.yml

```bash
cp hunts/the-tightening/clue-1/staged/locke-harvest/src/index.ts packages/locke-harvest/src/index.ts
cp hunts/the-tightening/clue-1/staged/.github/workflows/deploy.yml .github/workflows/deploy.yml
diff -q hunts/the-tightening/clue-1/staged/locke-harvest/src/index.ts packages/locke-harvest/src/index.ts ; echo "AUDIT_DONE"
diff -q hunts/the-tightening/clue-1/staged/.github/workflows/deploy.yml .github/workflows/deploy.yml ; echo "AUDIT_DONE"
```

### Task 4 — git status sanity check

```bash
git status ; echo "AUDIT_DONE"
git diff --stat ; echo "AUDIT_DONE"
```

Expected: 3 new files (`packages/cost-telemetry/wrangler.toml`, `package.json`, `src/index.ts`) + 2 modified (`packages/locke-harvest/src/index.ts`, `.github/workflows/deploy.yml`).

### Task 5 — Quick syntax check on TypeScript files

```bash
node --check hunts/the-tightening/clue-1/staged/cost-telemetry/src/index.ts 2>&1 || true ; echo "AUDIT_DONE"
node --check packages/locke-harvest/src/index.ts 2>&1 || true ; echo "AUDIT_DONE"
```

These will likely error on TypeScript syntax — that's expected (node doesn't know TS). The real check is the GHA wrangler deploy at Task 8 below. AUDIT-wrapped to keep moving.

### Task 6 — Author COMPLETE.md (BEFORE /health probes)

Write `hunts/the-tightening/clue-1/COMPLETE.md`:

```markdown
# Clue 1 — COMPLETE (Variant A)

**Status:** ✅
**Variant:** A (pre-cached source — Bible 1.2 §3 row 2 + §4 cache-when-needed)
**Substrate evidence (3-axis):**
- Source: packages/cost-telemetry/{src/index.ts, wrangler.toml, package.json} on main; packages/locke-harvest/src/index.ts has checkTelemetry + defer guard; deploy.yml has deploy-cost-telemetry job
- CI: deploy-cost-telemetry conclusion = success on commit {SHA_FINAL}
- Runtime: /health returns 200 with persona=cost-telemetry, schema=telemetry-1.0, model=null

**Commits this clue:**
- {SHA_FINAL} packages/cost-telemetry/* + locke + deploy.yml (single cp+commit)

**KV namespace:** id=fb64c3edbf8043e38814a9ce543e760c (cost-telemetry-rollup, pre-created via CF API at staging time)

**Synthesis budget:** N/A — Variant A does no synthesis. All content pre-staged at scaffold time. Routes through hunter-exec.py (NIM-direct, ~3-7s per tool call) per [NARROW] tag.

**Traffic light at completion:** {traffic_light from /dashboard probe}

**Patterns observed:** Bible 1.2 §4 cache-when-needed validated. §3 row 2 batched-writes column gets a NEGATIVE datapoint from Variant B (between-tool reasoning hits per-turn ceiling) — pre-cache + [NARROW] routing is the correct mitigation for clues with this synthesis profile.

**Next:** C2 PROMPT to be authored Chat-side after this completes.
```

Substitute real {SHA_FINAL}, {traffic_light}.

### Task 7 — Commit + push

```bash
git add packages/cost-telemetry packages/locke-harvest/src/index.ts .github/workflows/deploy.yml hunts/the-tightening/clue-1/COMPLETE.md
git commit -m "the-tightening C1 (Variant A): cost-telemetry Worker + Locke defer guard via pre-cached cp"
git push origin main
```

### Task 8 — Verify CI green (poll up to 5 min)

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

### Task 9 — Verify /health + /dashboard

```bash
curl -sS -w "\nHTTP_STATUS=%{http_code}\n" https://cost-telemetry.tveg-baking.workers.dev/health ; echo "AUDIT_DONE"
curl -sS -w "\nHTTP_STATUS=%{http_code}\n" https://cost-telemetry.tveg-baking.workers.dev/dashboard ; echo "AUDIT_DONE"
```

Both must return 200. `/dashboard` returning `traffic_light: "depleted"` is EXPECTED (current neuron exhaustion).

### Task 10 — Long John ping (automatic, no action)

---

## Pass conditions

- [ ] `staged/` content present (Task 1)
- [ ] All cp operations succeeded (Tasks 2-3)
- [ ] `diff -q` returned no differences for the modified files
- [ ] `git push` succeeded
- [ ] CI deploy-cost-telemetry conclusion = success (or skipped-because-secrets-not-yet-set is acceptable; Worker fully shipped)
- [ ] `/health` returns 200 with expected schema
- [ ] `/dashboard` returns 200 (any traffic_light)
- [ ] COMPLETE.md committed BEFORE /health probe (timestamp ordering)
- [ ] Long John 🏴‍☠️ ping fired

## STUCK escape hatches

- Staged content missing → `tool_hunt_complete(status="stuck", reason="staged_content_missing")`
- `git push` fails → `tool_hunt_complete(status="stuck", reason="push_failed")`
- CI fails outright (not just skipped) → `tool_hunt_complete(status="stuck", reason="ci_failed")`. Read deploy log; secrets-missing is fails-soft expected, not a real fail.

## On partial-complete

If any pass condition fails after best-effort retry, write `hunts/the-tightening/clue-1/PARTIAL.md`. Do NOT author `COMPLETE.md` if any pass condition fails.
