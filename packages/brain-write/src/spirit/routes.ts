import { Hono } from "hono";
import { LevelSetPayloadSchema } from "./schema";
import { readLevel, setLevel } from ".";

type Env = { SPIRIT_LEVEL_KV: KVNamespace; BRAIN_WRITE_API_SECRET: string };

export const spiritRoutes = new Hono<{ Bindings: Env }>();

spiritRoutes.get("/level-read", async (c) => {
  const state = await readLevel(c.env);
  return c.json({ ok: true, ...state });
});

spiritRoutes.post("/level-set", async (c) => {
  const secret = c.req.header("x-brain-write-secret");
  if (!secret || secret !== c.env.BRAIN_WRITE_API_SECRET) {
    return c.json({ ok: false, error: "unauthorized" }, 401);
  }
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ ok: false, error: "body_not_json" }, 400);
  }
  const parsed = LevelSetPayloadSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ ok: false, error: "level_payload_invalid", details: parsed.error.format() }, 400);
  }
  const { previous, current } = await setLevel(c.env, parsed.data);
  return c.json({
    ok: true,
    level: current.level,
    tier: current.tier,
    previous_level: previous.level,
    previous_tier: previous.tier,
    last_updated_at: current.last_updated_at,
    source: current.last_source,
  });
});
