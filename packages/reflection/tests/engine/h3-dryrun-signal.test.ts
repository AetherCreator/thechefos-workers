import { describe, it, expect } from "vitest";
import { computeH3DryRunSignal } from "../../src/engine/h3-dryrun-signal";
import type { AutoActionEntry } from "../../src/adapters/auto-actions";

function makeEntry(verdict: string, action = "complete_validator", source_path = "hunts/x/clue-1/COMPLETE.md"): AutoActionEntry {
  return { run_id: "x", date: "2026-05-22", verdict, action, source_path };
}

describe("computeH3DryRunSignal", () => {
  it("10 entries: 9 would_apply + 1 would_block_schema → recommendation flip_safe", () => {
    const entries: AutoActionEntry[] = [
      ...Array.from({ length: 9 }, () => makeEntry("applied")),
      makeEntry("blocked_schema"),
    ];
    const result = computeH3DryRunSignal(entries);
    expect(result.total_complete_md_pushes).toBe(10);
    expect(result.verdicts.would_apply).toBe(9);
    expect(result.verdicts.would_block_schema).toBe(1);
    expect(result.pre_flip_recommendation).toBe("flip_safe");
  });

  it("10 entries: 4 would_apply + 6 would_block → recommendation extend_grace", () => {
    const entries: AutoActionEntry[] = [
      ...Array.from({ length: 4 }, () => makeEntry("applied")),
      ...Array.from({ length: 3 }, () => makeEntry("blocked_schema")),
      ...Array.from({ length: 2 }, () => makeEntry("blocked_verifier")),
      makeEntry("blocked_push_unverified"),
    ];
    const result = computeH3DryRunSignal(entries);
    expect(result.total_complete_md_pushes).toBe(10);
    expect(result.verdicts.would_apply).toBe(4);
    expect(result.pre_flip_recommendation).toBe("extend_grace");
  });
});
