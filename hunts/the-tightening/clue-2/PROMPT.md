[CODE-AUTONOMOUS][DETERMINISTIC][SUBSTANTIAL]

# Hunt: the-tightening — Clue 2 — Locke `callNim` → `callLLM` (surgical retry)

**Repo:** AetherCreator/thechefos-workers
**Branch:** main
**Author:** Chat-Opus 2026-05-14 (retry-v2 after deliberation collapse 2026-05-14T12:11Z + ~14:00Z)
**Bible:** 1.2.4 §A7 audit-wrap + §A8 reasoning-weight + §A9 SUBSTANTIAL
**MAP:** `hunts/the-tightening/MAP.md`
**Forensic:** `hunts/the-tightening/clue-2/PROMPT-v1-failed.md` (prior PROMPT preserved)

---

## Context

Original C2 PROMPT (v1) asked the agent to rename `callNim` → `callLLM` across BOTH `packages/locke-harvest/src/index.ts` AND `packages/council/src/index.ts`. Substrate truth (probed Chat-side 2026-05-14T15:30Z):

- **Council has ZERO occurrences of `callNim`.** Its LLM-calling function is `callJudge` at L222, on `env.AI.run()` for Kimi K2.6 since 2026-05-07.
- **The 3 `nim-error` matches in Council are filter regex + comments** documenting historical contamination. Defensive — must stay.

Diagnosis of v1 deliberation collapse: agent correctly found Council had nothing to rename, then got stuck reasoning "PROMPT says rename here but `callNim` doesn't exist — am I missing something?" Burned full 1200s inner timeout in that loop without making a single edit. **The PROMPT lied about substrate state. That's the bug.**

This v2 is surgical: 2 line-numbered targets in Locke only. Council acknowledged clean. No inventory step.

---

## Surgical targets

**Pre-flight:** Probed 2026-05-14T15:30Z from `AetherCreator/thechefos-workers` HEAD.

1. **`packages/locke-harvest/src/index.ts:205` — function declaration:**
   - OLD: `async function callNim(systemPrompt: string, userPrompt: string, env: Env): Promise<{ text: string; raw: any }> {`
   - NEW: `async function callLLM(systemPrompt: string, userPrompt: string, env: Env): Promise<{ text: string; raw: any }> {`

2. **`packages/locke-harvest/src/index.ts:546` — only active call site:**
   - OLD: `    const result = await callNim(SYSTEM_PROMPT, userPrompt, env);`
   - NEW: `    const result = await callLLM(SYSTEM_PROMPT, userPrompt, env);`

**That is the entire scope.** No comments. No variable names (`nimText`/`nimRaw`/`nimCalls` stay). No Council. No wrangler.toml. No ACTIVE-STATE.md. No filename pattern renames.

---

## Task list (deterministic order)

1. **Clone workspace** (claude-exec.sh does this; workspace at `/tmp/claude-exec-the-tightening-clue2-<pid>/`).
2. **Direct edit L205 (declaration):** apply OLD→NEW pair above using your file-edit tool. No grep, no inventory — the line is named.
3. **Direct edit L546 (call site):** apply OLD→NEW pair above. Same surgical approach.
4. **Self-verify with grep:**
   - `grep -c 'async function callLLM' packages/locke-harvest/src/index.ts` → `1`
   - `grep -c 'async function callNim' packages/locke-harvest/src/index.ts` → `0`
   - `grep -c 'await callLLM(SYSTEM_PROMPT' packages/locke-harvest/src/index.ts` → `1`
   - `grep -c 'await callNim(SYSTEM_PROMPT' packages/locke-harvest/src/index.ts` → `0`
5. **Comments retaining `callNim` are INTENTIONAL.** Lines 18, 26, 212 reference `callNim` in historical comments. **DO NOT touch them.** They document substrate history truthfully.
6. **Single commit:**
   - Title: `the-tightening C2 (v2): Locke callNim → callLLM (surgical, 2-line)`
   - Body: file+line summary + grep counts.
   - Push to `main`.
