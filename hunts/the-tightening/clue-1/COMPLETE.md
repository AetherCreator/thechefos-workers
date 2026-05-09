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

**Synthesis budget:** N/A — Variant A does no synthesis except for COMPLETE.md template substitution (~1KB). All deliverable content pre-staged at scaffold time. Routes through claude-exec.sh (re-tagged [SUBSTANTIAL] after first-fire substrate-fs mismatch on [NARROW]/hunter-exec.py).

**Traffic light at completion:** {traffic_light from /dashboard probe}

**Patterns observed:** Bible 1.2 §4 cache-when-needed validated. §3 row 2 batched-writes column gets a NEGATIVE datapoint from Variant B (between-tool reasoning hits per-turn ceiling) — pre-cache + [NARROW] routing is the correct mitigation for clues with this synthesis profile.

**Next:** C2 PROMPT to be authored Chat-side after this completes.