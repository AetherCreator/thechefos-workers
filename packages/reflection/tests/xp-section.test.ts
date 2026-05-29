import { describe, it, expect } from "vitest";
import { queryXpHotCold, renderXpDigestSection } from "../src/digest/xp-section";
import type { XpDigestNode } from "../src/digest/xp-section";

type XpRow = { path: string; xp: number; last_touched_at: string };

function makeMockD1(
  descRows: XpRow[],
  ascRows: XpRow[],
): D1Database {
  return {
    prepare: (sql: string) => ({
      bind: (_n: unknown) => ({
        all: async () => ({
          results: sql.includes("DESC") ? descRows : ascRows,
          success: true,
          meta: {},
        }),
      }),
    }),
  } as unknown as D1Database;
}

const NOW = new Date("2026-01-28T00:00:00Z");
const RECENT = "2026-01-27T00:00:00Z";
const OLD = "2025-06-01T00:00:00Z";

describe("XP digest — hot section", () => {
  it("returns top-N nodes with highest XP and correct effective computation", async () => {
    const hotRows: XpRow[] = [
      { path: "brain/a.md", xp: 100, last_touched_at: RECENT },
      { path: "brain/b.md", xp: 60, last_touched_at: RECENT },
    ];
    const coldRows: XpRow[] = [
      { path: "brain/c.md", xp: 5, last_touched_at: OLD },
    ];
    const db = makeMockD1(hotRows, coldRows);

    const { hot } = await queryXpHotCold(db, 2, 1, NOW);

    expect(hot).toHaveLength(2);
    expect(hot[0].path).toBe("brain/a.md");
    expect(hot[0].xp).toBe(100);
    // effective < raw because time has passed
    expect(hot[0].effective).toBeLessThanOrEqual(hot[0].xp);
    expect(hot[0].effective).toBeGreaterThan(0);
  });
});

describe("XP digest — cold section", () => {
  it("returns bottom-N nodes with lowest XP and decayed effective", async () => {
    const hotRows: XpRow[] = [
      { path: "brain/a.md", xp: 80, last_touched_at: RECENT },
    ];
    const coldRows: XpRow[] = [
      { path: "brain/z.md", xp: 2, last_touched_at: OLD },
      { path: "brain/y.md", xp: 4, last_touched_at: OLD },
    ];
    const db = makeMockD1(hotRows, coldRows);

    const { cold } = await queryXpHotCold(db, 1, 2, NOW);

    expect(cold).toHaveLength(2);
    expect(cold[0].path).toBe("brain/z.md");
    expect(cold[0].xp).toBe(2);
    // old nodes have heavily decayed effective XP
    expect(cold[0].effective).toBeLessThan(cold[0].xp);
  });
});

describe("XP digest — empty brain_xp", () => {
  it("returns empty hot/cold and renders no-data placeholder without throwing", async () => {
    const db = makeMockD1([], []);

    const { hot, cold } = await queryXpHotCold(db, 5, 5, NOW);

    expect(hot).toHaveLength(0);
    expect(cold).toHaveLength(0);

    const section = renderXpDigestSection(hot, cold);
    expect(section).toContain("No XP data yet");
    expect(section).not.toContain("undefined");
  });
});
