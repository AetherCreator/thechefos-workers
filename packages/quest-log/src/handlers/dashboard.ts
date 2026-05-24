import type { Context } from "hono";

export function getDashboard(c: Context) {
  return c.json({ ok: false, error: "deferred to C2" }, 501);
}
