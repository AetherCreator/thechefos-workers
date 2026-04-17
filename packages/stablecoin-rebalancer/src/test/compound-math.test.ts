import { describe, it, expect } from "vitest";
import { supplyRatePerSecondToApy } from "../lib/compound-client";
import { extractYearnApy } from "../lib/yearn-client";

describe("supplyRatePerSecondToApy", () => {
  it("typical 5% APY — 1585489599 per second", () => {
    // 1585489599 / 1e18 * 31536000 ≈ 0.05
    const apy = supplyRatePerSecondToApy(BigInt("1585489599"));
    expect(apy).toBeCloseTo(0.05, 2);
  });
  it("zero rate returns 0", () => {
    expect(supplyRatePerSecondToApy(0n)).toBe(0);
  });
});

describe("extractYearnApy", () => {
  it("net_apy field", () => {
    expect(extractYearnApy({ address: "0x0", symbol: "yUSDC", name: "yUSDC", token: { symbol: "USDC" }, apy: { net_apy: 0.0523 } })).toBe(0.0523);
  });
  it("forwardAPY fallback", () => {
    expect(extractYearnApy({ address: "0x0", symbol: "yUSDC", name: "yUSDC", token: { symbol: "USDC" }, apy: { forwardAPY: { netAPY: 0.06 } } })).toBe(0.06);
  });
  it("historicalApy fallback", () => {
    expect(extractYearnApy({ address: "0x0", symbol: "yUSDC", name: "yUSDC", token: { symbol: "USDC" }, apy: { historicalApy: { oneMonthSample: 0.04 } } })).toBe(0.04);
  });
  it("empty apy object returns null", () => {
    expect(extractYearnApy({ address: "0x0", symbol: "yUSDC", name: "yUSDC", token: { symbol: "USDC" }, apy: {} })).toBeNull();
  });
  it("missing apy returns null", () => {
    expect(extractYearnApy({ address: "0x0", symbol: "yUSDC", name: "yUSDC", token: { symbol: "USDC" } })).toBeNull();
  });
});
