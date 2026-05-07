# C1 — Pre-flight inventory `[CODE-AUTONOMOUS]` `[DETERMINISTIC]`

**Hunt:** forge-and-library
**Clue:** 1 of 8
**Surface:** `[CODE-AUTONOMOUS]` — hunter-exec.py via Tyler DM `/build forge-and-library clue-1` to `@Mastro_ClaudeBot`
**Reasoning class:** `[DETERMINISTIC]` (per §A8) — pure infra inventory, zero synthesis, zero judgment
**Bible:** 1.1 (+ §A7 audit-wrap convention applied throughout)
**Substrate:** `hunter-exec.py` (post one-word patch — line 259 verified in step 6)
**Depends on:** none (this clue establishes the baseline)

---

## Why this clue exists

This is **the first hunt clue authored from the start under §A7 + §A8.** Its purpose is dual:

1. **Inventory the infrastructure** Forge & Library will consume (Gemini key, Ollama models, SearXNG, brain-write reachability, Cloudflare deploy pipeline, Telegram tokens, Agent-Reach status, hunter-exec.py post-patch state).

2. **Empirically validate** that a §A7+§A8-compliant `[CODE-AUTONOMOUS][DETERMINISTIC]` clue fires end-to-end **without Tyler bouncing.** This is the fire-and-walk-away proof. If C1 needs even one phone↔Chat round, the conventions didn't stick.

Pass condition for #2: zero phone messages from Tyler between firing `/build forge-and-library clue-1` and seeing the @LongClaudeSilver_bot completion ping.

---

## Identifiers (3-bucket discipline)

| Name | Bucket | Source |
|---|---|---|
| `hunt_name` | 1 | inline: `forge-and-library` |
| `clue_number` | 1 | inline: `1` |
| `target_repo` | 1 | inline: `AetherCreator/thechefos-workers` |
| `target_branch` | 1 | inline: `main` |
| `report_path` | 1 | inline: `hunts/forge-and-library/clue-1/pre-flight-report.md` |
| `complete_path` | 1 | inline: `hunts/forge-and-library/clue-1/COMPLETE.md` |
| `timestamp_iso` | 2 | `shell_execute` of `date -u +%Y-%m-%dT%H:%M:%SZ` (read `stdout`, trimmed) |
| `gemini_key_state` | 2 | step-3 `shell_execute` AUDIT result |
| `telegram_tokens_state` | 2 | step-4 `shell_execute` AUDIT result |
| `ollama_state` | 2 | step-5 `shell_execute` AUDIT result |
| `hunter_exec_patched` | 2 | step-6 `shell_execute` STRICT result |
| `searxng_state` | 2 | step-7 `shell_execute` AUDIT result |
| `brain_write_state` | 2 | step-8 `shell_execute` AUDIT result |
| `openclaw_tools_state` | 2 | step-9 `shell_execute` AUDIT result |
| `agent_reach_state` | 2 | step-10 `shell_execute` AUDIT result |
| `report_commit_sha` | 2 | returned by `github_put_file` for the report |
| `complete_existing_sha` | 2 | `github_get_file` for `complete_path` (likely NEW — omit `sha` on put if 404) |

---

## Tools (bare names)

- `intel_log` — D1 telemetry
- `shell_execute` — InfiniVeg shell via n8n bridge
- `github_get_file` — read repo files
- `github_put_file` — write repo files
- `hunt_complete` — TERMINAL clue close

---

## Step classifications (§A7 + §A8 inline)

Each `shell_execute` step is tagged with its §A7 classification. **STRICT** = bare command, exit-non-zero is a strike. **AUDIT** = wrapped (`; echo "MARKER"` or `|| true`), exit forced to 0, Hunter inspects stdout for content.

---

## Task — strict order

1. `intel_log` with `{"hunt": "forge-and-library", "clue_number": 1, "status": "in_progress"}`

2. **`[STRICT]`** `shell_execute` `date -u +%Y-%m-%dT%H:%M:%SZ` → capture `stdout` (trimmed) as `timestamp_iso`. (date itself is reliable; STRICT is fine.)

