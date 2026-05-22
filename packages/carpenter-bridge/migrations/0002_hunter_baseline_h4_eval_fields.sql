-- 0002 H4 eval fields for hunter_baseline_runs — 2026-05-22 (carpenter-h4-eval C1)
-- Extends the hunt-oriented baseline schema with H4 eval-specific fields.
-- Spec: hunts/carpenter-h4-eval/CHARTER.md §3 D1 schema extension

-- Three deltas vs carpenter_runs (mirroring the H4 CHARTER spec):
--   test_id       — fixture id (e.g. 'gamma-v1-c2-replay'); maps hunt+clue for H4 runs
--   agent_variant — 'hunter-nim-qwen3-coder' | 'hunter-anthropic-substitute'
--   binary_pass   — 0|1 boolean: all binary criteria met
--   graded_score  — 0.0-1.0 aggregate from rubric (nullable until eval runs)
--   work_repo     — substrate repo the agent worked in
--   pushed        — 0|1 boolean: agent pushed to remote
--   completed_at  — ISO8601 UTC completion timestamp (alias of ended_at for H4 schema)

ALTER TABLE hunter_baseline_runs ADD COLUMN test_id TEXT;
ALTER TABLE hunter_baseline_runs ADD COLUMN agent_variant TEXT;
ALTER TABLE hunter_baseline_runs ADD COLUMN binary_pass INTEGER DEFAULT 0;
ALTER TABLE hunter_baseline_runs ADD COLUMN graded_score REAL;
ALTER TABLE hunter_baseline_runs ADD COLUMN work_repo TEXT;
ALTER TABLE hunter_baseline_runs ADD COLUMN pushed INTEGER DEFAULT 0;
ALTER TABLE hunter_baseline_runs ADD COLUMN completed_at TEXT;

CREATE INDEX IF NOT EXISTS idx_hunter_baseline_test     ON hunter_baseline_runs(test_id);
CREATE INDEX IF NOT EXISTS idx_hunter_baseline_passed   ON hunter_baseline_runs(binary_pass);
CREATE INDEX IF NOT EXISTS idx_hunter_baseline_variant  ON hunter_baseline_runs(agent_variant);
