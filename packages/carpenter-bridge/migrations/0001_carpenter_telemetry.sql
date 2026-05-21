-- 0001 carpenter telemetry tables — created 2026-05-22 (carpenter-foundation H1 C2)
-- Telemetry for Carpenter runs (Kimi K2.6 in-network) + Hunter baseline runs (eval comparison)
-- Spec: brain/06-meta/carpenter-design/03-dispatch-protocol-spec.md §Telemetry contract

CREATE TABLE IF NOT EXISTS carpenter_runs (
  run_id         TEXT PRIMARY KEY,
  hunt           TEXT NOT NULL,
  clue           INTEGER NOT NULL,
  started_at     TEXT NOT NULL,
  ended_at       TEXT,
  exit_reason    TEXT,
  turn_count     INTEGER,
  tool_calls     INTEGER,
  upstream_model TEXT,
  tools_variant  TEXT,
  work_commit    TEXT,
  hunt_commit    TEXT,
  notes          TEXT
);

CREATE TABLE IF NOT EXISTS hunter_baseline_runs (
  run_id         TEXT PRIMARY KEY,
  hunt           TEXT NOT NULL,
  clue           INTEGER NOT NULL,
  started_at     TEXT NOT NULL,
  ended_at       TEXT,
  exit_reason    TEXT,
  turn_count     INTEGER,
  upstream_model TEXT,
  work_commit    TEXT,
  hunt_commit    TEXT,
  notes          TEXT
);
