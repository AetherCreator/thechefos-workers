import type { AutoActionEntry } from "../adapters/auto-actions";
import type { AutoActionAccuracy } from "../digest/schema";

const CANONICAL_VERDICTS = new Set([
  "applied",
  "blocked_schema",
  "blocked_verifier",
  "blocked_push_unverified",
  "blocked_dry_run",
  "paper_design_bypass",
  "manual",
]);

export function computeAutoActionAccuracy(entries: AutoActionEntry[]): AutoActionAccuracy {
  const total = entries.length;
  const by_verdict: Record<string, number> = {};
  const by_action: Record<string, { applied: number; blocked: number; ratio: number }> = {};
  const flagged_drift: string[] = [];
  const notable: string[] = [];

  for (const e of entries) {
    by_verdict[e.verdict] = (by_verdict[e.verdict] ?? 0) + 1;

    if (!CANONICAL_VERDICTS.has(e.verdict) && !flagged_drift.includes(e.verdict)) {
      flagged_drift.push(e.verdict);
    }

    if (!by_action[e.action]) {
      by_action[e.action] = { applied: 0, blocked: 0, ratio: 0 };
    }
    const slot = by_action[e.action];
    if (e.verdict === "applied") {
      slot.applied++;
    } else {
      slot.blocked++;
    }
  }

  for (const action of Object.keys(by_action)) {
    const slot = by_action[action];
    const total_for_action = slot.applied + slot.blocked;
    slot.ratio = total_for_action > 0 ? slot.applied / total_for_action : 0;
  }

  if (total > 0) {
    for (const [verdict, count] of Object.entries(by_verdict)) {
      const ratio = count / total;
      if (ratio > 0.4) {
        const actions_with_verdict = entries
          .filter((e) => e.verdict === verdict)
          .map((e) => e.action);
        const has_auto_promotion = actions_with_verdict.some((a) => a.includes("promotion"));
        if (has_auto_promotion) {
          notable.push(
            `${verdict} spike: ${count} entries (${(ratio * 100).toFixed(0)}% of week) on action=auto-promotion — check for systemic block`
          );
        }
      }
    }
  }

  return { total, by_verdict, by_action, flagged_drift, notable };
}
