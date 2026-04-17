import { Hono } from "hono";
import type { Env } from "./lib/assert-read-only";
import { runRateSnapshot } from "./scanners/snapshot";

const app = new Hono<{ Bindings: Env }>();
app.get("/api/health", (c) => c.json({ ok: true, clue: 3, ts: Date.now() }));
app.get("/api/force-snapshot", async (c) => {
  const { batchId, rowsWritten } = await runRateSnapshot(c.env);
  return c.json({ ok: true, batch_id: batchId, rows_written: rowsWritten });
});

export default {
  fetch: app.fetch,
  async scheduled(event: ScheduledController, env: Env): Promise<void> {
    await runRateSnapshot(env);
  },
};
