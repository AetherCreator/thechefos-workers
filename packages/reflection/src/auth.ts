import type { Env } from "./types";

export function requireReflectionKey(req: Request, env: Env): Response | null {
  const provided = req.headers.get("X-Reflection-Key");
  if (!provided || provided !== env.REFLECTION_API_SECRET) {
    return new Response(
      JSON.stringify({ ok: false, error: "invalid_or_missing_api_key" }),
      { status: 401, headers: { "content-type": "application/json" } }
    );
  }
  return null;
}
