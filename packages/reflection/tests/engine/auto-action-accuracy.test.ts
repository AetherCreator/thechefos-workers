import { describe, it, expect } from "vitest";
import { computeAutoActionAccuracy } from "../../src/engine/auto-action-accuracy";
import type { AutoActionEntry } from "../../src/adapters/auto-actions";

function makeEntry(verdict: string, action = "ops_board_complete"): AutoActionEntry {
  return { run_id: "x", date: "2026-05-22", verdict, action };
}

describe("computeAutoActionAccuracy", () => {
  it("32 applied + 8 blocked_schema → correct counts and applied_ratio via by_action", () => {
    const entries: AutoActionEntry[] = [
      ...Array.from({ length: 32 }, () => makeEntry("applied")),
      ...Array.from({ length: 8 }, () => makeEntry("blocked_schema")),
    ];
    const result = computeAutoActionAccuracy(entries);
    expect(result.total).toBe(40);
    expect(result.by_verdict["applied"]).toBe(32);
    expect(result.by_verdict["blocked_schema"]).toBe(8);
    const ratio = result.by_action["ops_board_complete"].ratio;
    expect(ratio).toBeCloseTo(0.8, 5);
  });

  it("unknown verdict 'weird_verdict' is flagged in flagged_drift[]", () => {
    const entries: AutoActionEntry[] = [
      makeEntry("applied"),
      makeEntry("weird_verdict"),
      makeEntry("applied"),
    ];
    const result = computeAutoActionAccuracy(entries);
    expect(result.flagged_drift).toContain("weird_verdict");
    expect(result.flagged_drift).not.toContain("applied");
  });

  it(">40% single-verdict spike on auto-promotion action emits notable observation", () => {
    const entries: AutoActionEntry[] = [
      ...Array.from({ length: 6 }, () => makeEntry("blocked_schema", "auto_promotion")),
      ...Array.from({ length: 4 }, () => makeEntry("applied", "auto_promotion")),
    ];
    const result = computeAutoActionAccuracy(entries);
    expect(result.notable.some((n) => n.includes("blocked_schema") && n.includes("auto-promotion"))).toBe(true);
  });
});
