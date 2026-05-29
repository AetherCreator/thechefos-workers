export const HALF_LIFE_DAYS = 28;
export const LAMBDA = Math.LN2 / HALF_LIFE_DAYS;
export const FLOOR = 0;

export function effectiveXp(
  xp: number,
  last_touched_at: string | null,
  now: Date = new Date()
): number {
  if (last_touched_at === null) return 0;
  const touchedMs = new Date(last_touched_at).getTime();
  const days = (now.getTime() - touchedMs) / (1000 * 60 * 60 * 24);
  return Math.max(FLOOR, xp * Math.exp(-LAMBDA * days));
}
