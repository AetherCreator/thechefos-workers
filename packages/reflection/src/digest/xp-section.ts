// P3 reflection digest — Brain XP hot/cold section (C2 patch)
// Read-only: queries brain_xp D1 directly. No XP mutations here.

const HALF_LIFE_DAYS = 28;
const LAMBDA = Math.LN2 / HALF_LIFE_DAYS;

function computeEffective(xp: number, lastTouchedAt: string, now: Date): number {
  const days = (now.getTime() - new Date(lastTouchedAt).getTime()) / 86400000;
  return Math.max(0, xp * Math.exp(-LAMBDA * days));
}

export interface XpDigestNode {
  path: string;
  xp: number;
  effective: number;
  last_touched_at: string;
}

type XpRow = { path: string; xp: number; last_touched_at: string };

/**
 * Queries brain_xp D1 for hot (top-N) and cold (bottom-N) nodes by raw XP.
 * Returns empty arrays when brain_xp is empty — never throws.
 */
export async function queryXpHotCold(
  db: D1Database,
  topN: number,
  bottomN: number,
  now = new Date(),
): Promise<{ hot: XpDigestNode[]; cold: XpDigestNode[] }> {
  const toNodes = (rows: XpRow[]): XpDigestNode[] =>
    rows.map((r) => ({
      path: r.path,
      xp: r.xp,
      effective: computeEffective(r.xp, r.last_touched_at, now),
      last_touched_at: r.last_touched_at,
    }));

  const [topResult, bottomResult] = await Promise.all([
    db
      .prepare("SELECT path, xp, last_touched_at FROM brain_xp ORDER BY xp DESC LIMIT ?")
      .bind(topN)
      .all<XpRow>(),
    db
      .prepare("SELECT path, xp, last_touched_at FROM brain_xp ORDER BY xp ASC LIMIT ?")
      .bind(bottomN)
      .all<XpRow>(),
  ]);

  return {
    hot: toNodes(topResult.results ?? []),
    cold: toNodes(bottomResult.results ?? []),
  };
}

/**
 * Renders the P3 hot/cold XP section as markdown.
 * Returns a "no data" placeholder when both lists are empty.
 */
export function renderXpDigestSection(hot: XpDigestNode[], cold: XpDigestNode[]): string {
  if (hot.length === 0 && cold.length === 0) {
    return "## P3. Brain XP hot/cold\n\n_No XP data yet._\n";
  }

  const fmt = (nodes: XpDigestNode[]): string =>
    nodes.length === 0
      ? "_(none)_"
      : nodes
          .map((n) => `| \`${n.path}\` | ${n.xp} | ${n.effective.toFixed(1)} |`)
          .join("\n");

  return `## P3. Brain XP hot/cold

**Brain is leaning on these (high effective-XP):**

| Path | Raw XP | Effective |
|------|--------|-----------|
${fmt(hot)}

**Archive candidates — Tyler decides (low effective-XP):**

| Path | Raw XP | Effective |
|------|--------|-----------|
${fmt(cold)}
`;
}
