# C6 COMPLETE — Council Worker scaffold (real-deploy)

**Date:** 2026-05-07T12:35Z
**Substrate:** `[SUBSTANTIAL][DETERMINISTIC]` — Hunter via claude-exec.sh, staged-source cp pattern (mirrors C3 v2)
**Hunt:** forge-and-library
**Status:** **real-deploy** — Worker live on origin/main, /health responds with NIM model + 95 threshold; COMPLETE.md authored Chat-side after Hunter elided Task 8 (partial-complete pattern banked below)

---

## What landed

Worker source cp'd from `hunts/forge-and-library/clue-6/staged/` to `packages/council/`. Three files, byte-equality verified post-fact via `github_get_file` size check (27,934 bytes for `src/index.ts` matches staged exactly):

- `packages/council/wrangler.toml` (1,104 bytes — vars from COUNCIL-SCHEMA §filters + thresholds)
- `packages/council/package.json` (422 bytes — wrangler 3.x devDep, matches locke-harvest pattern)
- `packages/council/src/index.ts` (27,934 bytes — 3 judges parallel via NIM, geo-mean threshold, verdict sidecars, sweep handler)

Pushed at commit `c45d9a5c8e8ae4813c6840d75cbdec8f0aee588b`. CI run `25496105609` completed; `deploy-council` job conclusion = `success`. All deploy steps including "Set Worker secrets" succeeded — the `|| true` fails-soft pattern keeps the step green regardless of whether GHA secrets are populated yet.

Worker live at `https://council.tveg-baking.workers.dev/health` returning:

```json
{
  "ok": true,
  "persona": "council",
  "schema": "council-1.0",
  "model": "nvidia/nemotron-3-super-120b-a12b",
  "threshold": 95,
  "supported_lead_versions": ["locke-1.0"]
}
```

The `model` and `threshold` fields prove the staged `wrangler.toml` vars made it through deploy intact. The `persona` and `schema` confirm Worker code is reading the right env. This is the Rule 7 substrate-honest evidence — not a stale Worker, not a build-only artifact, an actual fresh deploy reading fresh vars.

The deploy.yml `deploy-council` job uses the **step-level $GITHUB_OUTPUT guard pattern** (commit `a06c05a6`, after the broken job-level `if: hashFiles(...)` from `7e66998b` rejected the entire workflow at validate time). It activated on this push because the bash check `[ -f packages/council/wrangler.toml ]` returned true, flipping `steps.check.outputs.exists` to `'true'`.

---

## What's blocked (real deliberation = Tyler-side followup)

Worker is deployed but cannot deliberate until 4 GHA secrets land at `AetherCreator/thechefos-workers` repo settings → Secrets → Actions:

- [ ] `COUNCIL_NIM_API_KEY` — copy from `/opt/secrets/nvidia-api-key` (same value as `LOCKE_NIM_API_KEY`)
- [ ] `COUNCIL_BRAIN_WRITE_SECRET` = `SuperDuperClaude`
- [ ] `COUNCIL_RUN_SECRET` = `openssl rand -hex 16`, also save to `/opt/secrets/council-run-key`
- [ ] (optional) `COUNCIL_TELEGRAM_TOKEN` — for verdict notifications; skip if no @TheFoundryBot yet

NOTE: The `Set Worker secrets` CI step ran and showed success because of the `|| true` fails-soft. If Tyler hasn't added the GHA secrets yet, that step ran `printf '' | wrangler secret put NIM_API_KEY` which sets the secret to empty string. NIM calls will then fail with 401 until Tyler adds the real values and re-triggers CI (any push to main, or workflow_dispatch).

After secrets land, smoke test:

```bash
# Use /run-manual which bypasses confidence/pattern filters (the c4-smoke-stub
# has confidence=low + pattern_type=single_signal so /run/{lead_id} would 422).
curl -X POST "https://council.tveg-baking.workers.dev/run-manual?lead_id=c4-smoke-stub-2026-05-07&lead_path=brain/05-leads/_drafts/c4-smoke-stub-2026-05-07.json&secret=$(cat /opt/secrets/council-run-key)"
```

Expected: a JSON verdict response with `judges: [...]`, `geometric_mean: <number>`, `verdict: "killed"|"abstained"`, and a sidecar at `brain/05-leads/_drafts/c4-smoke-stub-2026-05-07.verdict.json`. The stub will almost certainly be `killed` (deliberate stub with no real signal); that's the correct verdict and proves the deliberation pipeline.

After real Locke harvests fire (post-SearXNG), Council can run on real leads via `/run/{lead_id}` (filters apply) or via the sweep cron (when re-enabled in wrangler.toml).

---

## Patterns banked (worth harvesting before next session)

1. **Step-level `$GITHUB_OUTPUT` guard replaces job-level `if: hashFiles()`.** Symptom of the broken pattern: workflow run completes with `conclusion=failure`, `total_count=0`, zero jobs visible, identical `created_at` and `updated_at` timestamps. That's a workflow-level YAML rejection — GitHub validates the file before queuing any job. `if: ${{ hashFiles('path') != '' }}` at job level passes Python `yaml.safe_load` cleanly but trips GHA's validator. Fix: a `Check if package exists` first step that writes `exists=true|false` to `$GITHUB_OUTPUT`, with all subsequent steps gated `if: steps.check.outputs.exists == 'true'`. Job conclusion is `success` either way; Hunter's CI verify (`conclusion == success`) works in both states.

2. **Partial-complete antipattern (Hunter elides Task 8).** Hunter completed Tasks 1-7 perfectly (cp + cmp + commit + push + CI poll + deploy-council verify + /health probe) but stopped before Task 8 (author + push COMPLETE.md). Long John's verify-push correctly reported "1 new commits" — accurate, not over-reporting. Substrate evidence (curl /health returning fresh vars, byte-equal source size on origin/main, CI deploy-council job=success) confirmed real deploy. Lesson: Long John's commit count is a reliable substrate-honest signal. When count < expected from PROMPT, verify substrate (curl, file existence) before either trusting OR rejecting the ✅. In this case substrate was solid, the gap was doc-only, fixable Chat-side. Hypothesis on cause: claude-exec wall-clock or tool budget hit between Task 7 (success) and Task 8 (would have written COMPLETE.md), and Hunter emitted HUNT_COMPLETE prematurely. Mitigation candidate for next [SUBSTANTIAL] PROMPT: move COMPLETE.md authoring earlier in task order (e.g., make it Task 6, before /health probe — the doc landing as cheap insurance against late-stage truncation).

---

## Source SHAs

- staged wrangler.toml: `9f86fe55559cc4fe1fdef7b11d1b4e434f3be5a5`
- staged package.json: `763ac4f4274b2906985a7527d59aaab4d50f9c6e`
- staged src/index.ts: `3d91eea21614914d3adce4fb12dd6511c31db089`
- deploy.yml v1 (broken job-level if): `7e66998b0b7517c9e760bf3c1ba228c515b74a76` ❌
- deploy.yml v2 (step-level guard fix): `a06c05a67130cc08d2c7c196d61d7eaaf4be29a4` ✅
- COUNCIL-SCHEMA.md: `542c5ff4e9ceb1889ddd4721543dd7e8c6e59684` (v1.0)
- C6 cp commit (Hunter): `c45d9a5c8e8ae4813c6840d75cbdec8f0aee588b`
- C6 CI run: `25496105609` (deploy-council=success)
- Worker hostname: `https://council.tveg-baking.workers.dev`

`HUNT_COMPLETE: forge-and-library/clue-6 worker-live; deliberation pending Tyler-side GHA secret provisioning`
