CREATE TABLE rate_snapshots (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  chain         TEXT NOT NULL CHECK(chain IN ('ethereum','arbitrum','base','polygon')),
  protocol      TEXT NOT NULL CHECK(protocol IN ('aave-v3','compound-v3','yearn')),
  asset         TEXT NOT NULL CHECK(asset IN ('USDC','USDT','DAI')),
  supply_apy    REAL NOT NULL,
  utilization   REAL,
  snapshot_ts   INTEGER NOT NULL,
  batch_id      TEXT NOT NULL,
  metadata_json TEXT
);
CREATE INDEX idx_rate_asset_ts ON rate_snapshots(asset, snapshot_ts DESC);
CREATE INDEX idx_rate_batch ON rate_snapshots(batch_id);

CREATE TABLE opportunities (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  asset             TEXT NOT NULL,
  source_protocol   TEXT NOT NULL,
  source_chain      TEXT NOT NULL,
  source_apy        REAL NOT NULL,
  target_protocol   TEXT NOT NULL,
  target_chain      TEXT NOT NULL,
  target_apy        REAL NOT NULL,
  rate_delta_bps    INTEGER NOT NULL,
  gas_estimate_usd  REAL NOT NULL,
  capital_assumption REAL NOT NULL,
  net_edge_bps      INTEGER NOT NULL,
  detected_ts       INTEGER NOT NULL,
  alert_sent        INTEGER NOT NULL DEFAULT 0,
  metadata_json     TEXT
);
CREATE INDEX idx_opp_asset_ts ON opportunities(asset, detected_ts DESC);
CREATE INDEX idx_opp_edge ON opportunities(net_edge_bps DESC);

CREATE TABLE scanner_runs (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  scanner      TEXT NOT NULL,
  started_ts   INTEGER NOT NULL,
  duration_ms  INTEGER NOT NULL,
  status       TEXT NOT NULL CHECK(status IN ('ok','error','partial')),
  rows_written INTEGER DEFAULT 0,
  error_msg    TEXT
);
CREATE INDEX idx_sr_scanner_ts ON scanner_runs(scanner, started_ts DESC);

CREATE TABLE alerts (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  kind       TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  sent_ts    INTEGER NOT NULL
);

CREATE TABLE alert_cooldowns (
  cooldown_key TEXT PRIMARY KEY,
  last_sent_ts INTEGER NOT NULL
);
