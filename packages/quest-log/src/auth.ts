import type { Env } from "./index";

// v1 uses simple equality check — constant-time compare not required because
// the secret is a single long shared token (32 hex bytes). If multiple callers
// or public exposure is introduced, upgrade to a timing-safe compare.
export function requireApiKey(req: Request, env: Env): Response | null {
  const provided = req.headers.get("X-Quest-Log-Key");
  if (!provided || provided !== env.QUEST_LOG_API_SECRET) {
    return new Response(
      JSON.stringify({ ok: false, error: "unauthorized" }),
      { status: 401, headers: { "content-type": "application/json" } }
    );
  }
  return null;
}
