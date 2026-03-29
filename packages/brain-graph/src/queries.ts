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

export function buildNodeQuery(params: QueryParams): { sql: string; bindings: unknown[] } {
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
    conditions.push("tags LIKE '%' || ? || '%'");
    bindings.push(params.tag);
  }
  if (params.insights_only) {
    conditions.push('is_insight = 1');
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const sort = params.sort || 'updated_at';
  const order = params.order || 'desc';
  const limit = Math.min(params.limit || 20, 100);
  const offset = params.offset || 0;

  const sql = `SELECT * FROM brain_nodes ${where} ORDER BY ${sort} ${order} LIMIT ? OFFSET ?`;
  bindings.push(limit, offset);

  return { sql, bindings };
}

export function buildCountQuery(params: QueryParams): { sql: string; bindings: unknown[] } {
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
    conditions.push("tags LIKE '%' || ? || '%'");
    bindings.push(params.tag);
  }
  if (params.insights_only) {
    conditions.push('is_insight = 1');
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  return { sql: `SELECT COUNT(*) as total FROM brain_nodes ${where}`, bindings };
}

export function buildGraphQuery(params: {
  node_id?: string;
  domain?: string;
  min_connections?: number;
}): { nodesSql: string; nodeBindings: unknown[]; edgesSql: string; edgeBindings: unknown[] } {
  const nodeConditions: string[] = [];
  const nodeBindings: unknown[] = [];
  const edgeConditions: string[] = [];
  const edgeBindings: unknown[] = [];

  if (params.domain) {
    nodeConditions.push('n.domain = ?');
    nodeBindings.push(params.domain);
  }
  if (params.min_connections !== undefined) {
    nodeConditions.push('n.connection_count >= ?');
    nodeBindings.push(params.min_connections);
  }

  if (params.node_id) {
    // Get the specific node plus its neighbors
    const nodeWhere = nodeConditions.length > 0 ? `AND ${nodeConditions.join(' AND ')}` : '';
    const nodesSql = `
      SELECT DISTINCT n.* FROM brain_nodes n
      LEFT JOIN brain_connections c ON n.id = c.source_id OR n.id = c.target_id
      WHERE (n.id = ? OR c.source_id = ? OR c.target_id = ?) ${nodeWhere}
    `;
    const edgesSql = `
      SELECT * FROM brain_connections
      WHERE source_id = ? OR target_id = ?
    `;
    return {
      nodesSql,
      nodeBindings: [params.node_id, params.node_id, params.node_id, ...nodeBindings],
      edgesSql,
      edgeBindings: [params.node_id, params.node_id],
    };
  }

  const nodeWhere = nodeConditions.length > 0 ? `WHERE ${nodeConditions.join(' AND ')}` : '';
  const nodesSql = `SELECT * FROM brain_nodes ${nodeWhere}`;

  // Get edges for matching nodes
  if (params.domain) {
    const edgesSql = `
      SELECT c.* FROM brain_connections c
      JOIN brain_nodes n1 ON c.source_id = n1.id
      JOIN brain_nodes n2 ON c.target_id = n2.id
      WHERE n1.domain = ? OR n2.domain = ?
    `;
    return { nodesSql, nodeBindings, edgesSql, edgeBindings: [params.domain, params.domain] };
  }

  return {
    nodesSql,
    nodeBindings,
    edgesSql: 'SELECT * FROM brain_connections',
    edgeBindings: [],
  };
}
