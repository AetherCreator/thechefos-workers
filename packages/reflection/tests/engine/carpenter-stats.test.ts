import { describe, it, expect } from "vitest";
import { computeCarpenterStats } from "../../src/engine/carpenter-stats";
import type { CarpenterRunRow } from "../../src/adapters/d1-queries";

function makeRow(overrides: Partial<CarpenterRunRow> = {}): CarpenterRunRow {
  return {
    run_id: "test-run",
    hunt: "test-hunt",
    clue: "1",
    agent_variant: "claude-sonnet-4-6",
    exit_reason: "complete",
    turn_count: 20,
    tool_calls: 60,
    work_commit: "abc123",
    cost_usd: 0.05,
    completed_at: "2026-05-22T10:00:00Z",
    ...overrides,
  };
}

describe("computeCarpenterStats", () => {
  it("empty input → all zeros, no notables", () => {
    const result = computeCarpenterStats([]);
    expect(result.total_runs).toBe(0);
    expect(result.by_exit_reason).toEqual({});
    expect(result.work_commit_null_rate).toBe(0);
    expect(result.cost_summary.total_usd).toBe(0);
    expect(result.cost_summary.avg_per_run).toBe(0);
    expect(result.notable).toHaveLength(0);
    expect(result.turn_count_distribution.min).toBe(0);
  });

  it("3 runs with 2 null work_commits → null rate = 0.66 emits notable", () => {
    const rows = [
      makeRow({ work_commit: null }),
      makeRow({ work_commit: null }),
      makeRow({ work_commit: "abc123" }),
    ];
    const result = computeCarpenterStats(rows);
    expect(result.work_commit_null_rate).toBeCloseTo(0.666, 2);
    expect(result.notable.some((n) => n.includes("work_commit null rate"))).toBe(true);
  });

  it("exit_reason histogram correctly counts each enum value", () => {
    const rows = [
      makeRow({ exit_reason: "complete" }),
      makeRow({ exit_reason: "complete" }),
      makeRow({ exit_reason: "max_turns" }),
      makeRow({ exit_reason: "error" }),
      makeRow({ exit_reason: "max_turns" }),
    ];
    const result = computeCarpenterStats(rows);
    expect(result.by_exit_reason["complete"]).toBe(2);
    expect(result.by_exit_reason["max_turns"]).toBe(2);
    expect(result.by_exit_reason["error"]).toBe(1);
    expect(result.turn_count_distribution.over_max_turns_count).toBe(2);
  });
});
