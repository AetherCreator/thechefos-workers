export interface CarpenterRunRow {
  run_id: string;
  hunt: string;
  clue: string;
  agent_variant: string;
  exit_reason: string;
  turn_count: number;
  tool_calls: number;
  work_commit: string | null;
  cost_usd: number | null;
  completed_at: string;
}

export interface HunterBaselineRow {
  run_id: string;
  hunt: string;
  clue: string;
  verdict: string;
  completed_at: string;
  [key: string]: unknown;
}

// C2 implements real SQL with date range from the ISO week.
export async function queryCarpenterRunsForWeek(
  _db: D1Database,
  _isoWeek: string
): Promise<CarpenterRunRow[]> {
  // TODO(C2): SELECT * FROM carpenter_runs WHERE completed_at >= ? AND completed_at < ?
  // using isoWeekToDateRange from auto-actions adapter.
  return [];
}

// C2 implements real SQL for hunter_baseline_runs.
export async function queryHunterBaselineForWeek(
  _db: D1Database,
  _isoWeek: string
): Promise<HunterBaselineRow[]> {
  // TODO(C2): SELECT * FROM hunter_baseline_runs WHERE completed_at >= ? AND completed_at < ?
  return [];
}
