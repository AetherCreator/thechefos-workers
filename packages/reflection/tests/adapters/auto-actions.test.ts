import { describe, it, expect } from "vitest";
import {
  readAutoActionsForWeek,
  parseAutoActionEntry,
  isoWeekToDateRange,
} from "../../src/adapters/auto-actions";
import type { GithubContext } from "../../src/types";

const mockGithub: GithubContext = {
  owner: "AetherCreator",
  repo: "SuperClaude",
  pat: "mock-pat",
};

describe("readAutoActionsForWeek (C1 stub)", () => {
  it("returns empty array when called (stub behavior)", async () => {
    const result = await readAutoActionsForWeek(mockGithub, "2026-W21");
    expect(result).toEqual([]);
  });
});

describe("isoWeekToDateRange", () => {
  it("parses 2026-W21 to correct Monday..Sunday range", () => {
    const { start, end } = isoWeekToDateRange("2026-W21");
    expect(start).toBe("2026-05-18");
    expect(end).toBe("2026-05-24");
  });

  it("parses 2026-W01 (first week of year) correctly", () => {
    const { start, end } = isoWeekToDateRange("2026-W01");
    // ISO week 1 of 2026: Jan 4 is a Sunday (dow=0→7), week1Monday = Jan 4 - 6 = Dec 29 2025
    expect(start).toBe("2025-12-29");
    expect(end).toBe("2026-01-04");
  });

  it("throws on invalid format", () => {
    expect(() => isoWeekToDateRange("2026-21")).toThrow("invalid ISO week");
  });
});

describe("parseAutoActionEntry — defensive parsing", () => {
  it("parses known verdict types correctly", () => {
    const entry = parseAutoActionEntry({
      run_id: "abc-123",
      date: "2026-05-22",
      verdict: "applied",
      action: "ops_board_complete",
      source_path: "hunts/x/clue-1/COMPLETE.md",
    });
    expect(entry.verdict).toBe("applied");
    expect(entry.run_id).toBe("abc-123");
  });

  it("passes unknown verdict types through without throwing", () => {
    const entry = parseAutoActionEntry({
      run_id: "xyz-999",
      date: "2026-05-22",
      verdict: "blocked_future_type_unknown",
      action: "complete_validator",
    });
    expect(entry.verdict).toBe("blocked_future_type_unknown");
  });

  it("preserves unknown extra fields defensively", () => {
    const entry = parseAutoActionEntry({
      run_id: "fff-000",
      date: "2026-05-22",
      verdict: "applied",
      action: "ops_board_complete",
      extra_field: "defensively_parsed",
      another_unknown: 42,
    });
    expect(entry["extra_field"]).toBe("defensively_parsed");
    expect(entry["another_unknown"]).toBe(42);
  });
});
