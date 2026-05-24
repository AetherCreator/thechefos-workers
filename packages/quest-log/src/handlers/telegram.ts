import type { Context } from "hono";

export function postTelegramQuests(c: Context) {
  return c.json({ ok: false, error: "deferred to C3" }, 501);
}
