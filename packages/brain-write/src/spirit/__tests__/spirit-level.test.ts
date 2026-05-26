import { describe, it, expect, beforeEach } from "vitest";
import { levelToTier, clampLevel } from "../helpers";
import { defaultState, LevelSetPayloadSchema, ANCHOR_LEVEL, HISTORY_MAX } from "../schema";
import { readLevel, setLevel } from "..";

class MockKV {
  store = new Map<string, string>();
  async get(key: string, type?: string): Promise<unknown> {
    const raw = this.store.get(key);
    if (!raw) return null;
    if (type === "json") return JSON.parse(raw);
    return raw;
  }
  async put(key: string, value: string): Promise<void> {
    this.store.set(key, value);
  }
}

describe("levelToTier", () => {
  it("maps 0..2 to stormy", () => {
    expect(levelToTier(0)).toBe("stormy");
    expect(levelToTier(2)).toBe("stormy");
  });
  it("maps 3..4 to cautious", () => {
    expect(levelToTier(3)).toBe("cautious");
    expect(levelToTier(4)).toBe("cautious");
  });
  it("maps 5..7 to steady (anchor inclusive)", () => {
    expect(levelToTier(5)).toBe("steady");
    expect(levelToTier(7)).toBe("steady");
  });
  it("maps 8..10 to confident", () => {
    expect(levelToTier(8)).toBe("confident");
    expect(levelToTier(10)).toBe("confident");
  });
});

describe("clampLevel", () => {
  it("clamps high to 10", () => expect(clampLevel(15)).toBe(10));
  it("clamps low to 0", () => expect(clampLevel(-3)).toBe(0));
  it("returns 7 for NaN", () => expect(clampLevel(NaN)).toBe(7));
});

describe("defaultState", () => {
  it("returns anchor=7, steady, history.length=1", () => {
    const s = defaultState();
    expect(s.level).toBe(ANCHOR_LEVEL);
    expect(s.tier).toBe("steady");
    expect(s.last_source).toBe("anchor_init");
    expect(s.history.length).toBe(1);
  });
});

describe("LevelSetPayloadSchema", () => {
  it("accepts valid payload", () => {
    expect(LevelSetPayloadSchema.safeParse({ level: 8, source: "tyler_override" }).success).toBe(true);
  });
  it("rejects out-of-range level", () => {
    expect(LevelSetPayloadSchema.safeParse({ level: 15, source: "tyler_override" }).success).toBe(false);
  });
  it("rejects unknown source", () => {
    expect(LevelSetPayloadSchema.safeParse({ level: 8, source: "bogus" }).success).toBe(false);
  });
});

describe("readLevel + setLevel integration", () => {
  let env: { SPIRIT_LEVEL_KV: MockKV };
  beforeEach(() => {
    env = { SPIRIT_LEVEL_KV: new MockKV() };
  });

  it("readLevel returns default state on empty KV", async () => {
    const s = await readLevel(env as any);
    expect(s.level).toBe(7);
    expect(s.tier).toBe("steady");
  });

  it("setLevel persists, readLevel returns updated state", async () => {
    await setLevel(env as any, { level: 8, source: "tyler_override" });
    const s = await readLevel(env as any);
    expect(s.level).toBe(8);
    expect(s.tier).toBe("confident");
  });

  it("setLevel 12 times FIFO-trims history to HISTORY_MAX", async () => {
    for (let i = 0; i < 12; i++) {
      await setLevel(env as any, { level: i % 11, source: "manual_correction" });
    }
    const s = await readLevel(env as any);
    expect(s.history.length).toBe(HISTORY_MAX);
  });
});
