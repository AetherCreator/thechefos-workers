import type { Tier } from "./schema";

export function levelToTier(level: number): Tier {
  if (level <= 2) return "stormy";
  if (level <= 4) return "cautious";
  if (level <= 7) return "steady";
  return "confident";
}

export function clampLevel(n: number): number {
  if (!Number.isFinite(n)) return 7;
  return Math.max(0, Math.min(10, Math.round(n)));
}
