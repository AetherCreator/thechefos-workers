import type { CostTrajectory } from "../digest/schema";

const DEFAULT_URL = "https://cost-telemetry.tveg-baking.workers.dev";

const PERSONA_CAPS: Record<string, number> = {
  locke: 3000,
  council: 900,
  schemer: 500,
  reviewer: 500,
};

interface CostRollup {
  traffic_light: string;
  neurons_used_estimate: number;
  neurons_remaining_estimate: number;
  neurons_cap: number;
  locke_fires_today: number;
  council_fires_today: number;
  schemer_fires_today: number;
  reviewer_fires_today: number;
  last_updated: string;
  basis: string;
}

function mapTrafficLight(tl: string): CostTrajectory["traffic_light"] {
  if (tl === "green" || tl === "yellow" || tl === "red" || tl === "depleted") return tl;
  return "green";
}

export async function fetchCostTrajectory(
  baseUrl?: string
): Promise<CostTrajectory> {
  const url = `${baseUrl ?? DEFAULT_URL}/dashboard`;
  const res = await fetch(url, {
    headers: { "User-Agent": "thechefos-reflection/0.1.0" },
  });

  if (!res.ok) {
    throw new Error(`cost-telemetry fetch failed: ${res.status} ${res.statusText}`);
  }

  const rollup = await res.json() as CostRollup;
  const notable: string[] = [];

  const persona_used: Record<string, number> = {
    locke: rollup.locke_fires_today * PERSONA_CAPS.locke,
    council: rollup.council_fires_today * PERSONA_CAPS.council,
    schemer: rollup.schemer_fires_today * PERSONA_CAPS.schemer,
    reviewer: rollup.reviewer_fires_today * PERSONA_CAPS.reviewer,
  };

  const by_persona: Record<string, { used: number; cap: number; percent: number }> = {};
  for (const [persona, cap] of Object.entries(PERSONA_CAPS)) {
    const used = persona_used[persona] ?? 0;
    const percent = cap > 0 ? Math.round((used / cap) * 1000) / 10 : 0;
    by_persona[persona] = { used, cap, percent };
    if (percent >= 80) {
      notable.push(`${persona} at ${percent}% of cap (${used}/${cap} neurons)`);
    }
  }

  const total_used = rollup.neurons_used_estimate;
  const total_cap = rollup.neurons_cap;
  if (total_used / total_cap >= 0.9) {
    notable.push(
      `total weekly usage ${total_used}/${total_cap} neurons (${((total_used / total_cap) * 100).toFixed(0)}%) exceeds 90% of NEURON_CAP`
    );
  }

  return {
    current_week_neurons_used: total_used,
    current_week_neurons_cap: total_cap,
    traffic_light: mapTrafficLight(rollup.traffic_light),
    by_persona,
    previous_week_neurons_used: null,
    week_over_week_delta_percent: null,
    notable,
  };
}
