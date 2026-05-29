CREATE TABLE IF NOT EXISTS brain_xp (
  path            TEXT PRIMARY KEY,
  xp              REAL    NOT NULL DEFAULT 0,
  last_touched_at TEXT    NOT NULL,
  touch_count     INTEGER NOT NULL DEFAULT 0,
  source_of_touch TEXT,
  created_at      TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_brain_xp_xp      ON brain_xp(xp);
CREATE INDEX IF NOT EXISTS idx_brain_xp_touched ON brain_xp(last_touched_at);
