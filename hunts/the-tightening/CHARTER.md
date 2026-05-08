# 🔧 The Tightening — CHARTER

**Hunt:** the-tightening
**Bible:** 1.1 (with §A7 audit-wrap + §A8 reasoning-weight + §A9 executor-classification active)
**Substrate:** `/opt/scripts/auto-exec.sh` → `claude-exec.sh` for SUBSTANTIAL clues (productionized 2026-05-07, empirically validated 2026-05-08T03:30Z A2)
**Repo:** `AetherCreator/thechefos-workers`
**Origin:** stress-test 2026-05-08T03:30-04:00Z surfaced three production-relevant gaps in the Forge & Library swarm before the Sunday 00:00 UTC first organic fire.
**Spirit Test status:** All three clues stay in-network. Cost-telemetry Worker uses no LLM. Code edits are deterministic. The actual Council deliberation test is dry-run only this side of the neuron reset. Zero Anthropic API surfaces added.

---

## Why this hunt

Tyler authored a stress test 2026-05-08T03:30Z. Findings:

1. **Cost telemetry blackout — currently active in production.** Workers AI 10K-neuron daily allocation hit silently. `api.thechefos.app/api/brain/search` returns HTTP 500 (`AiError 4006`). Locke's manual fire at 03:52Z silently failed Phase 2 (96 candidates scanned, 0 nim_calls succeeded — caught only because the diagnostic-write-to-brain pattern banked tonight wrote `nim-error-fbbc0f40-...json`). Sunday 00:00 UTC fire would hit the same wall blind.

2. **ACTIVE-STATE / source drift.** Council `/health` self-reports `@cf/moonshotai/kimi-k2.6` while ACTIVE-STATE asserts "3 NIM Nemotron-120B judges parallel." Foundry pipeline (Schemer + Builder + Reviewer) is deployed, healthy, self-describing as `foundry-1.0` while ACTIVE-STATE marks C7 "next major build." Source-level: Locke's failure stack shows `callNim()` though the model is Kimi.

3. **Council single_signal gate currently blocks 100% of Locke output.** Four real leads exist in `_drafts/` (apollo, react location, reddit monitor, retail investor). All have `pattern_type: single_signal` and `thread_count: 1`. Council pre-filters all of them with `pattern_filtered:single_signal`. **No lead has cleared the deliberation gate yet, ever.** That should be a conscious design decision, not a silent constraint.

---

## Goal

After this hunt closes:

- A `cost-telemetry` Worker is live with `/dashboard` exposing daily neuron burn, Locke session count, Council session count, and traffic-light status.
- Locke source contains a neuron-aware defer guard: if remaining neurons < threshold, return `status: deferred` instead of attempting a Kimi call that will 4006.
- ACTIVE-STATE.md and Locke + Council source code accurately name the model.
- Council has a `force_deliberate=true` override flag for testing single_signal leads (dry-run validated, real fire deferred until after Workers AI reset).
- Sunday 00:00 UTC fire is observable end-to-end.

---

## Why telegram-loop test now

This hunt is the second empirical proof that `/build hunt-name clue-N` → claude-exec.sh fires real, multi-file substantial work to completion. Tonight's A2 validation used a deliberately-tiny diagnostic. C1 here is a real production Worker with multiple files, env vars, deploy.yml integration, and cross-file edits to Locke. If C1 fires clean, the loop is durable for real work.

---

## Closure criteria

- All three clues complete with COMPLETE.md authored *before* /health probes (partial-complete antipattern mitigation, per forge-and-library C6/C7 lessons)
- TREASURE.md banked with patterns + Bible 1.2 candidates surfaced
- OPS-BOARD row moved BACKLOG → COMPLETED
- ACTIVE-STATE updated with Foundry + Council=Kimi truths
- A neuron-burn-projection note in `brain/02-knowledge/` so future Tyler can see the Sunday cost picture in advance
