// packages/brain-graph/src/schema.ts

const CREATE_BRAIN_NODES = `
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
)`;

const CREATE_BRAIN_CONNECTIONS = `
CREATE TABLE IF NOT EXISTS brain_connections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id TEXT NOT NULL,
  target_id TEXT NOT NULL,
  relationship TEXT DEFAULT 'connects_to',
  created_at TEXT NOT NULL,
  UNIQUE(source_id, target_id, relationship)
)`;

const CREATE_BRAIN_PATTERNS = `
CREATE TABLE IF NOT EXISTS brain_patterns (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  domains TEXT NOT NULL DEFAULT '[]',
  node_ids TEXT NOT NULL DEFAULT '[]',
  status TEXT DEFAULT 'candidate',
  first_seen TEXT NOT NULL,
  graduated_at TEXT
)`;

const CREATE_INDEXES = [
  `CREATE INDEX IF NOT EXISTS idx_nodes_domain ON brain_nodes(domain)`,
  `CREATE INDEX IF NOT EXISTS idx_nodes_type ON brain_nodes(type)`,
  `CREATE INDEX IF NOT EXISTS idx_nodes_updated_at ON brain_nodes(updated_at)`,
  `CREATE INDEX IF NOT EXISTS idx_connections_source ON brain_connections(source_id)`,
  `CREATE INDEX IF NOT EXISTS idx_connections_target ON brain_connections(target_id)`,
];

export async function runMigrations(db: D1Database): Promise<{ tables_created: string[]; indexes_created: number }> {
  await db.batch([
    db.prepare(CREATE_BRAIN_NODES),
    db.prepare(CREATE_BRAIN_CONNECTIONS),
    db.prepare(CREATE_BRAIN_PATTERNS),
    ...CREATE_INDEXES.map(sql => db.prepare(sql)),
  ]);

  return {
    tables_created: ['brain_nodes', 'brain_connections', 'brain_patterns'],
    indexes_created: CREATE_INDEXES.length,
  };
}
