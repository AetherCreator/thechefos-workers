import { isoWeekToDateRange } from "./auto-actions";

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

export async function queryCarpenterRunsForWeek(
  db: D1Database,
  isoWeek: string
): Promise<CarpenterRunRow[]> {
  const { start, end } = isoWeekToDateRange(isoWeek);
  // end is Sunday; add 1 day to make the upper bound exclusive (Monday of next week)
  const endExclusive = new Date(end + "T00:00:00Z");
  endExclusive.setUTCDate(endExclusive.getUTCDate() + 1);
  const endStr = endExclusive.toISOString().slice(0, 10) + "T00:00:00Z";

  const result = await db
    .prepare(
      `SELECT run_id, hunt, clue, agent_variant, exit_reason, turn_count, tool_calls,
              work_commit, cost_usd, completed_at
       FROM carpenter_runs
       WHERE completed_at >= ? AND completed_at < ?
       ORDER BY completed_at ASC`
    )
    .bind(start + "T00:00:00Z", endStr)
    .all<CarpenterRunRow>();

  return result.results ?? [];
}

export async function queryHunterBaselineForWeek(
  db: D1Database,
  isoWeek: string
): Promise<HunterBaselineRow[]> {
  const { start, end } = isoWeekToDateRange(isoWeek);
  const endExclusive = new Date(end + "T00:00:00Z");
  endExclusive.setUTCDate(endExclusive.getUTCDate() + 1);
  const endStr = endExclusive.toISOString().slice(0, 10) + "T00:00:00Z";

  const result = await db
    .prepare(
      `SELECT run_id, hunt, clue, verdict, completed_at
       FROM hunter_baseline_runs
       WHERE completed_at >= ? AND completed_at < ?
       ORDER BY completed_at ASC`
    )
    .bind(start + "T00:00:00Z", endStr)
    .all<HunterBaselineRow>();

  return result.results ?? [];
}