7. **Author COMPLETE.md** at `hunts/the-tightening/clue-2/COMPLETE.md` BEFORE Task 8: commit SHA, the 2 line-number+file pairs, grep self-verify output, /health probe (filled in Task 9).
8. **Poll `deploy-locke-harvest` CI run** for this commit. 15s interval, max 5 min. Council CI not relevant.
9. **Locke /health probe:** `curl -sS https://locke-harvest.tveg-baking.workers.dev/health | jq` → `ok: true`.
10. **Invoke `hunt_complete.py`** with work-commit SHA in `--evidence`. Bible §6.1 trailer fires via trap finalize.

---

## Pass conditions (Rule-4 bash-verifiable)

```bash
[ "$(grep -c 'async function callLLM' packages/locke-harvest/src/index.ts)" = "1" ] && echo PASS-1
[ "$(grep -c 'async function callNim' packages/locke-harvest/src/index.ts)" = "0" ] && echo PASS-2
[ "$(grep -c 'await callLLM(SYSTEM_PROMPT' packages/locke-harvest/src/index.ts)" = "1" ] && echo PASS-3
[ "$(grep -c 'await callNim(SYSTEM_PROMPT' packages/locke-harvest/src/index.ts)" = "0" ] && echo PASS-4
[ "$(curl -sS https://locke-harvest.tveg-baking.workers.dev/health | jq -r .ok)" = "true" ] && echo PASS-5
# Plus: hunts/the-tightening/clue-2/COMPLETE.md present on origin/main
# Plus: deploy-locke-harvest GHA run for this commit conclusion=success
```

---

## Anti-patterns to refuse

- DO NOT touch `packages/council/`. Verified clean Chat-side — `callNim` count = 0.
- DO NOT touch `wrangler.toml`. Env var bindings out of scope.
- DO NOT touch ACTIVE-STATE.md. Different repo.
- DO NOT rename local variables `nimText`/`nimRaw`/`nimCalls`/`nimError`/`nimBudget`/`nimErrorStack`. Out of scope.
- DO NOT rename the `'nim_failed'` event string at `logIntel`. Out of scope.
- DO NOT update historical comments at L18, L26, L212. They document substrate history.
- DO NOT add tests, scaffolding, or refactor logic.
- DO NOT search for "callNim". You already have the line numbers. Just edit.

---

## §3 row 2 data note

v1 was a 2-Worker mechanical-rename-of-mythical-scope → **deliberation collapse data**, not synthesis budget data. The phantom-Council scope spun the agent.

v2 is a 2-line surgical edit. Expected: 5-8 turns, under 180s wall. If v2 ALSO collapses, cause is NOT scope or PROMPT honesty — deeper substrate issue, new diagnostic clue.

State-variant expectations:
- ✅ `done exit=0` — clean pass (expected)
- ⚠️ FALSE COMPLETE — strand-guard fires
- 💀 OUTER-TIMEOUT — remarkable for 2-line edit; would falsify OPS-CC-TURN-COUNT-CEILING
- 💀 BUDGET-EXHAUSTED — not expected

---

## Bible references

- §A7 audit-wrap: STRICT-wrap shell ops.
- §A8 reasoning-weight: **LOW** — 2-line surgical, all targets pre-resolved. Zero judgment calls.
- §A9 SUBSTANTIAL: claude-exec.sh substrate is right (file edits + commit + CI poll + /health), synthesis weight minimal.
- §6.1 truth-telling: trap finalize fires regardless of exit path.

---

## Bible candidate banked from v1 failure

**PROMPT-author substrate honesty is a §A8 reasoning-weight subspecies.** When a PROMPT instructs an action whose pre-condition is false ("rename X in Y" when X doesn't exist in Y), the agent burns deliberation budget on "did I miss something?" loops rather than failing fast. Mitigation: PROMPT-author probes substrate Chat-side before authoring; bakes verified line numbers into PROMPT. Cross-refs: hunter-false-complete-antipattern, claude-exec-partial-complete-strand-pattern, audit-completeness-gap-bilateral-probe.

---

> *"Drift fixed. Two lines. No phantoms."* 🏴‍☠️
