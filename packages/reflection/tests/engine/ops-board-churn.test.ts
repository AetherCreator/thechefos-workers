import { describe, it, expect } from "vitest";
import { computeOpsBoardChurn } from "../../src/engine/ops-board-churn";
import type { OpsBoardDelta } from "../../src/adapters/ops-board-diff";

describe("computeOpsBoardChurn", () => {
  it("5 commits: 3 complete + 2 claim → correct movement counts", () => {
    const deltas: OpsBoardDelta[] = [
      { commit_sha: "sha1", commit_date: "2026-05-18T10:00:00Z", movement: "complete", row_id: "OPS-001" },
      { commit_sha: "sha2", commit_date: "2026-05-19T10:00:00Z", movement: "complete", row_id: "OPS-002" },
      { commit_sha: "sha3", commit_date: "2026-05-20T10:00:00Z", movement: "claim", row_id: "OPS-003" },
      { commit_sha: "sha4", commit_date: "2026-05-21T10:00:00Z", movement: "claim", row_id: "OPS-004" },
      { commit_sha: "sha5", commit_date: "2026-05-22T10:00:00Z", movement: "complete", row_id: "OPS-005" },
    ];
    const result = computeOpsBoardChurn(deltas);
    expect(result.total_commits_touching_board).toBe(5);
    expect(result.movements.complete).toBe(3);
    expect(result.movements.claim).toBe(2);
    expect(result.movements.urgent_add).toBe(0);
    expect(result.movements.revert).toBe(0);
    expect(result.velocity.completes_per_day).toBeCloseTo(3 / 7, 2);
  });

  it("revert movement → notable observation emitted", () => {
    const deltas: OpsBoardDelta[] = [
      {
        commit_sha: "sha-revert",
        commit_date: "2026-05-23T12:00:00Z",
        movement: "revert",
        row_id: "OPS-REVERT-001",
        before_status: "COMPLETED",
        after_status: "ACTIVE",
      },
    ];
    const result = computeOpsBoardChurn(deltas);
    expect(result.movements.revert).toBe(1);
    expect(result.notable.some((n) => n.includes("revert"))).toBe(true);
    expect(result.notable.some((n) => n.includes("OPS-REVERT-001"))).toBe(true);
  });
});
