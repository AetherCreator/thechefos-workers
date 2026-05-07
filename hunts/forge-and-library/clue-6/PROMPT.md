[SUBSTANTIAL][DETERMINISTIC]

# C6 — Council Worker scaffold (cp pattern)

You are Hunter. Your task: ship `packages/council/` Cloudflare Worker by copying pre-staged files from `hunts/forge-and-library/clue-6/staged/` into `packages/council/`, committing, pushing, verifying CI, and confirming the Worker `/health` endpoint responds 200.

This is the same staged-source-cp pattern that worked first-try on C3 (after the streaming-failure recovery). Files are sealed at known SHAs in staged/. Your job is byte-equality cp + commit + verify.

The deploy.yml at the repo root already has a `deploy-council` job with a `hashFiles` guard. The job will activate as soon as your push lands `packages/council/wrangler.toml` on origin/main. No deploy.yml work needed from you.

---

## Substrate

- Repo: `AetherCreator/thechefos-workers` (this is the cloned repo at $WORKSPACE/repo)
- Source files (in repo, on origin/main):
  - `hunts/forge-and-library/clue-6/staged/wrangler.toml`
  - `hunts/forge-and-library/clue-6/staged/package.json`
  - `hunts/forge-and-library/clue-6/staged/src/index.ts`
- Destination paths (you create):
  - `packages/council/wrangler.toml`
  - `packages/council/package.json`
  - `packages/council/src/index.ts`
- Tools: native Bash + Read + Write + git (you have full Claude Code 2.x surface)

---

## Tasks (strict order, do NOT skip ahead)

### Task 1 — Sanity-check the workspace

```bash
cd $WORKSPACE/repo
test -f hunts/forge-and-library/clue-6/staged/wrangler.toml || { echo "STAGED_MISSING wrangler.toml"; exit 71; }
test -f hunts/forge-and-library/clue-6/staged/package.json  || { echo "STAGED_MISSING package.json";  exit 71; }
test -f hunts/forge-and-library/clue-6/staged/src/index.ts  || { echo "STAGED_MISSING index.ts";      exit 71; }
echo "STAGED_PRESENT ok"
```

If any STAGED_MISSING line prints, stop and report — do not retry, do not improvise.

### Task 2 — Create destination directories + cp files

```bash
mkdir -p packages/council/src
cp hunts/forge-and-library/clue-6/staged/wrangler.toml packages/council/wrangler.toml
cp hunts/forge-and-library/clue-6/staged/package.json  packages/council/package.json
cp hunts/forge-and-library/clue-6/staged/src/index.ts  packages/council/src/index.ts
```

### Task 3 — Verify byte-equality (cmp must succeed on all 3)

```bash
cmp hunts/forge-and-library/clue-6/staged/wrangler.toml packages/council/wrangler.toml || { echo "CMP_FAIL wrangler.toml"; exit 71; }
cmp hunts/forge-and-library/clue-6/staged/package.json  packages/council/package.json  || { echo "CMP_FAIL package.json";  exit 71; }
cmp hunts/forge-and-library/clue-6/staged/src/index.ts  packages/council/src/index.ts  || { echo "CMP_FAIL index.ts";      exit 71; }
echo "CMP_OK all 3 files match staged byte-for-byte"
```

If any CMP_FAIL prints, stop and report — do not retry.

### Task 4 — Commit + push

```bash
git add packages/council/
git status --short
git commit -m "forge-and-library C6: ship packages/council/ from clue-6 staged files (Hunter cp pattern)"
git push origin main
```

Capture the resulting commit SHA via `git rev-parse HEAD` — you'll need it for COMPLETE.md.

### Task 5 — Wait for CI to start, then poll for completion

```bash
COMMIT_SHA=$(git rev-parse HEAD)
echo "Waiting for CI run on $COMMIT_SHA..."
sleep 20
for i in 1 2 3 4 5 6 7 8 9 10 11 12; do
  RESP=$(curl -s -H "Authorization: Bearer $GH_TOKEN" \
    "https://api.github.com/repos/AetherCreator/thechefos-workers/actions/runs?head_sha=$COMMIT_SHA&per_page=1")
  STATUS=$(echo "$RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); r=(d.get('workflow_runs') or [None])[0]; print((r or {}).get('status','none'), (r or {}).get('conclusion','none'))" 2>/dev/null || echo "none none")
  echo "[poll $i] $STATUS"
  if echo "$STATUS" | grep -q "^completed"; then break; fi
  sleep 15
done
```

### Task 6 — Verify deploy-council job concluded "success"

