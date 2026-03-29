// packages/brain-graph/src/queries.ts

export interface QueryParams {
  domain?: string;
  type?: string;
  tag?: string;
  sort?: 'updated_at' | 'created_at' | 'connection_count';
  order?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
  insights_only?: boolean;
}

export interface NodeRow {
  id: string;
  title: string;
  domain: string;
  type: string;
  tags: string;
  created_at: string;
  updated_at: string;
  connection_count: number;
  is_insight: number;
  summary: string | null;
}

export interface ConnectionRow {
  id: number;
  source_id: string;
  target_id: string;
  relationship: string;
  created_at: string;
}

export function buildQuerySQL(params: QueryParams): { sql: string; bindings: unknown[]; countSql: string; countBindings: unknown[] } {
  const conditions: string[] = [];
  const bindings: unknown[] = [];

  if (params.domain) {
    conditions.push('domain = ?');
    bindings.push(params.domain);
  }
  if (params.type) {
    conditions.push('type = ?');
    bindings.push(params.type);
  }
  if (params.tag) {
    conditions.push("tags LIKE ?");
    bindings.push(`%"${params.tag}"%`);
  }
  if (params.insights_only) {
    conditions.push('is_insight = 1');
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const sort = params.sort ?? 'updated_at';
  const order = params.order ?? 'desc';
  const limit = Math.min(params.limit ?? 20, 100);
  const offset = params.offset ?? 0;

  const allowedSorts = ['updated_at', 'created_at', 'connection_count'];
  const safeSort = allowedSorts.includes(sort) ? sort : 'updated_at';
  const safeOrder = order === 'asc' ? 'ASC' : 'DESC';

  const sql = `SELECT * FROM brain_nodes ${where} ORDER BY ${safeSort} ${safeOrder} LIMIT ? OFFSET ?`;
  const countSql = `SELECT COUNT(*) as total FROM brain_nodes ${where}`;

  return {
    sql,
    bindings: [...bindings, limit, offset],
    countSql,
    countBindings: [...bindings],
  };
}

export function buildGraphSQL(params: { node_id?: string; domain?: string; min_connections?: number }): {
  nodesSql: string;
  nodesBindings: unknown[];
  edgesSql: string;
  edgesBindings: unknown[];
} {
  const nodeConditions: string[] = [];
  const nodeBindings: unknown[] = [];

  if (params.domain) {
    nodeConditions.push('domain = ?');
    nodeBindings.push(params.domain);
  }
  if (params.min_connections !== undefined) {
    nodeConditions.push('connection_count >= ?');
    nodeBindings.push(params.min_connections);
  }

  const nodeWhere = nodeConditions.length > 0 ? `WHERE ${nodeConditions.join(' AND ')}` : '';
  const nodesSql = `SELECT id, title, domain, type, connection_count FROM brain_nodes ${nodeWhere}`;

  let edgesSql: string;
  const edgesBindings: unknown[] = [];

  if (params.node_id) {
    edgesSql = `SELECT * FROM brain_connections WHERE source_id = ? OR target_id = ?`;
    edgesBindings.push(params.node_id, params.node_id);
  } else if (params.domain) {
    edgesSql = `SELECT bc.* FROM brain_connections bc
      INNER JOIN brain_nodes ns ON bc.source_id = ns.id
      INNER JOIN brain_nodes nt ON bc.target_id = nt.id
      WHERE ns.domain = ? OR nt.domain = ?`;
    edgesBindings.push(params.domain, params.domain);
  } else {
    edgesSql = `SELECT * FROM brain_connections`;
  }

  return { nodesSql, nodesBindings: nodeBindings, edgesSql, edgesBindings };
}

export const STATS_QUERIES = {
  totalNodes: `SELECT COUNT(*) as total FROM brain_nodes`,
  byDomain: `SELECT domain, COUNT(*) as count FROM brain_nodes GROUP BY domain ORDER BY count DESC`,
  byType: `SELECT type, COUNT(*) as count FROM brain_nodes GROUP BY type ORDER BY count DESC`,
  totalConnections: `SELECT COUNT(*) as total FROM brain_connections`,
  avgConnections: `SELECT AVG(connection_count) as avg FROM brain_nodes`,
  insightRatio: `SELECT CAST(SUM(is_insight) AS FLOAT) / COUNT(*) as ratio FROM brain_nodes`,
  mostConnected: `SELECT id, title, connection_count as connections FROM brain_nodes ORDER BY connection_count DESC LIMIT 10`,
};
