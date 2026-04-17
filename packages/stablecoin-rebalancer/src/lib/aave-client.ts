import type { Env } from "./assert-read-only";
import { ethCall } from "./rpc";

export interface NormalizedRate {
  chain: string;
  protocol: "aave-v3" | "compound-v3" | "yearn";
  asset: "USDC" | "USDT" | "DAI";
  supply_apy: number;
  utilization: number;
  metadata?: Record<string, unknown>;
}

/** Convert a 27-decimal ray string to APY decimal (e.g. 0.05 = 5%). */
export function rayRateToApy(rayStr: string): number {
  const ray = BigInt(rayStr);
  if (ray === 0n) return 0;
  // APY = ray / 1e27, scaled divide to preserve precision
  // ray / 1e27 = (ray / 1e21) / 1e6
  const scaled = ray / BigInt(1_000_000_000_000_000_000_000n); // / 1e21
  return Number(scaled) / 1_000_000; // / 1e6
}

/** Utilization = totalDebt / totalLiquidity. Kept for future use.
 *  totalLiquidity = total deposited (available + borrowed), Aave subgraph convention. */
export function computeUtilization(totalLiquidity: string, totalDebt: string): number {
  const liq = BigInt(totalLiquidity);
  const debt = BigInt(totalDebt);
  if (liq === 0n) return 0;
  // Cap at 100%
  const ratio = Number((debt * 10000n) / liq) / 10000;
  return Math.min(ratio, 1);
}

// Aave v3 Pool addresses per chain
const AAVE_POOLS: Record<string, string> = {
  ethereum: "0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2",
  arbitrum: "0x794a61358D6845594F94dc1DB02A252b5b4814aD",
  base:     "0xA238Dd80C259a72e81d7e4664a9801593F98d1c5",
  polygon:  "0x794a61358D6845594F94dc1DB02A252b5b4814aD",
};

// Asset addresses per chain
const ASSETS: Record<string, Record<"USDC" | "USDT" | "DAI", string | null>> = {
  ethereum: {
    USDC: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    USDT: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
    DAI:  "0x6B175474E89094C44Da98b954EedeAC495271d0F",
  },
  arbitrum: {
    USDC: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
    USDT: "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9",
    DAI:  "0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1",
  },
  base: {
    USDC: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    USDT: null, // may not be listed on Aave v3 Base
    DAI:  null, // may not be listed on Aave v3 Base
  },
  polygon: {
    USDC: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
    USDT: "0xc2132D05D31c914a87C6611C10748AEb04B58e8F",
    DAI:  "0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063",
  },
};

const RPC_KEYS: Record<string, keyof Env & string> = {
  ethereum: "ETH_RPC_URL",
  arbitrum: "ARBITRUM_RPC_URL",
  base:     "BASE_RPC_URL",
  polygon:  "POLYGON_RPC_URL",
};

// getReserveData(address) selector
const GET_RESERVE_DATA_SELECTOR = "0x35ea6a75";

function buildCalldata(assetAddress: string): string {
  // Strip 0x, pad to 32 bytes (12 zero bytes + 20 byte address)
  const addr = assetAddress.slice(2).toLowerCase().padStart(40, "0");
  return GET_RESERVE_DATA_SELECTOR + "000000000000000000000000" + addr;
}

async function fetchAaveRate(
  rpcUrl: string,
  poolAddress: string,
  assetAddress: string,
  chain: string,
  asset: "USDC" | "USDT" | "DAI"
): Promise<NormalizedRate | null> {
  const calldata = buildCalldata(assetAddress);
  const result = await ethCall(rpcUrl, poolAddress, calldata);
  
  // Strip 0x prefix
  const hex = result.slice(2);
  if (hex.length < 0x60 * 2) return null; // response too short
  
  // Slot 2 (offset 0x40): currentLiquidityRate (32 bytes)
  const rayHex = "0x" + hex.slice(0x40 * 2, 0x60 * 2);
  const ray = BigInt(rayHex);
  
  // If ray == 0, asset not listed on this market — skip
  if (ray === 0n) return null;
  
  const apy = rayRateToApy(ray.toString());
  
  // Sanity check
  if (apy < 0 || apy > 0.50) return null;
  
  return {
    chain,
    protocol: "aave-v3",
    asset,
    supply_apy: apy,
    utilization: 0, // not fetched in v1 — deviation noted
    metadata: { pool: poolAddress, asset_address: assetAddress },
  };
}

export async function fetchAaveRates(env: Env): Promise<NormalizedRate[]> {
  const tasks: Promise<NormalizedRate | null>[] = [];
  
  for (const [chain, poolAddress] of Object.entries(AAVE_POOLS)) {
    const rpcKey = RPC_KEYS[chain];
    const rpcUrl = (env as unknown as Record<string, string>)[rpcKey];
    if (!rpcUrl) continue;
    
    const chainAssets = ASSETS[chain];
    for (const [assetName, assetAddress] of Object.entries(chainAssets)) {
      if (!assetAddress) continue;
      tasks.push(
        fetchAaveRate(rpcUrl, poolAddress, assetAddress, chain, assetName as "USDC" | "USDT" | "DAI")
          .catch(() => null)
      );
    }
  }
  
  const results = await Promise.allSettled(tasks);
  const out: NormalizedRate[] = [];
  for (const r of results) {
    if (r.status === "fulfilled" && r.value) out.push(r.value);
  }
  return out;
}
