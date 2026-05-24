import type { OpsBoardDelta } from "../adapters/ops-board-diff";
import type { OpsBoardChurn } from "../digest/schema";

export function computeOpsBoardChurn(
  deltas: OpsBoardDelta[],
  weekDays: number = 7
): OpsBoardChurn {
  const total_commits_touching_board = deltas.length;
  const movements = {
    urgent_add: 0,
    backlog_add: 0,
    claim: 0,
    complete: 0,
    revert: 0,
    remove: 0,
  };
  const notable: string[] = [];

  const urgentClaimTimes: Record<string, { added: Date; claimed?: Date }> = {};

  for (const d of deltas) {
    if (d.movement in movements) {
      movements[d.movement as keyof typeof movements]++;
    }

    if (d.movement === "urgent_add" && d.row_id) {
      urgentClaimTimes[d.row_id] = { added: new Date(d.commit_date) };
    }
    if (d.movement === "claim" && d.row_id && urgentClaimTimes[d.row_id]) {
      urgentClaimTimes[d.row_id].claimed = new Date(d.commit_date);
    }

    if (d.movement === "revert") {
      notable.push(
        `revert detected: ${d.row_id ?? d.commit_sha.slice(0, 8)} moved from ${d.before_status ?? "?"} → ${d.after_status ?? "?"} on ${d.commit_date.slice(0, 10)} — needs human review`
      );
    }
  }

  let total_aging_days = 0;
  let aging_count = 0;
  for (const [rowId, times] of Object.entries(urgentClaimTimes)) {
    if (times.claimed) {
      const days = (times.claimed.getTime() - times.added.getTime()) / 86400000;
      total_aging_days += days;
      aging_count++;
      if (days > 7) {
        notable.push(
          `URGENT row ${rowId} aged ${days.toFixed(1)} days before claim — exceeded 7-day threshold`
        );
      }
    } else {
      const now = new Date();
      const days = (now.getTime() - times.added.getTime()) / 86400000;
      if (days > 7) {
        notable.push(
          `URGENT row ${rowId} unclaimed for ${days.toFixed(1)} days — exceeded 7-day threshold`
        );
      }
    }
  }

  return {
    total_commits_touching_board,
    movements,
    velocity: {
      completes_per_day: weekDays > 0 ? Math.round((movements.complete / weekDays) * 100) / 100 : 0,
      urgent_aging: aging_count > 0 ? Math.round((total_aging_days / aging_count) * 10) / 10 : 0,
    },
    notable,
  };
}