```bash
RUN_ID=$(curl -s -H "Authorization: Bearer $GH_TOKEN" \
  "https://api.github.com/repos/AetherCreator/thechefos-workers/actions/runs?head_sha=$COMMIT_SHA&per_page=1" \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['workflow_runs'][0]['id'])")
COUNCIL_OUTCOME=$(curl -s -H "Authorization: Bearer $GH_TOKEN" \
  "https://api.github.com/repos/AetherCreator/thechefos-workers/actions/runs/$RUN_ID/jobs" \
  | python3 -c "import sys,json; d=json.load(sys.stdin); m=[j for j in d['jobs'] if 'Council' in j['name']]; print((m[0]['conclusion']) if m else 'job_not_found')")
echo "deploy-council conclusion: $COUNCIL_OUTCOME"
test "$COUNCIL_OUTCOME" = "success" || { echo "CI_FAIL deploy-council=$COUNCIL_OUTCOME"; exit 71; }
echo "CI_OK deploy-council job succeeded"
```

If `$COUNCIL_OUTCOME` is anything other than `success`, fetch the failed log tail and include it in your final report:

```bash
COUNCIL_JOB_ID=$(curl -s -H "Authorization: Bearer $GH_TOKEN" \
  "https://api.github.com/repos/AetherCreator/thechefos-workers/actions/runs/$RUN_ID/jobs" \
  | python3 -c "import sys,json; d=json.load(sys.stdin); m=[j for j in d['jobs'] if 'Council' in j['name']]; print(m[0]['id'] if m else '')")
curl -s -L -H "Authorization: Bearer $GH_TOKEN" \
  "https://api.github.com/repos/AetherCreator/thechefos-workers/actions/jobs/$COUNCIL_JOB_ID/logs" 2>&1 | tail -60
```

Stop at this point if CI failed — do not proceed to /health probe.

### Task 7 — Verify Worker /health (Rule 7 pass condition)

```bash
HEALTH=$(curl -s -m 10 "https://council.tveg-baking.workers.dev/health")
echo "Worker /health response: $HEALTH"
echo "$HEALTH" | grep -q '"persona":"council"' || { echo "HEALTH_FAIL no persona"; exit 71; }
echo "$HEALTH" | grep -q '"model":"nvidia/nemotron-3-super-120b-a12b"' || { echo "HEALTH_FAIL no model"; exit 71; }
echo "$HEALTH" | grep -q '"threshold":95' || { echo "HEALTH_FAIL no threshold"; exit 71; }
echo "HEALTH_OK Worker live and reading vars correctly"
```

### Task 8 — Author COMPLETE.md and push

Write the file at `hunts/forge-and-library/clue-6/COMPLETE.md` using the template below. Substitute `{COMMIT_SHA}` with the value from Task 4 and `{HEALTH_RESPONSE}` with the actual response body from Task 7.

```markdown
# C6 COMPLETE — Council Worker scaffold (real-deploy)

**Date:** $(date -u +%Y-%m-%dT%H:%MZ)
**Substrate:** `[SUBSTANTIAL][DETERMINISTIC]` — Hunter via claude-exec.sh, staged-source cp pattern (mirrors C3 v2)
**Hunt:** forge-and-library
**Status:** **real-deploy** — Worker live on origin/main, /health responds with NIM model + 95% threshold; Council deliberation requires 4 GHA secrets (Tyler-side followup)

---

## What landed

Worker source cp'd from `hunts/forge-and-library/clue-6/staged/` to `packages/council/`. Three files, byte-equality verified via `cmp` before commit:

- `packages/council/wrangler.toml` (vars from COUNCIL-SCHEMA §filters + thresholds)
- `packages/council/package.json` (wrangler 3.x devDep, matches locke-harvest pattern)
- `packages/council/src/index.ts` (3 judges parallel via NIM, geo-mean threshold, verdict sidecars)

Pushed at commit `{COMMIT_SHA}`. CI run completed; `deploy-council` job concluded `success`. Worker live at `https://council.tveg-baking.workers.dev/health`:

```
{HEALTH_RESPONSE}
```

The deploy.yml `deploy-council` job uses `hashFiles('packages/council/wrangler.toml') != ''` as its `if:` guard; it activated on this push because Hunter's cp made the file appear.

---

## What's blocked (real deliberation = Tyler-side followup)

Worker is deployed but cannot deliberate until 4 GHA secrets land at `AetherCreator/thechefos-workers` repo settings → Secrets → Actions:

- [ ] `COUNCIL_NIM_API_KEY` — copy from `/opt/secrets/nvidia-api-key` (same value as `LOCKE_NIM_API_KEY`)
- [ ] `COUNCIL_BRAIN_WRITE_SECRET` = `SuperDuperClaude`
- [ ] `COUNCIL_RUN_SECRET` = `openssl rand -hex 16`, also save to `/opt/secrets/council-run-key`
- [ ] (optional) `COUNCIL_TELEGRAM_TOKEN` — for verdict notifications; skip if no @TheFoundryBot yet

