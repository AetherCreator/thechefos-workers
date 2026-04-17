import { describe, it, expect } from "vitest";
import { findBestOpportunity } from "../strategies/rate-arb";

const gas = { ethereum_round_trip_usd: 15, l2_round_trip_usd: 0.5 };

describe("findBestOpportunity", () => {
  it("returns null with single row", () => {
    expect(findBestOpportunity("USDC", [
      { chain: "ethereum", protocol: "aave-v3", asset: "USDC", supply_apy: 0.05 },
    ], 10000, gas, 100)).toBeNull();
  });

  it("returns null when delta below threshold", () => {
    const rows = [
      { chain: "ethereum", protocol: "aave-v3", asset: "USDC", supply_apy: 0.05 },
      { chain: "arbitrum", protocol: "aave-v3", asset: "USDC", supply_apy: 0.051 },
    ];
    expect(findBestOpportunity("USDC", rows, 10000, gas, 100)).toBeNull();
  });

  it("detects cross-chain opportunity above threshold", () => {
    const rows = [
      { chain: "ethereum", protocol: "aave-v3",     asset: "USDC", supply_apy: 0.052 },
      { chain: "base",     protocol: "compound-v3", asset: "USDC", supply_apy: 0.073 },
      { chain: "polygon",  protocol: "yearn",       asset: "USDC", supply_apy: 0.081 },
    ];
    const opp = findBestOpportunity("USDC", rows, 10000, gas, 100);
    expect(opp).not.toBeNull();
    expect(opp!.target_protocol).toBe("yearn");
    expect(opp!.target_chain).toBe("polygon");
    expect(opp!.source_protocol).toBe("aave-v3");
    expect(opp!.source_chain).toBe("ethereum");
    expect(opp!.rate_delta_bps).toBe(290);
    // annual gain = 0.029 * 10000 = 290; gas = 15 + 0.5 = 15.5; net = 274.5; edge_bps = 274
    expect(opp!.net_edge_bps).toBeGreaterThanOrEqual(270);
    expect(opp!.net_edge_bps).toBeLessThanOrEqual(280);
  });

  it("gas eats small deltas", () => {
    // 5.0% → 5.5% on Ethereum round-trip = 50 bps gross, gas 30 bps on $10K → 20 bps net (below 100 floor)
    const rows = [
      { chain: "ethereum", protocol: "aave-v3",     asset: "USDC", supply_apy: 0.050 },
      { chain: "ethereum", protocol: "compound-v3", asset: "USDC", supply_apy: 0.055 },
    ];
    expect(findBestOpportunity("USDC", rows, 10000, gas, 100)).toBeNull();
  });
});
