# 🔧 The Tightening — MAP

**Hunt:** the-tightening
**Bible:** 1.1 + §A7 + §A8 + §A9
**Repo:** `AetherCreator/thechefos-workers`
**CHARTER:** `hunts/the-tightening/CHARTER.md`

---

## Pre-flight gating

Before C1 fires, verify:

1. ✅ `claude-exec.sh` substrate live (validated 2026-05-08T03:30Z A2)
2. ✅ `auto-exec.sh` smart dispatcher reads §A9 first-line tag
3. ✅ `/opt/secrets/hunterbot-token` present for Long John completion ping
4. ✅ free-cc-proxy → NIM Nemotron-120B path is independent of Workers AI 4006 cap
5. ✅ thechefos-workers CI green on last commit
6. ✅ Locke + Council Workers healthy (verified 2026-05-08T03:46Z stress test)

C1 is fireable now.

---

## Clue DAG — under §A7 + §A8 + §A9

| # | Clue | Surface | Class | §A9 Exec | Description | Depends on |
|---|---|---|---|---|---|---|
| 1 | Cost-telemetry Worker | `[CODE-AUTONOMOUS]` | `[DETERMINISTIC]` | `[SUBSTANTIAL]` | Build `packages/cost-telemetry/` Worker — no LLM, just KV + brain reads + scheduled rollup. Exposes `/health`, `/dashboard`, `/run-manual`. Patches Locke `src/index.ts` to add neuron-aware defer guard before any Kimi call. Wires into `deploy.yml`. | none |
| 2 | State + source drift fix | `[CODE-AUTONOMOUS]` | `[DETERMINISTIC]` | `[SUBSTANTIAL]` | Update ACTIVE-STATE.md to reflect Foundry deployed + Council=Kimi K2.6 (drop NIM Nemotron-120B claim). Rename `callNim` → `callLLM` across Locke + Council `src/index.ts` (and any error-file naming patterns: `nim-error-*` → `llm-error-*`). Single coherent commit set. | C1 |
| 3 | Council force_deliberate override | `[CODE-AUTONOMOUS]` | `[DETERMINISTIC]` | `[SUBSTANTIAL]` | Add `?force_deliberate=true` flag to Council `/run-manual` allowing single_signal leads through the pre-filter for testing. Dry-run validate (HTTP path executes, no LLM call). Document threshold policy in `brain/02-knowledge/council-single-signal-policy.md`. Real-fire deferred to Tyler post-neuron-reset. | C1 |

---

## Pass conditions per clue

**C1:**
- `https://cost-telemetry.tveg-baking.workers.dev/health` → `{ok:true, persona:"cost-telemetry", schema:"telemetry-1.0"}`
- `https://cost-telemetry.tveg-baking.workers.dev/dashboard` → JSON `{neurons_used_today, neurons_remaining, traffic_light, locke_session_count, council_session_count, last_updated}`
- `packages/locke-harvest/src/index.ts` contains a defer guard: before any `env.AI.run()` call, fetch `/dashboard`; if `traffic_light === "red"` or `neurons_remaining < 1000`, return `{status: "deferred", reason: "neurons_low"}`
- CI green on `main` after final commit
- `COMPLETE.md` authored at **Task 7** (before /health probe — partial-complete antipattern mitigation)

**C2:** authored after C1 lands.
**C3:** authored after C2 lands.

---

## Substrate discipline

- All shell ops STRICT-or-AUDIT-wrapped per §A7
- §A8 reasoning weight: high (production drift + cost ceiling + first real telegram-loop substantial fire post-A2)
- §A9 executor classification: SUBSTANTIAL on all three (synthesis required: new Worker for C1, multi-file rename for C2, behavioral change for C3)
- Staged-source cp pattern (per forge-and-library C6/C7)
- Step-level `$GITHUB_OUTPUT` guard in deploy.yml (NOT job-level `if: hashFiles()`)
- Diagnostic-write-to-brain on errors

---

## Long John completion

Each clue closes with 🏴‍☠️ ping to @LongClaudeSilver_bot via claude-exec.sh's built-in completion hook (productionized 2026-05-07T02:10Z, validated end-to-end 2026-05-08T03:30Z A2).
