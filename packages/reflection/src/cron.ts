import type { Env } from "./types";
import { runReflectionFlow } from "./flow";

// ISO-8601 week key (YYYY-Www) for the current UTC date. Mirrors getCurrentISOWeek in index.ts.
function getCurrentISOWeek(): string {
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const dow = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dow);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

// C2: cron fires the real reflection — compute, commit the weekly digest to brain/, notify Telegram.
// scheduled() awaits this, so the isolate stays alive for the full (I/O-bound) run.
export async function handleCronTrigger(
  _event: ScheduledEvent,
  env: Env,
  _ctx: ExecutionContext
): Promise<void> {
  const week = getCurrentISOWeek();
  console.log(`[cron] reflection firing for ${week} at ${new Date().toISOString()}`);
  const result = await runReflectionFlow({ week, commit: true, notify: true, smoke: false, env });
  console.log(
    `[cron] reflection done: week=${result.week} committed=${result.committed} ` +
      `sha=${result.commit_sha ?? "none"} notified=${result.notified} ops_rows=${result.filed_ops_rows.length}`
  );
}
