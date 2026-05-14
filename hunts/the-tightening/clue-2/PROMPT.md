[CODE-AUTONOMOUS][DETERMINISTIC][SUBSTANTIAL]

# Hunt: the-tightening — Clue 2 — Locke `callNim` → `callLLM` (v3: trailer auto-close)

**Repo:** AetherCreator/thechefos-workers
**Branch:** main
**Author:** Chat-Opus 2026-05-14 (v3 after stream-json refire uncovered Task 10 privilege barrier)
**Bible:** 1.2.4 §A7 audit-wrap + §A8 reasoning-weight + §A9 SUBSTANTIAL + (candidate) §A20 agent/trailer-split
**MAP:** `hunts/the-tightening/MAP.md`
**Forensic:**
- `hunts/the-tightening/clue-2/PROMPT-v1-failed.md` (phantom-Council deliberation collapse)
- `hunts/the-tightening/clue-2/PROMPT-v2-strand.md` (Task 10 privilege-barrier strand)

---

## Context

PROMPT v1 lied about substrate state (asked agent to rename callNim in Council where the function never existed) — agent burned full budget in "did I miss something?" deliberation loop, made zero edits.

PROMPT v2 fixed substrate honesty (line-numbered Locke-only surgical targets). Agent reached Task 9 cleanly. BUT Task 10 ("invoke hunt_complete.py") is structurally blocked: agent runs as yasaisama, can't read `/opt/secrets/github-token` (mode 600 root:root). Agent burned 12 minutes retrying hunt_complete.py with different status enums + evidence formats, finally identified the token barrier — then SIGTERM hit.

Fix shipped 2026-05-14 (before this fire): `claude-exec.sh` trailer patched to auto-invoke `hunt_complete.py` from root context on EXIT=0 + NEW_COMMITS>0 + workspace COMPLETE.md present. Trailer is the right surface for closure — agent doesn't need to.

This v3 reflects the agent/trailer split:
- Agent's job: edit, verify, commit work, /health probe, write COMPLETE.md locally
- Trailer's job: publish COMPLETE.md to SuperClaude via hunt_complete.py
- No Task 10 in agent's scope

---

## Surgical targets

(Same as v2. Probed 2026-05-14T15:30Z from thechefos-workers HEAD.)

1. **`packages/locke-harvest/src/index.ts:205` — function declaration:**
   - OLD: `async function callNim(systemPrompt: string, userPrompt: string, env: Env): Promise<{ text: string; raw: any }> {`
   - NEW: `async function callLLM(systemPrompt: string, userPrompt: string, env: Env): Promise<{ text: string; raw: any }> {`

2. **`packages/locke-harvest/src/index.ts:546` — only active call site:**
   - OLD: `    const result = await callNim(SYSTEM_PROMPT, userPrompt, env);`
   - NEW: `    const result = await callLLM(SYSTEM_PROMPT, userPrompt, env);`

**Entire scope.** No comments, no variable names, no Council, no wrangler.toml, no ACTIVE-STATE.md, no filename pattern renames.

---

## Task list (deterministic order — 8 tasks, no Task 10)

1. **Clone workspace** (claude-exec.sh did this; workspace at `/tmp/claude-exec-the-tightening-clue2-<pid>/`).
2. **Direct edit L205 (declaration):** apply OLD→NEW pair using Edit tool. No grep, no inventory.
3. **Direct edit L546 (call site):** apply OLD→NEW pair.
4. **Self-verify with grep (4 checks):**
   - `grep -c 'async function callLLM' packages/locke-harvest/src/index.ts` → `1`
   - `grep -c 'async function callNim' packages/locke-harvest/src/index.ts` → `0`
   - `grep -c 'await callLLM(SYSTEM_PROMPT' packages/locke-harvest/src/index.ts` → `1`
   - `grep -c 'await callNim(SYSTEM_PROMPT' packages/locke-harvest/src/index.ts` → `0`
5. **Comment retention check.** Verify `grep -n callNim packages/locke-harvest/src/index.ts` still shows 2-3 hits in comments only (lines 18, 26, 212 ish). DO NOT touch those comments.
6. **Single commit + push:**
   - Title: `the-tightening C2 (v3): Locke callNim → callLLM (surgical, 2-line)`
   - Body: file+line summary + grep counts.
   - `git push origin main`
7. **Locke /health probe:** `curl -sS https://locke-harvest.tveg-baking.workers.dev/health | jq` — capture full JSON.
8. **Write COMPLETE.md to workspace** at `hunts/the-tightening/clue-2/COMPLETE.md` (relative path inside cloned repo). **DO NOT COMMIT IT** to the work repo. The trailer will publish it to SuperClaude. Content (markdown):
   - Commit SHA from Task 6
   - The 2 line-number+file pairs
   - All 4 grep counts from Task 4
   - Comment-retention verification (from Task 5)
   - Full /health JSON from Task 7