After secrets land, the next CI run sets them on the Worker via the fails-soft secret-set step, and Tyler can fire deliberations:

```bash
# Smoke against the c4-smoke-stub from the SuperClaude repo (filtered out by default
# because confidence=low + pattern_type=single_signal — use /run-manual which bypasses filters).
curl -X POST "https://council.tveg-baking.workers.dev/run-manual?lead_id=c4-smoke-stub-2026-05-07&lead_path=brain/05-leads/_drafts/c4-smoke-stub-2026-05-07.json&secret=$(cat /opt/secrets/council-run-key)"
```

Expected: a JSON verdict response with `judges: [...]`, `geometric_mean: <number>`, `verdict: "killed"|"approved"|"abstained"|"unprocessable"`, and a sidecar at `brain/05-leads/_drafts/c4-smoke-stub-2026-05-07.verdict.json`. The stub will almost certainly be `killed` (it's a deliberate stub with no real signal); that's the correct verdict and proves the pipeline.

After real Locke harvests fire (post-SearXNG), Council can run on real leads via `/run/{lead_id}` (filters apply) or via the sweep cron (when re-enabled in wrangler.toml).

---

## Patterns banked (worth harvesting before next session)

1. **`hashFiles` deploy-job guard** — adding a deploy job for a future package and pre-merging to main is safe if the job is gated on file existence. CI shows the job as "skipped" until the package files land. Better than waiting to add the job until packages exist (avoids one CI failure cycle).
2. **Persona-prefixed shared-value GHA secrets** — `LOCKE_NIM_API_KEY` and `COUNCIL_NIM_API_KEY` carry identical values but are scoped per-Worker. Trades two extra secret entries against the cleaner mental model of "each Worker's secrets are its own."

---

## Source SHAs

- staged wrangler.toml: `9f86fe55559cc4fe1fdef7b11d1b4e434f3be5a5`
- staged package.json: `763ac4f4274b2906985a7527d59aaab4d50f9c6e`
- staged src/index.ts: `3d91eea21614914d3adce4fb12dd6511c31db089`
- deploy.yml (with deploy-council job): `7e66998b0b7517c9e760bf3c1ba228c515b74a76`
- COUNCIL-SCHEMA.md: `542c5ff4e9ceb1889ddd4721543dd7e8c6e59684` (v1.0)
- This C6 commit: `{COMMIT_SHA}`
- Worker hostname: `https://council.tveg-baking.workers.dev`

`HUNT_COMPLETE: forge-and-library/clue-6 worker-live; deliberation blocked on 4 GHA secrets`
```

Then commit and push:

```bash
git add hunts/forge-and-library/clue-6/COMPLETE.md
git commit -m "forge-and-library C6 COMPLETE — Worker live; deliberation pending GHA secrets"
git push origin main
```

### Task 9 — Final marker

After the COMPLETE.md push succeeds, output exactly one line:

```
HUNT_COMPLETE: forge-and-library/clue-6 <list-both-commit-SHAs-here>
```

Then stop. Do not continue exploring, do not initiate any further actions. Long John's verify-push pattern in claude-exec.sh will check that 2 new commits exist on origin/main since the start of your run; if you've followed the strict order above, it will see ≥2 (the cp commit + the COMPLETE.md commit) and report ✅ done.

---

## Pass conditions (recap, all must be true)

1. `cmp` succeeded on all 3 files (Task 3)
2. `git push` succeeded for the cp commit (Task 4)
3. CI run on that commit completed (Task 5)
4. `deploy-council` job conclusion = `success` (Task 6)
5. `curl /health` returns HTTP 200 with `persona:council`, `model:nvidia/nemotron-3-super-120b-a12b`, and `threshold:95` (Task 7)
6. COMPLETE.md committed + pushed (Task 8)

If any of 1-6 fails, stop at that step and emit a clear failure marker line. Do not proceed past a failure. The 3-strike rule applies — do not retry the same failed step more than twice.

## A7 audit-wrap reminder

The polling loop in Task 5 grep'ing for `^completed` is an AUDIT step: grep with no match exits 1, but that's a normal "still running" signal, not a failure. The `for i in 1..12; do ...; if grep ...; then break; fi; done` structure handles this naturally — the loop continues until grep finds the completed status or the iteration count expires. Treat this exactly the way C1 PROMPT taught: AUDIT exit codes are not synonymous with task failure.

The `cmp`, `test -f`, `grep -q` calls in Tasks 1, 3, and 7 are STRICT — non-zero exit is a real failure that must halt the task chain.