3. **`[AUDIT]`** Gemini key inventory. `shell_execute`:
   ```
   ls -la /opt/secrets/gemini-key 2>&1; echo "GEMINI_AUDIT_DONE"; if [ -s /opt/secrets/gemini-key ]; then echo "GEMINI_KEY_PRESENT"; else echo "GEMINI_KEY_MISSING"; fi
   ```
   Capture `stdout` as `gemini_key_state`. Pass: stdout contains either `GEMINI_KEY_PRESENT` or `GEMINI_KEY_MISSING`. Either is acceptable for C1 (just inventory). Marker `GEMINI_AUDIT_DONE` proves chain ran.

4. **`[AUDIT]`** Telegram tokens inventory. `shell_execute`:
   ```
   ls -la /opt/secrets/telegram-tokens/ 2>&1 | grep -E "(locke-lamora|librarian|superclaude|foundry)" || true; echo "TELEGRAM_AUDIT_DONE"
   ```
   Capture as `telegram_tokens_state`. Marker `TELEGRAM_AUDIT_DONE` is the success signal.

5. **`[AUDIT]`** Ollama state. `shell_execute`:
   ```
   ollama list 2>&1 | head -20 || true; echo "OLLAMA_AUDIT_DONE"
   ```
   Capture as `ollama_state`. (Should show gemma2:9b, nomic-embed-text per InfiniVeg boot script.)

6. **`[STRICT]`** hunter-exec.py post-patch verification. `shell_execute`:
   ```
   grep -n 'd.get("exit") == 0' /opt/scripts/hunter-exec.py
   ```
   Capture as `hunter_exec_patched`. **STRICT — must find the line.** If not found, the patch was reverted/lost; STUCK with reason `hunter_exec_patch_missing` is correct (Tyler restores from `/opt/scripts/hunter-exec.py.bak.preBugFix-20260506` and reviews substrate state).

7. **`[AUDIT]`** SearXNG reachability. `shell_execute`:
   ```
   curl -s -o /dev/null -w "HTTP=%{http_code}" "http://localhost:8888/search?q=test&format=json" || echo "SEARXNG_UNREACHABLE"; echo; echo "SEARXNG_AUDIT_DONE"
   ```
   Capture as `searxng_state`. Marker proves chain ran. HTTP=200 is success; anything else is a TODO for C2 design phase.

8. **`[AUDIT]`** brain-write Worker reachability. `shell_execute`:
   ```
   curl -s -o /dev/null -w "HTTP=%{http_code}" "https://api.thechefos.app/api/brain/list?prefix=00-session" -H "x-webhook-secret: $(cat /opt/secrets/brain-webhook-secret 2>/dev/null || echo SuperDuperClaude)" || echo "BRAIN_UNREACHABLE"; echo; echo "BRAIN_AUDIT_DONE"
   ```
   Capture as `brain_write_state`. HTTP=200 indicates the Worker + token are correct.

9. **`[AUDIT]`** OpenClaw tools (intel_log + hunt_complete) presence. `shell_execute`:
   ```
   ls -la /opt/openclaw-tools/intel_log.py /opt/openclaw-tools/hunt_complete.py 2>&1 || true; echo "OPENCLAW_TOOLS_AUDIT_DONE"
   ```
   Capture as `openclaw_tools_state`.

10. **`[AUDIT]`** Agent-Reach (Reddit/YouTube structured scraping). `shell_execute`:
    ```
    which agent-reach 2>&1 || echo "AGENT_REACH_NOT_INSTALLED"; pip3 list 2>&1 | grep -iE "agent-reach|jina" || echo "NO_PIP_PACKAGE"; echo "AGENT_REACH_AUDIT_DONE"
    ```
    Capture as `agent_reach_state`. **Acceptable for C1** to find Agent-Reach not yet installed — that's a TODO for C3. Marker confirms chain ran.

11. **Build pre-flight report.** Use the REPORT TEMPLATE below — substitute `<timestamp_iso>`, `<gemini_key_state>`, `<telegram_tokens_state>`, `<ollama_state>`, `<hunter_exec_patched>`, `<searxng_state>`, `<brain_write_state>`, `<openclaw_tools_state>`, `<agent_reach_state>` literally with captured values.

