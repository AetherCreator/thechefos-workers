import { describe, it, expect } from "vitest";
import {
  queryCarpenterRunsForWeek,
  queryHunterBaselineForWeek,
} from "../../src/adapters/d1-queries";
import type { CarpenterRunRow } from "../../src/adapters/d1-queries";
import fixtureRows from "../fixtures/d1-carpenter-runs-sample.json";

function makeMockD1(rows: unknown[] = []): D1Database {
  return {
    prepare: (_sql: string) => ({
      bind: (..._args: unknown[]) => ({
        all: async () => ({ results: rows, success: true, meta: {} }),
      }),
    }),
  } as unknown as D1Database;
}

describe("queryCarpenterRunsForWeek (C1 stub)", () => {
  it("returns empty array on stub", async () => {
    const db = makeMockD1();
    const result = await queryCarpenterRunsForWeek(db, "2026-W21");
    expect(result).toEqual([]);
  });
});

describe("queryHunterBaselineForWeek (C1 stub)", () => {
  it("returns empty array on stub", async () => {
    const db = makeMockD1();
    const result = await queryHunterBaselineForWeek(db, "2026-W21");
    expect(result).toEqual([]);
  });
});

describe("CarpenterRunRow fixture shape validation", () => {
  it("fixture has 3 rows with expected fields", () => {
    expect(fixtureRows).toHaveLength(3);
  });

  it("first fixture row matches CarpenterRunRow shape", () => {
    const row = fixtureRows[0] as CarpenterRunRow;
    expect(typeof row.run_id).toBe("string");
    expect(typeof row.hunt).toBe("string");
    expect(typeof row.clue).toBe("string");
    expect(typeof row.exit_reason).toBe("string");
    expect(typeof row.turn_count).toBe("number");
    expect(typeof row.tool_calls).toBe("number");
    expect(typeof row.completed_at).toBe("string");
  });

  it("fixture rows allow null cost_usd and null work_commit", () => {
    const noCommit = fixtureRows.find((r) => (r as CarpenterRunRow).work_commit === null);
    const noCost = fixtureRows.find((r) => (r as CarpenterRunRow).cost_usd === null);
    expect(noCommit).toBeDefined();
    expect(noCost).toBeDefined();
  });
});
