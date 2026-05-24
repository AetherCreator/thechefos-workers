import type { Env } from "./types";

// C1 stub: logs cron fire. C2 wires into runReflection with commit=true, notify=true.
export async function handleCronTrigger(
  _event: ScheduledEvent,
  _env: Env,
  _ctx: ExecutionContext
): Promise<void> {
  console.log(`[cron] reflection fired at ${new Date().toISOString()}`);
}
