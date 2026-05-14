[CODE-AUTONOMOUS][DETERMINISTIC][SUBSTANTIAL]

# Hunt: the-tightening — Clue 2 — Source drift fix (callNim → callLLM)

**Repo:** AetherCreator/thechefos-workers
**Branch:** main
**Author:** Chat-Opus 2026-05-14
**Bible:** 1.2.4 §A7 audit-wrap + §A8 reasoning-weight + §A9 SUBSTANTIAL classification
**MAP:** `hunts/the-tightening/MAP.md`

---

## Context

C1 shipped cost-telemetry Worker (live at `https://cost-telemetry.tveg-baking.workers.dev/health`). Substrate has a source-state drift: code paths in Locke + Council still reference `callNim` and write `nim-error-*.json` diagnostic files even though both Workers now use Workers AI bindings (Locke = Llama-3.3-70b-fp8-fast, Council = Kimi K2.6) — no NIM HTTP calls anywhere in active paths. Bible 1.2.4 §11 phantom-rule trap documents this drift.

**Goal:** clean rename of `callNim` → `callLLM` across Locke + Council source. Rename diagnostic filename pattern `nim-error-*` → `llm-error-*` in any caller. Single coherent commit. CI green. Live `/health` probes confirm no behavior regression.

**Scope discipline:** This clue does NOT touch `wrangler.toml` env var bindings (`NIM_API_KEY`, `NIM_MODEL` — those are wrangler-side concerns, separate clue if needed). This clue does NOT touch ACTIVE-STATE.md (SuperClaude repo — Chat-side handles, scope drift refuse). Pure source-side cleanup in thechefos-workers.

---

## Task list (deterministic order)

1. **Inventory `callNim`**: `git -C /tmp/wkspace-thechefos-workers grep -n 'callNim' -- packages/locke-harvest packages/council | tee /tmp/tightening-c2-callnim-before.txt`. Capture file count + line count.

2. **Inventory `nim-error`**: `git -C /tmp/wkspace-thechefos-workers grep -n 'nim-error' -- packages/locke-harvest packages/council | tee /tmp/tightening-c2-nimerror-before.txt`. Same.

3. **Rename `callNim` → `callLLM`** in `packages/locke-harvest/src/index.ts` and `packages/council/src/index.ts`:
   - Function declaration (`async function callNim` → `async function callLLM`)
   - All call sites
   - Any TypeScript type aliases like `NimResponse` → `LLMResponse` IF present
   - Comments inside the function body that say "NIM" referring to the function (replace with "LLM"); leave comments that describe historical NIM-HTTP origin alone if they document substrate history.
   - DO NOT touch `NIM_API_KEY`, `NIM_MODEL`, `NIM_URL` env var references — those bind to wrangler.toml and are out of scope.

4. **Rename diagnostic filename pattern** `nim-error-*.json` → `llm-error-*.json`:
   - Locke's catch-block diagnostic-write-to-brain pattern (writes to `brain/05-leads/_drafts/`)
   - Any other caller surfaced by Task 2 inventory.
   - DO NOT rename existing files in `_drafts/` (out of scope — historical artifacts).

5. **Verify no missed call sites**:
   - `git -C /tmp/wkspace-thechefos-workers grep -c 'callNim' -- packages/locke-harvest packages/council` should return 0 (no matches anywhere).
   - `git -C /tmp/wkspace-thechefos-workers grep -c 'nim-error' -- packages/locke-harvest packages/council` should return 0.

6. **Single coherent commit**:
   - Title: `the-tightening C2: callNim → callLLM + nim-error → llm-error (drift fix)`
   - Body: file list + line delta + grep-zero confirmation.
   - Push to `main`.

7. **Author COMPLETE.md** at `hunts/the-tightening/clue-2/COMPLETE.md` BEFORE Task 8 (partial-complete antipattern mitigation per MAP). Include: commit SHA, file list, line-count delta, grep-verified-zero confirmation, both `/health` probe outputs (run Task 9 inline before COMPLETE.md write).

