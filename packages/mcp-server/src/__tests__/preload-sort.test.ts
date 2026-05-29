import { describe, it, expect, vi, afterEach } from "vitest";
import { fetchXpMap, sortByEffectiveXp } from "../enrich";
import type { BrainContext } from "../enrich";

afterEach(() => vi.restoreAllMocks());

describe("preload sort — effective-XP bias", () => {
  it("sorts results by effective-XP high first", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (url: string) => {
        const path = new URL(url).searchParams.get("path") ?? "";
        const effective =
          path.includes("brain/a") ? 100 : path.includes("brain/b") ? 50 : 10;
        return {
          ok: true,
          json: async () => ({ effective }),
        } as unknown as Response;
      }),
    );

    const results: BrainContext[] = [
      { path: "brain/c.md", score: 90, preview: "" },
      { path: "brain/a.md", score: 80, preview: "" },
      { path: "brain/b.md", score: 70, preview: "" },
    ];

    const xpMap = await fetchXpMap(results.map((r) => r.path));
    const sorted = sortByEffectiveXp(results, xpMap);

    expect(sorted.map((r) => r.path)).toEqual([
      "brain/a.md",
      "brain/b.md",
      "brain/c.md",
    ]);
  });

  it("cold-start — empty xpMap preserves original (recency) order, no error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({}),
      } as unknown as Response),
    );

    const results: BrainContext[] = [
      { path: "brain/a.md", score: 80, preview: "" },
      { path: "brain/b.md", score: 70, preview: "" },
    ];

    const xpMap = await fetchXpMap(results.map((r) => r.path));
    // xpMap empty → sortByEffectiveXp returns original order
    const sorted = sortByEffectiveXp(results, xpMap);

    expect(xpMap.size).toBe(0);
    expect(sorted.map((r) => r.path)).toEqual(["brain/a.md", "brain/b.md"]);
  });

  it("xp-read network error → fetchXpMap resolves with empty map, preload still returns", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("network failure")),
    );

    const results: BrainContext[] = [
      { path: "brain/x.md", score: 99, preview: "hi" },
    ];

    const xpMap = await fetchXpMap(results.map((r) => r.path));
    expect(xpMap.size).toBe(0);

    const sorted = sortByEffectiveXp(results, xpMap);
    expect(sorted).toHaveLength(1);
    expect(sorted[0].path).toBe("brain/x.md");
  });
});
