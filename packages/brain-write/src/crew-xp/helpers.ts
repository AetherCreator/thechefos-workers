import type { CrewXpState } from './schema';

/**
 * Compute level from xp + thresholds.
 * Thresholds are cumulative XP needed to REACH that level.
 * thresholds[0] = XP to reach Lv 2
 * thresholds[1] = XP to reach Lv 3
 * thresholds[2] = XP to reach Lv 4
 * thresholds[3] = XP to reach Lv 5
 */
export function computeLevel(xp: number, thresholds: [number, number, number, number]): 1 | 2 | 3 | 4 | 5 {
  if (xp >= thresholds[3]) return 5;
  if (xp >= thresholds[2]) return 4;
  if (xp >= thresholds[1]) return 3;
  if (xp >= thresholds[0]) return 2;
  return 1;
}

export function xpToNextLevel(state: CrewXpState): number | null {
  if (state.level === 5) return null;
  return state.thresholds[state.level - 1] - state.xp;
}