12. **Idempotency guard for report.** `github_get_file` for `report_path` → if `ok:true` capture `sha` (this would be a re-fire); if `ok:false` set NONE.

13. **Write `pre-flight-report.md`.** `github_put_file`:
    - `path`: `hunts/forge-and-library/clue-1/pre-flight-report.md`
    - `repo`: `AetherCreator/thechefos-workers`
    - `branch`: `main`
    - `message`: `forge-and-library clue-1 — pre-flight inventory report`
    - `sha`: `<step-12 sha>` (omit if NONE)
    - `content`: built body from step 11

    Capture returned commit `sha` as `report_commit_sha`.

14. **Idempotency guard for COMPLETE.** `github_get_file` for `complete_path` → if `ok:true` capture `sha`; if `ok:false` set NONE.

15. **Build COMPLETE.md body** from the COMPLETE TEMPLATE below — substitute `<timestamp_iso>`, `<report_commit_sha>` literally. NO self-referential SHAs.

16. **Write COMPLETE.md.** `github_put_file`:
    - `path`: `hunts/forge-and-library/clue-1/COMPLETE.md`
    - `repo`: `AetherCreator/thechefos-workers`
    - `branch`: `main`
    - `message`: `forge-and-library clue-1 COMPLETE — pre-flight inventory (autonomous)`
    - `sha`: `<step-14 sha>` (omit if NONE)
    - `content`: built body from step 15

17. `hunt_complete` with:
    ```
    {
      "hunt": "forge-and-library",
      "clue_n": 1,
      "status": "complete",
      "summary": "C1 autonomous: pre-flight inventory completed; report at hunts/forge-and-library/clue-1/pre-flight-report.md; §A7+§A8-compliant first run",
      "complete_md": "<step-15 body>",
      "evidence": "<report_commit_sha>"
    }
    ```
    **TERMINAL.** After return, emit ONE short closing assistant message and stop. Do not call further tools.

---

## REPORT TEMPLATE (verbatim, substitute angle-brackets only)

```
# Forge & Library — C1 Pre-flight Inventory Report

**Date:** <timestamp_iso>
**Hunt:** forge-and-library
**Clue:** 1
**Substrate:** hunter-exec.py (post one-word patch from the-pilgrimage clue-5)

## Critical (must pass for hunt to proceed)

### hunter-exec.py post-patch state
\`\`\`
<hunter_exec_patched>
\`\`\`
**Status:** PASS if grep returned the line; STRICT failure mode if not.

### brain-write Worker reachability
\`\`\`
<brain_write_state>
\`\`\`
**Status:** PASS if `HTTP=200` in stdout.

### OpenClaw tools (intel_log + hunt_complete)
\`\`\`
<openclaw_tools_state>
\`\`\`
**Status:** PASS if both files listed without "No such file" errors.

## Required for full pipeline (C3+)

### Gemini Flash API key
\`\`\`
<gemini_key_state>
\`\`\`
**Status:** PASS if `GEMINI_KEY_PRESENT`; TODO for Tyler if `GEMINI_KEY_MISSING`.

### Ollama analysis models
\`\`\`
<ollama_state>
\`\`\`
**Status:** PASS if at least one analysis model (gemma2:9b, llama3.2, qwen2.5:7b) appears.

### SearXNG meta-search
\`\`\`
<searxng_state>
\`\`\`
**Status:** PASS if `HTTP=200`. TODO if unreachable.

### Telegram bot tokens
\`\`\`
<telegram_tokens_state>
\`\`\`
**Status:** PASS if `locke-lamora.token` listed. Other tokens (librarian/superclaude/foundry) are C2-stage prerequisites — TODO if missing.

### Agent-Reach (structured scraping)
\`\`\`
<agent_reach_state>
\`\`\`
**Status:** ACCEPTABLE TODO if `AGENT_REACH_NOT_INSTALLED`. C3 will install as part of locke-harvest Worker scaffolding.

## Summary

This is C1 of forge-and-library. Per Bible 1.1 + §A7 + §A8, this clue is `[CODE-AUTONOMOUS][DETERMINISTIC]` — the first hunt clue authored from scratch under the post-pilgrimage conventions. The hunt proceeds to C2 (Librarian schema design, [CHAT-OPUS][SYNTHESIS]) only if Critical items above all PASS. Required-for-pipeline items can be addressed at later clue boundaries.

C2 is Tyler's next move (Chat session). C1 is Hunter's solo work — fire and walk away.
```

