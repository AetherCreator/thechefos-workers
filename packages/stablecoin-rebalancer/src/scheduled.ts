import type { Env } from "./lib/assert-read-only";
import { runRateSnapshot } from "./scanners/snapshot";
import { evaluateOpportunities } from "./scanners/arbitrage";

export async function handleScheduled(event: ScheduledController, env: Env): Promise<void> {
  // Hourly: snapshot rates, then evaluate.
  try {
    await runRateSnapshot(env);
    await evaluateOpportunities(env);
  } catch (e) {
    console.error("scheduled:", e);
  }
}
