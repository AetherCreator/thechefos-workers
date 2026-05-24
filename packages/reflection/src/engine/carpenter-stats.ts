import type { CarpenterRunRow } from "../adapters/d1-queries";
import type { CarpenterStats } from "../digest/schema";

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.floor(p * (sorted.length - 1));
  return sorted[idx];
}

export function computeCarpenterStats(rows: CarpenterRunRow[]): CarpenterStats {
  const total_runs = rows.length;
  const by_exit_reason: Record<string, number> = {};
  const variant_breakdown: Record<string, { runs: number; completes: number }> = {};
  const notable: string[] = [];

  if (total_runs === 0) {
    return {
      total_runs: 0,
      by_exit_reason: {},
      turn_count_distribution: { min: 0, p25: 0, median: 0, p75: 0, max: 0, over_max_turns_count: 0 },
      work_commit_null_rate: 0,
      cost_summary: { total_usd: 0, avg_per_run: 0, null_cost_rows: 0 },
      variant_breakdown: {},
      notable: [],
    };
  }

  let null_commit_count = 0;
  let null_cost_count = 0;
  let total_cost = 0;
  let cost_rows = 0;
  const turn_counts: number[] = [];
  let over_max_turns_count = 0;

  for (const r of rows) {
    by_exit_reason[r.exit_reason] = (by_exit_reason[r.exit_reason] ?? 0) + 1;

    if (!variant_breakdown[r.agent_variant]) {
      variant_breakdown[r.agent_variant] = { runs: 0, completes: 0 };
    }
    variant_breakdown[r.agent_variant].runs++;
    if (r.exit_reason === "complete") {
      variant_breakdown[r.agent_variant].completes++;
    }

    if (r.work_commit === null) null_commit_count++;

    if (r.cost_usd === null) {
      null_cost_count++;
    } else {
      total_cost += r.cost_usd;
      cost_rows++;
    }

    turn_counts.push(r.turn_count);

    if (r.exit_reason === "max_turns") {
      over_max_turns_count++;
    }
  }

  turn_counts.sort((a, b) => a - b);

  const work_commit_null_rate = null_commit_count / total_runs;
  const complete_count = by_exit_reason["complete"] ?? 0;

  if (work_commit_null_rate > 0.3) {
    notable.push(
      `work_commit null rate is ${(work_commit_null_rate * 100).toFixed(0)}% (${null_commit_count}/${total_runs} runs) — substrate-fiction risk: agents finishing without committing`
    );
  }

  if (over_max_turns_count > complete_count) {
    notable.push(
      `max_turns exits (${over_max_turns_count}) exceed complete exits (${complete_count}) — rig hitting turn budgets, see OPS-CARPENTER-RUNNER-MAX-TURNS-TUNING`
    );
  }

  return {
    total_runs,
    by_exit_reason,
    turn_count_distribution: {
      min: turn_counts[0],
      p25: percentile(turn_counts, 0.25),
      median: percentile(turn_counts, 0.5),
      p75: percentile(turn_counts, 0.75),
      max: turn_counts[turn_counts.length - 1],
      over_max_turns_count,
    },
    work_commit_null_rate,
    cost_summary: {
      total_usd: Math.round(total_cost * 10000) / 10000,
      avg_per_run: cost_rows > 0 ? Math.round((total_cost / cost_rows) * 10000) / 10000 : 0,
      null_cost_rows: null_cost_count,
    },
    variant_breakdown,
    notable,
  };
}
