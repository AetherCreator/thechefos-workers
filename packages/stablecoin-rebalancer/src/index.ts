import { Hono } from "hono";
import type { Env } from "./lib/assert-read-only";

const app = new Hono<{ Bindings: Env }>();
app.get("/api/health", (c) => c.json({ ok: true, clue: 1, ts: Date.now() }));

export default {
  fetch: app.fetch,
  async scheduled(event: ScheduledController, env: Env): Promise<void> {
    // Clue 5 wires snapshots here
  },
};
