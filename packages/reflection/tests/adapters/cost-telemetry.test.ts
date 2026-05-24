import { describe, it, expect, vi, afterEach } from "vitest";
import { fetchCostTrajectory } from "../../src/adapters/cost-telemetry";
import rollupFixture from "../fixtures/cost-telemetry-rollup-W21.json";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("fetchCostTrajectory", () => {
  it("maps rollup JSON to CostTrajectory with correct traffic_light and total neurons", async () => {
    vi.stubGlobal("fetch", async () => ({
      ok: true,
      json: async () => rollupFixture,
    }));

    const result = await fetchCostTrajectory("http://mock");
    expect(result.traffic_light).toBe(rollupFixture.traffic_light);
    expect(result.current_week_neurons_used).toBe(rollupFixture.neurons_used_estimate);
    expect(result.current_week_neurons_cap).toBe(rollupFixture.neurons_cap);
    expect(result.previous_week_neurons_used).toBeNull();
  });

  it("computes by_persona usage from fire counts × per-fire costs", async () => {
    vi.stubGlobal("fetch", async () => ({
      ok: true,
      json: async () => rollupFixture,
    }));

    const result = await fetchCostTrajectory("http://mock");
    // locke: 1 fire × 3000 cap = 3000 used, cap = 3000 → 100%
    expect(result.by_persona["locke"].used).toBe(rollupFixture.locke_fires_today * 3000);
    expect(result.by_persona["locke"].cap).toBe(3000);
    // council: 2 fires × 900 = 1800 used, but cap is 900 so > 100%
    expect(result.by_persona["council"].used).toBe(rollupFixture.council_fires_today * 900);
    expect(result.by_persona["reviewer"].used).toBe(rollupFixture.reviewer_fires_today * 500);
  });

  it("throws on non-200 response from cost-telemetry", async () => {
    vi.stubGlobal("fetch", async () => ({
      ok: false,
      status: 502,
      statusText: "Bad Gateway",
    }));

    await expect(fetchCostTrajectory("http://mock")).rejects.toThrow("cost-telemetry fetch failed");
  });
});
