-- 0002_runtime_verdicts.sql — C2.1 decoupled runtime-verifier verdict store
-- Hunt grok-verify-harness clue-2.1 (OPS-GVH-C21-SHELL-REPRODUCE).
-- Stores advisory runtime verdicts from /opt/scripts/runtime-verifier.sh (InfiniVeg),
-- written by the brain-write Worker via POST /api/runtime-verdict (SUPERCLAUDE_BRAIN binding).
-- Applied out-of-band 2026-05-30 via D1 API; idempotent (CREATE ... IF NOT EXISTS) so a
-- later `wrangler d1 migrations apply` is a safe no-op.
CREATE TABLE IF NOT EXISTS runtime_verdicts (
  hunt         TEXT    NOT NULL,
  clue         TEXT    NOT NULL,
  work_repo    TEXT,
  work_commit  TEXT    NOT NULL,
  all_pass     INTEGER NOT NULL DEFAULT 0,
  total        INTEGER NOT NULL DEFAULT 0,
  passed       INTEGER NOT NULL DEFAULT 0,
  failed       INTEGER NOT NULL DEFAULT 0,
  verdict_json TEXT    NOT NULL,
  created_at   TEXT    NOT NULL,
  PRIMARY KEY (hunt, clue, work_commit)
);
CREATE INDEX IF NOT EXISTS idx_runtime_verdicts_commit  ON runtime_verdicts(work_commit);
CREATE INDEX IF NOT EXISTS idx_runtime_verdicts_created ON runtime_verdicts(created_at);
