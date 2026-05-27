import { describe, it, expect } from "vitest";
import { readSpiritTierForAudit } from "../middleware-hook";

class MockKV {
  private store = new Map<string, string>();
  constructor(initial?: Record<string, unknown>) {
    if (initial) {
      for (const [k, v] of Object.entries(initial)) {
        this.store.set(k, JSON.stringify(v));
      }
    }
  }
  async get(key: string, _type?: "json") {
    const raw = this.store.get(key);
    if (raw === undefined) return null;
    return JSON.parse(raw);
  }
  async put(key: string, value: string) { this.store.set(key, value); }
  async delete(key: string) { this.store.delete(key); }
}

class ThrowingKV {
  async get() { throw new Error("kv_unreachable"); }
  async put() { throw new Error("kv_unreachable"); }
  async delete() { throw new Error("kv_unreachable"); }
}

describe("readSpiritTierForAudit", () => {
  it("returns current tier on happy path", async () => {
    const kv = new MockKV({
      current: {
        level: 8,
        tier: "confident",
        last_updated_at: "2026-05-26T00:00:00Z",
        last_source: "manual",
        history: [],
      },
    });
    const tier = await readSpiritTierForAudit({ SPIRIT_LEVEL_KV: kv as any });
    expect(tier).toBe("confident");
  });

  it("returns 'steady' on KV miss (defaultState anchor)", async () => {
    const kv = new MockKV();
    const tier = await readSpiritTierForAudit({ SPIRIT_LEVEL_KV: kv as any });
    expect(tier).toBe("steady");
  });

  it("returns 'steady' on KV exception (never throws)", async () => {
    const kv = new ThrowingKV();
    const tier = await readSpiritTierForAudit({ SPIRIT_LEVEL_KV: kv as any });
    expect(tier).toBe("steady");
  });
});
