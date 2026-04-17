import type { NormalizedRate } from "./aave-client";

const YEARN_CHAIN_IDS: Record<string, number> = {
  ethereum: 1, arbitrum: 42161, base: 8453, polygon: 137,
};

interface YearnVault {
  address: string;
  symbol: string;
  name: string;
  token: { symbol: string };
  apy?: {
    net_apy?: number;
    forwardAPY?: { netAPY?: number };
    historicalApy?: { oneMonthSample?: number };
  };
  type?: string;  // e.g. "v2", "v3"
  details?: { isDeprecated?: boolean; isRetired?: boolean };
}

/** Extract APY via fallback ladder. Yearn changes this field shape periodically. */
export function extractYearnApy(v: YearnVault): number | null {
  const apy = v.apy;
  if (!apy) return null;
  if (typeof apy.net_apy === "number") return apy.net_apy;
  if (typeof apy.forwardAPY?.netAPY === "number") return apy.forwardAPY.netAPY;
  if (typeof apy.historicalApy?.oneMonthSample === "number") return apy.historicalApy.oneMonthSample;
  return null;
}

function normalizeYearnAsset(tokenSymbol: string): "USDC" | "USDT" | "DAI" | null {
  const s = tokenSymbol.toUpperCase();
  if (s === "USDC" || s === "USDC.E" || s === "USDCN") return "USDC";
  if (s === "USDT") return "USDT";
  if (s === "DAI") return "DAI";
  return null;
}

export async function fetchYearnRates(): Promise<NormalizedRate[]> {
  const out: NormalizedRate[] = [];
  const results = await Promise.allSettled(
    Object.entries(YEARN_CHAIN_IDS).map(async ([chain, chainId]) => {
      const url = `https://api.yearn.fi/v1/chains/${chainId}/vaults/all`;
      const r = await fetch(url);
      if (!r.ok) throw new Error(`yearn ${chain} ${r.status}`);
      const vaults = await r.json() as YearnVault[];
      return vaults
        .filter(v => !v.details?.isDeprecated && !v.details?.isRetired)
        .map(v => {
          const asset = normalizeYearnAsset(v.token.symbol);
          const apy = extractYearnApy(v);
          if (!asset || apy === null || apy < 0 || apy > 0.50) return null;
          return {
            chain,
            protocol: "yearn" as const,
            asset,
            supply_apy: apy,
            utilization: 0,  // not applicable to vaults
            metadata: { vault: v.address, vault_name: v.name },
          };
        })
        .filter((x): x is NormalizedRate => x !== null);
    })
  );
  // Dedupe: keep highest APY per (chain, asset)
  const best = new Map<string, NormalizedRate>();
  for (const r of results) {
    if (r.status !== "fulfilled") continue;
    for (const row of r.value) {
      const key = `${row.chain}:${row.asset}`;
      const prev = best.get(key);
      if (!prev || row.supply_apy > prev.supply_apy) best.set(key, row);
    }
  }
  for (const v of best.values()) out.push(v);
  return out;
}
