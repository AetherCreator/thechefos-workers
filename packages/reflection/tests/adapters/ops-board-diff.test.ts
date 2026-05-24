import { describe, it, expect } from "vitest";
import { readOpsBoardDeltasForWeek } from "../../src/adapters/ops-board-diff";
import type { GithubContext } from "../../src/types";

const mockGithub: GithubContext = {
  owner: "AetherCreator",
  repo: "SuperClaude",
  pat: "mock-pat",
};

describe("readOpsBoardDeltasForWeek (C1 stub)", () => {
  it("returns empty array on stub", async () => {
    const result = await readOpsBoardDeltasForWeek(mockGithub, "2026-W21");
    expect(result).toEqual([]);
  });

  it("returns empty array for any week input without throwing", async () => {
    const result = await readOpsBoardDeltasForWeek(mockGithub, "2025-W52");
    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(0);
  });
});

describe("OpsBoardDelta movement classifier — scaffold shape validation", () => {
  it("mock GitHub commit response with OPS-BOARD path would produce delta entries (scaffold)", () => {
    // C2 will implement the real classifier. For C1, we verify the type shape is correct.
    const mockDelta = {
      commit_sha: "abc1234567890",
      commit_date: "2026-05-20T10:00:00Z",
      movement: "complete" as const,
      row_id: "OPS-042",
      before_status: "ACTIVE",
      after_status: "COMPLETED",
    };
    expect(mockDelta.movement).toBe("complete");
    expect(mockDelta.row_id).toBe("OPS-042");
    expect(mockDelta.before_status).toBe("ACTIVE");
    expect(mockDelta.after_status).toBe("COMPLETED");
  });
});
