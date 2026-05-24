import type { Context } from "hono";

export function getHealth(c: Context) {
  return c.json({ ok: true, worker: "thechefos-quest-log" });
}
