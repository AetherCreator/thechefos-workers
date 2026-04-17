import type { Env } from "./assert-read-only";

const AAVE_SUBGRAPHS: Record<string, string> = {
  ethereum: "https://api.thegraph.com/subgraphs/name/aave/protocol-v3",
  arbitrum: "https://api.thegraph.com/subgraphs/name/aave/protocol-v3-arbitrum",
  base:     "https://api.thegraph.com/subgraphs/name/aave/protocol-v3-base",
  polygon:  "https://api.thegraph.com/subgraphs/name/aave/protocol-v3-polygon",
};

const QUERY = `
  query StablecoinReserves {
    reserves(
      where: { symbol_in: ["USDC", "USDT", "DAI", "USDCn"] }
      first: 20
    ) {
      symbol
      name
      decimals
      liquidityRate
      totalLiquidity
      totalCurrentVariableDebt
      usageAsCollateralEnabled
      isActive
      isFrozen
    }
  }
`;

export interface AaveReserve {
  symbol: string;
  name: string;
  liquidityRate: string;    // ray
  totalLiquidity: string;
  totalCurrentVariableDebt: string;
  isActive: boolean;
  isFrozen: boolean;
}

/** Convert Aave's liquidityRate (ray = 1e27 fixed point) to APY decimal. */
export function rayRateToApy(rayStr: string): number {
  // Aave's liquidityRate is already annualized in ray units.
  // APY = liquidityRate / 1e27. Continuous compounding is the display.
  const ray = BigInt(rayStr);
  // Convert via string to avoid precision loss: divide by 1e27 after mult by 1e6
  const scaled = Number(ray / BigInt(1e15)) / 1e12;  // preserves ~12 sig figs
  return scaled;
}

/** Compute utilization = totalDebt / totalLiquidity. Both are in base units (bigints). */
export function computeUtilization(totalLiquidity: string, totalDebt: string): number {
  const liq = BigInt(totalLiquidity);
  const debt = BigInt(totalDebt);
  if (liq === 0n) return 0;
  // Scale to 4 decimals for ratio
  const ratio = Number((debt * 10000n) / liq) / 10000;
  return Math.min(ratio, 1);
}

export interface NormalizedRate {
  chain: string;
  protocol: "aave-v3";
  asset: "USDC" | "USDT" | "DAI";
  supply_apy: number;
  utilization: number;
  metadata?: Record<string, unknown>;
}

function normalizeSymbol(sym: string): "USDC" | "USDT" | "DAI" | null {
  const s = sym.toUpperCase();
  if (s === "USDC" || s === "USDCN") return "USDC";
  if (s === "USDT") return "USDT";
  if (s === "DAI") return "DAI";
  return null;
}

/** Fetch rates from one chain. Returns [] on error. */
async function fetchAaveChainRates(chain: string, endpoint: string): Promise<NormalizedRate[]> {
  const r = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: QUERY }),
  });
  if (!r.ok) {
    console.error(`aave ${chain} subgraph ${r.status}`);
    return [];
  }
  const data = await r.json() as { data?: { reserves?: AaveReserve[] }, errors?: unknown };
  const reserves = data.data?.reserves ?? [];
  const out: NormalizedRate[] = [];
  const seen = new Set<string>();
  for (const res of reserves) {
    if (!res.isActive || res.isFrozen) continue;
    const sym = normalizeSymbol(res.symbol);
    if (!sym) continue;
    if (seen.has(sym)) continue;   // prefer first hit per chain (usually native)
    seen.add(sym);
    const apy = rayRateToApy(res.liquidityRate);
    if (apy < 0 || apy > 0.50) continue; // sanity filter
    out.push({
      chain,
      protocol: "aave-v3",
      asset: sym,
      supply_apy: apy,
      utilization: computeUtilization(res.totalLiquidity, res.totalCurrentVariableDebt),
      metadata: { raw_symbol: res.symbol },
    });
  }
  return out;
}

export async function fetchAaveRates(env: Env): Promise<NormalizedRate[]> {
  const results = await Promise.allSettled(
    Object.entries(AAVE_SUBGRAPHS).map(([chain, ep]) => fetchAaveChainRates(chain, ep))
  );
  const all: NormalizedRate[] = [];
  for (const r of results) {
    if (r.status === "fulfilled") all.push(...r.value);
  }
  return all;
}