8. **Probe deploys**: `gh api /repos/AetherCreator/thechefos-workers/actions/runs?per_page=5` poll loop (every 15s, max 5 min) until BOTH `deploy-locke-harvest` and `deploy-council` runs for this commit finish. Record conclusions. If either fails: capture log tail to COMPLETE.md and exit non-zero.

9. **Final health probes** (must pass for ✅):
   - `curl -sS https://locke-harvest.tveg-baking.workers.dev/health | jq` → `ok: true`, `persona: "lookout"` (renamed externally per OPS-LOCKE-LOOKOUT-RENAME, intentional)
   - `curl -sS https://council.tveg-baking.workers.dev/health | jq` → `ok: true`, `persona: "council"`

10. **Invoke `hunt_complete.py`** with the work-commit SHA in `--evidence`. Bible 1.2.4 §6.1 truth-telling trailer fires via claude-exec.sh's trap finalize.

---

## Pass conditions (Rule-4 bash-verifiable)

```bash
# All four must return success
[ "$(git -C /tmp/wkspace-thechefos-workers grep -c 'callNim' -- packages/locke-harvest packages/council 2>/dev/null | wc -l)" = "0" ] && echo PASS-1
[ "$(git -C /tmp/wkspace-thechefos-workers grep -c 'nim-error' -- packages/locke-harvest packages/council 2>/dev/null | wc -l)" = "0" ] && echo PASS-2
[ "$(curl -sS https://locke-harvest.tveg-baking.workers.dev/health | jq -r .ok)" = "true" ] && echo PASS-3
[ "$(curl -sS https://council.tveg-baking.workers.dev/health | jq -r .ok)" = "true" ] && echo PASS-4
# Plus: hunts/the-tightening/clue-2/COMPLETE.md present on origin/main
# Plus: last 2 GHA runs for this commit both conclusion=success
```

---

## Anti-patterns to refuse

- DO NOT touch `wrangler.toml` env vars (`NIM_*` bindings — out of scope).
- DO NOT touch ACTIVE-STATE.md (different repo — out of scope).
- DO NOT refactor logic. Pure mechanical rename + filename pattern fix.
- DO NOT scaffold tests or fixtures. Source edit only.
- DO NOT rename files in `brain/05-leads/_drafts/` (historical artifacts).
- DO NOT bump version numbers or change wrangler routes.
- If rename has been partially done (callLLM already exists alongside callNim): finish the rename idempotently. Do not roll back.

---

## §3 row 2 data note

This clue is **mechanical-rename SUBSTANTIAL**, NOT new-synthesis SUBSTANTIAL. Captures rename-throughput substrate behavior post free-cc-proxy `HTTP_READ_TIMEOUT=600` + trap finalize fix. A dedicated synthesis-ceiling re-measurement (new-code single-call) for clean §3 row 2 data remains queued — flag in COMPLETE.md if expansion is warranted.

State-variant expectations:
- ✅ `done exit=0` — clean pass (expected, given mechanical scope + validated substrate).
- ⚠️ FALSE COMPLETE — work shipped but COMPLETE.md missing → strand-guard fires automatically.
- 💀 OUTER-TIMEOUT — would indicate synthesis past 720s (unexpected for a rename; if it happens, that's the §3 row 2 datum we need).
- 💀 BUDGET-EXHAUSTED — TOKEN_BUDGET hit (not expected for this scope).

---

## Bible references

- §A7 audit-wrap: shell ops STRICT-wrapped (`set -euo pipefail` at top of any embedded bash). Errors visible.
- §A8 reasoning-weight: medium — pure rename, deterministic, no judgment calls. Don't burn synthesis budget on "should I rename X" deliberation; the PROMPT enumerates exact targets.
- §A9 SUBSTANTIAL: multi-file rename across two Workers — claude-exec.sh path is correct (NOT hunter-exec.py).
- §6.1 truth-telling: trap finalize fires Long John completion ping regardless of exit path.

---

> *"Drift caught. Drift cleaned. Source matches substrate."* 🏴‍☠️
