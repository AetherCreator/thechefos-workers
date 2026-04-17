#!/usr/bin/env node
// One-off probe to verify live Aave subgraph data

const AAVE_SUBGRAPHS = {
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
      liquidityRate
      totalLiquidity
      totalCurrentVariableDebt
      isActive
      isFrozen
    }
  }
`;

function rayRateToApy(rayStr) {
  const ray = BigInt(rayStr);
  const scaled = Number(ray / BigInt(1e15)) / 1e12;
  return scaled;
}

function computeUtilization(totalLiquidity, totalDebt) {
  const liq = BigInt(totalLiquidity);
  const debt = BigInt(totalDebt);
  if (liq === 0n) return 0;
  const ratio = Number((debt * 10000n) / liq) / 10000;
  return Math.min(ratio, 1);
}

async function probe(chain, endpoint) {
  try {
    const r = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: QUERY }),
    });
    if (!r.ok) {
      console.log(`${chain}: HTTP ${r.status}`);
      return [];
    }
    const data = await r.json();
    if (data.errors) {
      console.log(`${chain}: GraphQL errors`, JSON.stringify(data.errors));
      return [];
    }
    const reserves = data.data?.reserves ?? [];
    return reserves
      .filter(res => res.isActive && !res.isFrozen)
      .map(res => ({
        chain,
        protocol: "aave-v3",
        asset: res.symbol,
        supply_apy: rayRateToApy(res.liquidityRate),
        utilization: computeUtilization(res.totalLiquidity, res.totalCurrentVariableDebt),
      }));
  } catch (e) {
    console.log(`${chain}: error`, e.message);
    return [];
  }
}

const all = await Promise.allSettled(
  Object.entries(AAVE_SUBGRAPHS).map(([chain, ep]) => probe(chain, ep))
);

let results = [];
for (const r of all) {
  if (r.status === "fulfilled") results.push(...r.value);
}

console.log("=== Live Aave Subgraph Results ===");
console.log(`Total rate objects: ${results.length}`);
console.log(JSON.stringify(results, null, 2));
