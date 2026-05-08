# Clue 7 — Foundry Pipeline COMPLETE

**Hunt:** forge-and-library
**Clue:** 7 (SUBSTANTIAL)
**Completed:** 2026-05-07T23:30Z (salvaged commit)
**Substrate:** Hunter (claude-exec.sh) staged 9 files at 19:08-19:13 EDT, then Claude Code crashed mid-run before commit/push. Log buffer never flushed (--output-format text mode), no exit summary, no Long John ping. Salvaged from Chat by reading staged content via Shell Bridge and committing atomically against the workspace clone.
**Source of truth:** FOUNDRY-SCHEMA.md (commit 4b7721b3)

## What shipped

### 9 Worker source files (staged by Hunter, salvaged by Chat Claude)
- packages/schemer/src/index.ts (15050 B) — Workers AI Kimi K2.6 schemer per FOUNDRY-SCHEMA Section 4.1
- packages/schemer/wrangler.toml + package.json (AI binding + foundry-1.0 vars)
- packages/builder/src/index.ts (8673 B) — orchestration shell, no LLM, v1.0 logs-only per FOUNDRY-SCHEMA Section 4.2
- packages/builder/wrangler.toml + package.json
- packages/reviewer/src/index.ts (14014 B) — Anthropic Haiku 4.5 5-gate QA per FOUNDRY-SCHEMA Section 4.3
- packages/reviewer/wrangler.toml + package.json (HAIKU_MODEL var)

### deploy.yml patch (Chat Claude)
Three new jobs appended to .github/workflows/deploy.yml, mirroring deploy-council shape with step-level GITHUB_OUTPUT guard pattern:
- deploy-schemer (sets BRAIN_WRITE_SECRET, SCHEMER_RUN_SECRET, GITHUB_TOKEN)
- deploy-builder (sets BRAIN_WRITE_SECRET, BUILDER_RUN_SECRET, GITHUB_TOKEN)
- deploy-reviewer (sets BRAIN_WRITE_SECRET, REVIEWER_RUN_SECRET, GITHUB_TOKEN, ANTHROPIC_API_KEY)

## Tyler-side prerequisites (post-deploy)

GitHub Actions repo secrets to add for full functionality:
- SCHEMER_RUN_SECRET, SCHEMER_BRAIN_WRITE_SECRET
- BUILDER_RUN_SECRET, BUILDER_BRAIN_WRITE_SECRET
- REVIEWER_RUN_SECRET, REVIEWER_BRAIN_WRITE_SECRET
- REVIEWER_ANTHROPIC_API_KEY (Anthropic Console — only Anthropic-paid surface in entire swarm per FOUNDRY-SCHEMA Section 3 Spirit Test)

GH_TOKEN already exists (reused). Until Tyler adds the new secrets, the `|| true` pattern keeps deploy jobs green; Workers ship and /health works; /run-manual returns 403 until secrets land.

## CI status & /health smokes

Filled in post-commit by separate verification. Expected:
- schemer.tveg-baking.workers.dev/health → {ok, persona: schemer, schema: foundry-1.0, model: @cf/moonshotai/kimi-k2.6}
- builder.tveg-baking.workers.dev/health → {ok, persona: builder, schema: foundry-1.0, model: null}
- reviewer.tveg-baking.workers.dev/health → {ok, persona: reviewer, schema: foundry-1.0, model: claude-haiku-4-5-20251001}

## Substrate honesty (filed as OPS for v2.3)

Claude Code 2.x crashed silently mid-run. The hunter substrate must:
1. Set `set -o pipefail` in claude-exec.sh so EXIT propagates through tee
2. Detect empty/buffered log + zero new commits as a separate FALSE COMPLETE state distinct from auth death
3. Long John ping `||` branch must echo to auto-exec.log so silent ping failures are visible
4. The Hunter PROMPT pattern of writing COMPLETE.md at Task 6 (before /health probes) failed here because Claude Code crashed at Task 5 — needs an even earlier checkpoint, ideally after each Task is committed

The 20:27Z first fire failed instantly; the 23:05Z re-fire ran 9 min and staged real work before crashing. Different failure modes; same observability gap.

