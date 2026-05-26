import { z } from "zod";

export const TIER_VALUES = ["stormy", "cautious", "steady", "confident"] as const;
export type Tier = typeof TIER_VALUES[number];

export const LEVEL_SOURCE_VALUES = [
  "anchor_init",
  "tyler_override",
  "reflection_drift",
  "manual_correction",
] as const;
export type LevelSource = typeof LEVEL_SOURCE_VALUES[number];

export const SpiritLevelHistoryEntrySchema = z.object({
  level: z.number().int().min(0).max(10),
  tier: z.enum(TIER_VALUES),
  source: z.enum(LEVEL_SOURCE_VALUES),
  at: z.string().datetime(),
});

export const SpiritLevelStateSchema = z.object({
  level: z.number().int().min(0).max(10),
  tier: z.enum(TIER_VALUES),
  last_updated_at: z.string().datetime(),
  last_source: z.enum(LEVEL_SOURCE_VALUES),
  history: z.array(SpiritLevelHistoryEntrySchema).max(10),
});
export type SpiritLevelState = z.infer<typeof SpiritLevelStateSchema>;

export const LevelSetPayloadSchema = z.object({
  level: z.number().int().min(0).max(10),
  source: z.enum(LEVEL_SOURCE_VALUES),
});
export type LevelSetPayload = z.infer<typeof LevelSetPayloadSchema>;

export const ANCHOR_LEVEL = 7;
export const DEFAULT_TIER: Tier = "steady";
export const HISTORY_MAX = 10;

export function defaultState(now: string = new Date().toISOString()): SpiritLevelState {
  return {
    level: ANCHOR_LEVEL,
    tier: DEFAULT_TIER,
    last_updated_at: now,
    last_source: "anchor_init",
    history: [{ level: ANCHOR_LEVEL, tier: DEFAULT_TIER, source: "anchor_init", at: now }],
  };
}
