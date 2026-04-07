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
    db.prepare(`
      CREATE TABLE IF NOT EXISTS hunt_intelligence (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        hunt_name TEXT NOT NULL,
        clue_number INTEGER NOT NULL,
        clue_title TEXT,
        model_used TEXT,
        status TEXT NOT NULL,
        start_time TEXT,
        end_time TEXT,
        duration_seconds INTEGER,
        token_estimate INTEGER,
        stuck_count INTEGER DEFAULT 0,
        commit_sha TEXT,
        notes TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      )
    `),
    // === Wiki / Researcher Agent tables ===
    db.prepare(`
      CREATE TABLE IF NOT EXISTS wiki_topics (
        slug TEXT PRIMARY KEY,
        root_slug TEXT NOT NULL,
        parent_slug TEXT,
        title TEXT NOT NULL,
        depth INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'queued',
        domain TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `),
    db.prepare(`
      CREATE TABLE IF NOT EXISTS wiki_articles (
        slug TEXT PRIMARY KEY,
        root_slug TEXT NOT NULL,
        category_slug TEXT,
        title TEXT NOT NULL,
        summary TEXT,
        content TEXT,
        sources TEXT,
        related_slugs TEXT,
        tags TEXT,
        depth_level TEXT,
        query_count INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `),
    // === Existing indexes ===
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_nodes_domain ON brain_nodes(domain)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_nodes_type ON brain_nodes(type)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_nodes_updated_at ON brain_nodes(updated_at)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_connections_source ON brain_connections(source_id)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_connections_target ON brain_connections(target_id)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_session_date ON session_usage(date)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_session_type ON session_usage(session_type)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_session_surface ON session_usage(surface)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_hunt_intelligence_hunt ON hunt_intelligence(hunt_name)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_hunt_intelligence_status ON hunt_intelligence(status)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_hunt_intelligence_model ON hunt_intelligence(model_used)`),
    // === Wiki indexes ===
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_wiki_topics_root ON wiki_topics(root_slug)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_wiki_topics_status ON wiki_topics(status)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_wiki_articles_root ON wiki_articles(root_slug)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_wiki_articles_category ON wiki_articles(category_slug)`),
  ]);
}

// === Archivist Hunt: Temporal Validity Migration ===
export async function runTemporalMigration(db: D1Database): Promise<void> {
  // D1 requires individual ALTER TABLE statements
  const alters = [
    `ALTER TABLE brain_nodes ADD COLUMN valid_from TEXT`,
    `ALTER TABLE brain_nodes ADD COLUMN valid_to TEXT`,
    `ALTER TABLE brain_nodes ADD COLUMN status TEXT DEFAULT 'active'`,
    `ALTER TABLE brain_nodes ADD COLUMN confidence REAL DEFAULT 1.0`,
    `ALTER TABLE brain_nodes ADD COLUMN superseded_by TEXT`,
  ];

  for (const sql of alters) {
    try {
      await db.prepare(sql).run();
    } catch (e) {
      // Column already exists — safe to skip
      if (!(e as Error).message.includes('duplicate column')) throw e;
    }
  }

  // Backfill existing nodes: set valid_from = created_at, status = active
  await db.prepare(
    `UPDATE brain_nodes SET valid_from = created_at, status = 'active' WHERE valid_from IS NULL`
  ).run();

  // New indexes for temporal queries
  await db.batch([
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_nodes_status ON brain_nodes(status)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_nodes_valid_from ON brain_nodes(valid_from)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_nodes_confidence ON brain_nodes(confidence)`),
  ]);
}
