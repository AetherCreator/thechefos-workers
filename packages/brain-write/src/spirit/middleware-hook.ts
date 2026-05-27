// packages/brain-write/src/spirit/middleware-hook.ts
//
// Pb.C2 Phase C — read spirit tier for audit entry attachment.
// Soft-degrade: any failure returns 'steady' (no behavior change from Pa baseline).
// MUST NOT throw — audit pipeline must never block on tier read.

import { readLevel } from "./index";

export async function readSpiritTierForAudit(
  env: { SPIRIT_LEVEL_KV: KVNamespace }
): Promise<string> {
  try {
    const state = await readLevel(env);
    return state.tier;
  } catch (e) {
    console.warn("spirit_tier_hook_failed", { error: String(e) });
    return "steady"; // soft-degrade default — matches defaultState() anchor tier
  }
}
