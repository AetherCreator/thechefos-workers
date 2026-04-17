import type { Env } from "./assert-read-only";
import type { NormalizedRate } from "./aave-client";
import { ethCall } from "./rpc";

const SECONDS_PER_YEAR = 60 * 60 * 24 * 365;

type CometDeployment = {
  chain: string;
  rpc: keyof Env & string;  // env var key
  address: string;
  asset: "USDC" | "USDT";
};

const COMETS: CometDeployment[] = [
  { chain: "ethereum", rpc: "ETH_RPC_URL", address: "0xc3d688B66703497DAA19211EEdff47f25384cdc3", asset: "USDC" },
  { chain: "ethereum", rpc: "ETH_RPC_URL", address: "0x3Afdc9BCA9213A35503b077a6072F3D0d5AB0840", asset: "USDT" },
  { chain: "arbitrum", rpc: "ARBITRUM_RPC_URL", address: "0x9c4ec768c28520B50860ea7a15bd7213a9fF58bf", asset: "USDC" },
  { chain: "base",     rpc: "BASE_RPC_URL",     address: "0xb125E6687d4313864e53df431d5425969c15Eb2F", asset: "USDC" },
  { chain: "polygon",  rpc: "POLYGON_RPC_URL",  address: "0xF25212E676D1F7F89Cd72fFEe66158f541246445", asset: "USDC" },
];

function hexToBigInt(hex: string): bigint {
  return BigInt(hex === "0x" ? "0x0" : hex);
}

/**
 * Convert Compound's per-second rate (18-decimal) to annual APY.
 * The PROMPT spec calls this supplyRatePerSecondToApy for the math tests.
 * Actual Comet contract uses getSupplyRate(utilization) -> uint64 scaled by 1e18.
 */
export function supplyRatePerSecondToApy(ratePerSecondScaled: bigint): number {
  // rate_per_second = scaled / 1e18
  // APR = rate_per_second * SECONDS_PER_YEAR
  const aprScaled = ratePerSecondScaled * BigInt(SECONDS_PER_YEAR);  // still /1e18
  const apr = Number(aprScaled / BigInt(1e12)) / 1e6;  // preserve precision via staged divide
  return apr;
}

export async function fetchCompoundRates(env: Env): Promise<NormalizedRate[]> {
  const out: NormalizedRate[] = [];
  const results = await Promise.allSettled(
    COMETS.map(async (c) => {
      const rpcUrl = (env as unknown as Record<string, string>)[c.rpc];
      if (!rpcUrl) return null;

      // Step 1: getUtilization() → 0x7eb71131 → uint256 (18-decimal)
      const utilHex = await ethCall(rpcUrl, c.address, "0x7eb71131");
      const utilScaled = hexToBigInt(utilHex);

      // Step 2: getSupplyRate(uint256 utilization) → 0xd955759d → uint64 (18-decimal per-second)
      const utilParam = utilScaled.toString(16).padStart(64, "0");
      const rateHex = await ethCall(rpcUrl, c.address, "0xd955759d" + utilParam);
      const rateScaled = hexToBigInt(rateHex);

      const apy = supplyRatePerSecondToApy(rateScaled);
      if (apy < 0 || apy > 0.50) return null;
      return {
        chain: c.chain,
        protocol: "compound-v3" as const,
        asset: c.asset,
        supply_apy: apy,
        utilization: Number(utilScaled) / 1e18,
        metadata: { comet: c.address },
      };
    })
  );
  for (const r of results) {
    if (r.status === "fulfilled" && r.value) out.push(r.value);
  }
  return out;
}