After Task 8: **exit cleanly.** The trailer (root context) will:
- Detect EXIT=0 + NEW_COMMITS>0 + workspace COMPLETE.md present
- Invoke `hunt_complete.py` from root with workspace COMPLETE.md as source
- Publish canonical COMPLETE.md to SuperClaude
- Ping Ship's Doctor with ✅ done + SuperClaude close-commit SHA

---

## Pass conditions (Rule-4 bash-verifiable)

```bash
# Agent self-verifiable:
[ "$(grep -c 'async function callLLM' packages/locke-harvest/src/index.ts)" = "1" ] && echo PASS-1
[ "$(grep -c 'async function callNim' packages/locke-harvest/src/index.ts)" = "0" ] && echo PASS-2
[ "$(grep -c 'await callLLM(SYSTEM_PROMPT' packages/locke-harvest/src/index.ts)" = "1" ] && echo PASS-3
[ "$(grep -c 'await callNim(SYSTEM_PROMPT' packages/locke-harvest/src/index.ts)" = "0" ] && echo PASS-4
[ "$(curl -sS https://locke-harvest.tveg-baking.workers.dev/health | jq -r .ok)" = "true" ] && echo PASS-5
[ -s "hunts/the-tightening/clue-2/COMPLETE.md" ] && echo PASS-6

# Trailer-verifiable (after agent exit):
# - SuperClaude /repos/.../hunts/the-tightening/clue-2/COMPLETE.md returns 200
# - intel_log terminal row posted
# - Ship's Doctor ping: ✅ done with trailer auto-close SHA
```

---

## Anti-patterns to refuse

- DO NOT touch `packages/council/`. Verified clean — `callNim` count = 0.
- DO NOT touch `wrangler.toml`. Env var bindings out of scope.
- DO NOT touch ACTIVE-STATE.md. Different repo.
- DO NOT rename local variables `nimText`/`nimRaw`/`nimCalls`/`nimError`/`nimBudget`/`nimErrorStack`. Out of scope.
- DO NOT rename the `'nim_failed'` event string at `logIntel`. Out of scope.
- DO NOT update historical comments at L18, L26, L212. They document substrate history.
- DO NOT add tests, scaffolding, or refactor logic.
- DO NOT search for "callNim". You already have the line numbers.

**v3 NEW anti-patterns:**
- DO NOT commit COMPLETE.md to the work repo. Write it to your workspace path only. The trailer publishes to SuperClaude.
- DO NOT invoke `hunt_complete.py`. The trailer handles this. You can't read `/opt/secrets/github-token` anyway (yasaisama privilege boundary).
- DO NOT poll deploy-locke-harvest CI. /health probe is the deploy verification.

---

## State-variant expectations

- ✅ `done — trailer auto-closed to SuperClaude (CLOSE_SHA)` — clean pass (expected for v3)
- ⚠️ `STRANDED` — workspace COMPLETE.md missing or trailer auto-close failed. Manual close needed.
- 💀 `OUTER-TIMEOUT` — would be remarkable; v2 burned 12 min on Task 10 retry loop, v3 has no such loop.
- 💀 `CRASH` — runner died before COMPLETE.md authored.
- ❌ `failed` — explicit non-zero exit.

Expected wall: under 180s. Agent does Tasks 1-6 in ~90s, /health probe + COMPLETE.md write in ~30s.

---

## Bible references

- §A7 audit-wrap: STRICT-wrap shell ops.
- §A8 reasoning-weight: **LOW** — pre-resolved targets.
- §A9 SUBSTANTIAL: claude-exec.sh substrate.
- §A20 (candidate) agent/trailer-split: agents lack root-only secrets by design; tasks requiring secrets lift to trailer.
- §6.1 truth-telling: trap finalize fires regardless of exit path.

---

## Bible candidates banked from this hunt

1. **PROMPT-author substrate honesty** (§A8 subspecies, from v1): PROMPTs that lie about pre-conditions cause deliberation collapse. Mitigation: probe substrate Chat-side, bake verified targets into PROMPT.

2. **Agent/trailer privilege split** (§A20 candidate, from v2): agents lack root-only secrets. Tasks requiring secrets MUST lift to trailer (root). The "agent does everything" model is wrong; the right model is "agent edits, trailer closes."

3. **hunt_complete.py cross-repo verification bug**: script hardcodes `REPO=SuperClaude`, rejects work commits on other repos via verification. Workaround: evidence uses `work_commit` not `commit`. Fix candidate: detect repo from evidence or accept both keys.

---

> *"Agent edits. Trailer closes. Each surface in its own privilege envelope."* 🩺
