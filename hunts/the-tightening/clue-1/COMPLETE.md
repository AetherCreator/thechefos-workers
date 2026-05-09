# Clue 1 — COMPLETE (Variant A — shipped via deterministic completion of Hunter prepared work)

**Status:** ✅ LIVE
**Variant:** A (pre-cached source — Bible 1.2 §3 row 2 + §4 cache-when-needed)
**Final ship commits:**
- `c21ae10` — Hunter's prepared work (5 cp's + COMPLETE.md author) shipped after outer-wall timeout. CI failed at cron-cap.
- `2ce8456a` — Removed cost-telemetry [triggers] cron (account at 5/5 free-plan cap). CI green. Worker live.

**Substrate evidence (3-axis):**
- ✅ **Source:** `packages/cost-telemetry/{src/index.ts, wrangler.toml, package.json}` on main; `packages/locke-harvest/src/index.ts` has `checkTelemetry` + defer guard; `.github/workflows/deploy.yml` has `deploy-cost-telemetry` job
- ✅ **CI:** `Deploy Cost Telemetry` job conclusion = `success` on commit `2ce8456a` (run 25588975266 if needed for forensic)
- ✅ **Runtime:** `/health` returns 200 with `{ok:true, persona:"cost-telemetry", schema:"telemetry-1.0", model:null}`. `/dashboard` returns 200 with full Rollup schema, `traffic_light:"green"` (UTC May 9 fresh-quota baseline)

**KV namespace:** `cost-telemetry-rollup` id=`fb64c3edbf8043e38814a9ce543e760c` (pre-created via CF API at staging time, baked into wrangler.toml)

## How this clue actually shipped (the substrate story, multi-act)

Variant A was the recovery from B's batched-writes failure. The autonomous fire path went through 4 attempts:

1. **v1** (2026-05-08T14:08-14:12Z) — `[SUBSTANTIAL]` synthesis-from-spec. Single 150-line Write hit `HTTP_READ_TIMEOUT=120` in free-cc-proxy/.env. ⚠️ FALSE COMPLETE caught by Long John.
2. **B** (17:43-17:48Z) — `[SUBSTANTIAL]` batched writes. Reasoning between Tasks 6→7 hit the same 120s wall. ⚠️ FALSE COMPLETE.
3. **A on [NARROW]** (18:08-18:13Z) — hunter-exec.py budget exhausted (300s). Substrate-fs mismatch (PROMPT assumed local checkout; hunter-exec.py uses GitHub API + remote shell only). Silent — no Long John ping wiring on [NARROW] substrate.
4. **A on [SUBSTANTIAL]** (01:08-01:13Z) — same 120s wall, this time on the reasoning step that should have written this very COMPLETE.md. ⚠️ FALSE COMPLETE.

Tyler pushed back on bank-and-sleep. Chat-side shell forensics:
- Direct NIM probe → 3.4s for 9KB payload → NIM is fast
- free-cc-proxy/.env had `HTTP_READ_TIMEOUT=120` overriding proxy default of 300
- Nemotron-3-Super-120B is a reasoning model — its internal reasoning phase produces no streamable tokens; with cumulative context, reasoning routinely exceeds 120s with zero chunks → httpx read_timeout fires
- Fix: `HTTP_READ_TIMEOUT 120 → 600` in /opt/free-cc-proxy/.env, service restarted

**5th attempt — A on [SUBSTANTIAL] post-fix** (21:44-21:54 EDT / 01:44-01:54 UTC):
- Hunter completed all PROMPT Tasks 1-6 successfully. Reasoning steps of 89.7s, 136.3s, **171.1s** all completed cleanly — every one of them would have killed prior fires
- Wrote this COMPLETE.md (1450 bytes, 21 lines) at JSONL turn 55 right after a 171.1s reasoning step
- claude-exec.sh's outer wall (`timeout 600 claude`) fired before Hunter could `git add + commit + push` (Tasks 7-8). Inner-fix exposed outer-fix
- Workspace: `/tmp/claude-exec-the-tightening-clue1-529835/` — preserved with all of Hunter's prepared work intact

**Deterministic completion** (commit `c21ae10`):
- Tyler's chat-side Claude (this session) cd'd into Hunter's prepared workspace, ran `git add -A`, committed Hunter's exact prepared work byte-equal, pushed
- CI fired, all jobs green except cost-telemetry which failed at the schedule step (5/5 cron cap)

**Cron fix** (commit `2ce8456a`):
- Removed `[triggers]` block from cost-telemetry/wrangler.toml — `/dashboard` already recomputes on-demand via `loadRollup` when KV cache is stale
- Re-deploy succeeded, route attached, Worker live

## Synthesis budget telemetry (Bible 1.2 §3 row 2 datapoint)

| Surface | Inner ceiling | Outer ceiling | Outcome |
|---|---|---|---|
| claude-exec.sh + free-cc-proxy + NIM Nemotron-3-Super-120B (PRE-FIX) | `HTTP_READ_TIMEOUT=120` (was the wall) | `timeout 600 claude` | Killed at ~14 cumulative tool calls regardless of work shape — appeared to be "cumulative context ceiling" but actually was config |
| claude-exec.sh + free-cc-proxy + NIM Nemotron-3-Super-120B (POST-FIX) | `HTTP_READ_TIMEOUT=600` ✅ headroom | `timeout 600 claude` (now the wall) | Completed Tasks 1-6 of Variant A but ran out of total wall-clock at 600s. Per-turn reasoning of 171.1s passed clean — would have killed pre-fix |

**Bible 1.2.3 candidates from this clue:**
1. §3 row 2: distinguish *configurable* substrate timeouts from *intrinsic* model/upstream limits. Pre-fix's "ceiling" was the former.
2. §3 outer-wall awareness: claude-exec.sh's `timeout 600 claude` is a separate ceiling. Inner-fix exposed outer-fix. For clues with cumulative-context profiles, both ceilings must be sized OR clues split into sub-clues.
3. §A9 substrate-fs note: [NARROW]/hunter-exec.py = no /tmp clone (GitHub API + remote shell). [SUBSTANTIAL]/claude-exec.sh = /tmp clone. Mapmaker discipline gap.
4. §6 truth-telling port: hunter-exec.py needs Long John completion-ping wiring. Today only claude-exec.sh has it.
5. Free-plan cron-cap awareness: account-level cap of 5 across all Workers. New Workers needing crons must check capacity OR be designed cron-free.

## Sovereignty check

✅ Holds. Spirit Test passed. Three FALSE COMPLETEs revealed a config bug (one line of .env), got it fixed, exposed an outer-wall + cron-cap secondary issue, fixed those too. No new Anthropic API surfaces proposed. Long John truth-telling caught every claim that wasn't actually shipped (3-for-3 on claude-exec.sh; one silent on [NARROW] — banked for graduation).

**Next:** C2 PROMPT to be authored Chat-side after this completes. Worker is live and observable.
