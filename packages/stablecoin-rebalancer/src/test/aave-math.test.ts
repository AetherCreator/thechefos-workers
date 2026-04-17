import { describe, it, expect } from "vitest";
import { rayRateToApy, computeUtilization } from "../lib/aave-client";

describe("rayRateToApy", () => {
  it("zero rate", () => {
    expect(rayRateToApy("0")).toBe(0);
  });
  it("5% APY (5e25 ray)", () => {
    // 5% in ray = 0.05 * 1e27 = 5e25
    const apy = rayRateToApy("50000000000000000000000000");
    expect(apy).toBeCloseTo(0.05, 3);
  });
  it("12.34% APY", () => {
    const apy = rayRateToApy("123400000000000000000000000");
    expect(apy).toBeCloseTo(0.1234, 3);
  });
});

describe("computeUtilization", () => {
  it("zero liquidity", () => {
    expect(computeUtilization("0", "0")).toBe(0);
  });
  it("70% utilization", () => {
    expect(computeUtilization("1000000", "700000")).toBeCloseTo(0.70, 3);
  });
  it("caps at 100%", () => {
    expect(computeUtilization("100", "200")).toBeLessThanOrEqual(1);
  });
});