---

## COMPLETE.md template (for step 15)

```
# forge-and-library clue-1 — COMPLETE

**Status:** ✅ shipped
**Date:** <timestamp_iso>
**Surface:** [CODE-AUTONOMOUS] — hunter-exec.py
**Reasoning class:** [DETERMINISTIC] (§A8)
**Bible:** 1.1 (with §A7 + §A8 applied)

## Pre-flight inventory

Full report at `hunts/forge-and-library/clue-1/pre-flight-report.md` (commit `<report_commit_sha>`).

Inventory categories audited:
- Critical: hunter-exec.py post-patch state, brain-write reachability, OpenClaw tools presence
- Required for pipeline: Gemini key, Ollama models, SearXNG, Telegram tokens, Agent-Reach

## §A7 + §A8 dogfood signal

This clue was authored from scratch under §A7 (audit-exit-wrap) + §A8 (reasoning-weight classification). Every shell step inline-tagged STRICT or AUDIT. The clue is [DETERMINISTIC] — no synthesis, no creative authoring, no judgment-heavy reasoning. Hunter's role here is pure infrastructure inventory + verbatim report writing.

If this clue fired end-to-end without Tyler phone↔Chat bouncing, the pilgrimage lessons stuck. If it didn't, the conventions need another iteration.

## Run notes

The first hunt clue authored from the start under post-pilgrimage Bible 1.1 + §A7 + §A8. The fire-and-walk-away proof.

C2 (Librarian schema design) is next — `[CHAT-OPUS][SYNTHESIS]`. Tyler authors output verbatim, baked into C3 PROMPT for autonomous Hunter writing.
```

---

## Pass conditions

- [ ] All 6 `shell_execute` AUDIT steps return `ok:true` (markers in stdout prove chain ran end-to-end)
- [ ] Step 6 STRICT shell_execute returns `ok:true` (hunter-exec.py post-patch verified)
- [ ] `hunts/forge-and-library/clue-1/pre-flight-report.md` on `origin/main`, no `<placeholder>` substrings
- [ ] `hunts/forge-and-library/clue-1/COMPLETE.md` on `origin/main`, no `<placeholder>` substrings
- [ ] `intel_log` posted at start (status=in_progress)
- [ ] `hunt_complete` invoked exactly once, status=complete
- [ ] Wall-clock < 3 min from PROMPT receipt to `hunt_complete` return
- [ ] Trajectory ≤ 14 tool_calls
- [ ] **No phone↔Chat bouncing required** — the §A7+§A8 dogfood test

---

## Strike rule

1 attempt. Specific failure modes:

- Step 6 fails (hunter-exec.py patch missing): STUCK with reason `hunter_exec_patch_missing`. Tyler restores from `/opt/scripts/hunter-exec.py.bak.preBugFix-20260506` and reviews substrate. Critical — without the patch, future hunts will hit the same bug.
- Step 13 (report put) 422: retry once with fresh `github_get_file` for sha; STUCK if still failing.
- Step 16 (COMPLETE put) 422: retry once; STUCK if still failing.
- Any AUDIT step (3, 4, 5, 7, 8, 9, 10) returning `ok:false`: this would indicate the §A7 wrap was applied incorrectly. Treat as a §A7 violation, mark in COMPLETE.md as a Bible-1.2 surfacing finding, and continue (don't strike). Per pilgrimage retro: AUDIT-step `ok:false` should never strike.

If any unexpected non-200 from `github_put_file` AND we've already retried per above: STUCK. Report.

---

## Trigger

Tyler: DM `@Mastro_ClaudeBot` → `/build forge-and-library clue-1`

n8n WF04 routes to InfiniVeg → `python3 /opt/scripts/hunter-exec.py --hunt forge-and-library --clue 1`. Hunter follows the task list above. Tyler receives `@LongClaudeSilver_bot` ping on completion.

**Expected:** Tyler taps fire, walks away, comes back to a green ping. No bouncing. If bouncing happens, the conventions didn't stick.
