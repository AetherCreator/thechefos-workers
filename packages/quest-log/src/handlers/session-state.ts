import type { Context } from "hono";
import type { Env } from "../index";
import { SessionStateSchema } from "../schema";
import { getCachedState, putCachedState } from "../cache";

export async function getSessionState(c: Context<{ Bindings: Env }>) {
  const state = await getCachedState(c.env.QUEST_LOG_STATE);
  return c.json({ ok: true, state });
}

export async function putSessionState(c: Context<{ Bindings: Env }>) {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ ok: false, error: "validation", issues: ["invalid JSON body"] }, 400);
  }

  const result = SessionStateSchema.safeParse(body);
  if (!result.success) {
    return c.json(
      {
        ok: false,
        error: "validation",
        issues: result.error.issues.map((i) => ({ path: i.path, message: i.message })),
      },
      400
    );
  }

  await putCachedState(c.env.QUEST_LOG_STATE, result.data);
  return c.json({ ok: true });
}
