export interface RateRow {
  chain: string;
  protocol: string;
  asset: string;
  supply_apy: number;
}

export interface GasBook {
  ethereum_round_trip_usd: number;
  l2_round_trip_usd: number;
}

export interface Opportunity {
  asset: string;
  source_protocol: string;
  source_chain: string;
  source_apy: number;
  target_protocol: string;
  target_chain: string;
  target_apy: number;
  rate_delta_bps: number;
  gas_estimate_usd: number;
  capital_assumption: number;
  net_edge_bps: number;
  cooldown_key: string;
}

function gasForChain(chain: string, gas: GasBook): number {
  return chain === "ethereum" ? gas.ethereum_round_trip_usd : gas.l2_round_trip_usd;
}

/**
 * For a given asset, find the best source→target pair:
 *   source = lowest-APY venue where user is "assumed to currently hold"
 *   target = highest-APY venue
 *
 * In v1 we don't know where Tyler actually holds capital — we report max-vs-min
 * as a reconnaissance signal. Tyler reads, decides, acts himself.
 *
 * Returns null if delta or net_edge below threshold, or insufficient rows.
 */
export function findBestOpportunity(
  asset: string,
  rows: RateRow[],
  capital: number,
  gas: GasBook,
  minNetEdgeBps: number
): Opportunity | null {
  const relevant = rows.filter(r => r.asset === asset);
  if (relevant.length < 2) return null;

  const sorted = [...relevant].sort((a, b) => b.supply_apy - a.supply_apy);
  const target = sorted[0];
  const source = sorted[sorted.length - 1];
  if (target === source) return null;
  if (target.supply_apy <= source.supply_apy) return null;

  const gasRoundTrip = gasForChain(source.chain, gas) + gasForChain(target.chain, gas);
  const annualGain = (target.supply_apy - source.supply_apy) * capital;
  const netAnnualGain = annualGain - gasRoundTrip;
  const netEdgeBps = Math.round((netAnnualGain / capital) * 10000);

  if (netEdgeBps < minNetEdgeBps) return null;

  const rateDeltaBps = Math.round((target.supply_apy - source.supply_apy) * 10000);
  return {
    asset,
    source_protocol: source.protocol,
    source_chain: source.chain,
    source_apy: source.supply_apy,
    target_protocol: target.protocol,
    target_chain: target.chain,
    target_apy: target.supply_apy,
    rate_delta_bps: rateDeltaBps,
    gas_estimate_usd: gasRoundTrip,
    capital_assumption: capital,
    net_edge_bps: netEdgeBps,
    cooldown_key: `${asset}:${source.protocol}:${source.chain}->${target.protocol}:${target.chain}`,
  };
}
