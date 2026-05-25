import type { Env } from '../../types';

// TODO: when OPS-COST-TELEMETRY-ENDPOINT ships, fetch monthly rollup
// and compare against MONTHLY_COST_CAP_USD env var. For v1, always true.
export async function isUnderCap(_env: Env): Promise<boolean> {
  return true;
}
