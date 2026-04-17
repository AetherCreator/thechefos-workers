import type { Env } from "./assert-read-only";

export interface RateSnapshot {
  chain: string;
  protocol: string;
  asset: string;
  supply_apy: number;
  utilization: number | null;
  metadata_json?: string | null;
}

export async function writeSnapshotBatch(env: Env, batchId: string, rows: RateSnapshot[]): Promise<number> {
  if (rows.length === 0) return 0;
  const now = Date.now();
  const stmts = rows.map(r =>
    env.DB.prepare(
      `INSERT INTO rate_snapshots (chain, protocol, asset, supply_apy, utilization, snapshot_ts, batch_id, metadata_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      r.chain, r.protocol, r.asset, r.supply_apy,
      r.utilization ?? null, now, batchId, r.metadata_json ?? null
    )
  );
  await env.DB.batch(stmts);
  return rows.length;
}

export async function latestSnapshotsByAsset(env: Env, asset: string) {
  // Latest batch per asset
  const r = await env.DB.prepare(
    `SELECT chain, protocol, asset, supply_apy, utilization, snapshot_ts
       FROM rate_snapshots
      WHERE asset = ?
        AND snapshot_ts = (SELECT MAX(snapshot_ts) FROM rate_snapshots WHERE asset = ?)`
  ).bind(asset, asset).all();
  return r.results;
}

export interface ScannerRun {
  scanner: string;
  started_ts: number;
  duration_ms: number;
  status: 'ok' | 'error' | 'partial';
  rows_written?: number;
  error_msg?: string | null;
}

export async function logScannerRun(env: Env, r: ScannerRun): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO scanner_runs (scanner, started_ts, duration_ms, status, rows_written, error_msg)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(r.scanner, r.started_ts, r.duration_ms, r.status, r.rows_written ?? 0, r.error_msg ?? null).run();
}
