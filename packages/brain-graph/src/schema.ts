export async function runMigrations(db: D1Database): Promise<void> {
  await db.batch([
    db.prepare(`
      CREATE TABLE IF NOT EXISTS brain_nodes (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        domain TEXT NOT NULL,
        type TEXT NOT NULL,
        tags TEXT DEFAULT '[]',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        connection_count INTEGER DEFAULT 0,
        is_insight INTEGER DEFAULT 0,
        summary TEXT
      )
    `),
    db.prepare(`
      CREATE TABLE IF NOT EXISTS brain_connections (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source_id TEXT NOT NULL,
        target_id TEXT NOT NULL,
        relationship TEXT DEFAULT 'connects_to',
        created_at TEXT NOT NULL,
        UNIQUE(source_id, target_id, relationship)
      )
    `),
    db.prepare(`
      CREATE TABLE IF NOT EXISTS brain_patterns (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        domains TEXT NOT NULL DEFAULT '[]',
        node_ids TEXT NOT NULL DEFAULT '[]',
        status TEXT DEFAULT 'candidate',
        first_seen TEXT NOT NULL,
        graduated_at TEXT
      )
    `),
    db.prepare(`
      CREATE TABLE IF NOT EXISTS session_usage (
        id TEXT PRIMARY KEY,
        date TEXT NOT NULL,
        surface TEXT NOT NULL,
        session_type TEXT NOT NULL,
        msg_count INTEGER,
        usage_pct REAL,
        baseline_pct REAL,
        burn_pct REAL,
        mcp_count INTEGER,
        retry_loops INTEGER DEFAULT 0,
        note TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `),
    db.prepare(`
      CREATE TABLE IF NOT EXISTS usage_odometer (
        id TEXT PRIMARY KEY DEFAULT 'singleton',
        session_current_pct REAL NOT NULL DEFAULT 0,
        session_last_updated TEXT NOT NULL,
        session_last_id TEXT,
        weekly_current_pct REAL NOT NULL DEFAULT 0,
        weekly_reset_at TEXT NOT NULL,
        weekly_last_updated TEXT
      )
    `),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_nodes_domain ON brain_nodes(domain)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_nodes_type ON brain_nodes(type)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_nodes_updated_at ON brain_nodes(updated_at)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_connections_source ON brain_connections(source_id)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_connections_target ON brain_connections(target_id)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_session_date ON session_usage(date)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_session_type ON session_usage(session_type)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_session_surface ON session_usage(surface)`),
  ]);
}
