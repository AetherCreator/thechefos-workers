// carpenter-bridge — OpenAI-compat front for env.AI.run('@cf/moonshotai/kimi-k2.6')
// H1 Clue 3 (2026-05-22)
// Spec: brain/06-meta/carpenter-design/03-dispatch-protocol-spec.md §Workers AI Kimi K2.6 — LOCKED

export interface Env {
  AI: Ai;
  CARPENTER_BRIDGE_TOKEN: string;
}

const MODEL = "@cf/moonshotai/kimi-k2.6";

function constantTimeEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function unauthorized(): Response {
  return new Response(JSON.stringify({ error: "unauthorized" }), {
    status: 401,
    headers: { "content-type": "application/json" },
  });
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);

    // GET /health — public; exercises env.AI.run so deploy fails loud on binding misconfig.
    if (req.method === "GET" && url.pathname === "/health") {
      try {
        await env.AI.run(MODEL, {
          messages: [{ role: "user", content: "ok" }],
          max_tokens: 1,
        });
        return Response.json({ ok: true, model: MODEL, ts: new Date().toISOString() });
      } catch (e: any) {
        return Response.json(
          { ok: false, model: MODEL, error: String(e?.message ?? e) },
          { status: 503 }
        );
      }
    }

    // POST /v1/chat/completions — bearer-authed, OpenAI-compat.
    if (req.method === "POST" && url.pathname === "/v1/chat/completions") {
      const auth = req.headers.get("authorization") ?? "";
      const expected = `Bearer ${env.CARPENTER_BRIDGE_TOKEN}`;
      if (!constantTimeEq(auth, expected)) return unauthorized();

      let body: any;
      try {
        body = await req.json();
      } catch {
        return Response.json({ error: "invalid_json" }, { status: 400 });
      }

      const messages = body.messages;
      if (!Array.isArray(messages) || messages.length === 0) {
        return Response.json({ error: "messages_required" }, { status: 400 });
      }

      const aiArgs: any = { messages };
      if (Array.isArray(body.tools)) aiArgs.tools = body.tools;
      if (typeof body.max_tokens === "number") aiArgs.max_tokens = body.max_tokens;
      if (typeof body.temperature === "number") aiArgs.temperature = body.temperature;

      let result: any;
      try {
        result = await env.AI.run(MODEL, aiArgs);
      } catch (e: any) {
        return Response.json(
          { error: "upstream_error", detail: String(e?.message ?? e) },
          { status: 502 }
        );
      }

      const choiceMessage: any = { role: "assistant", content: result.response ?? "" };
      if (Array.isArray(result.tool_calls)) {
        choiceMessage.tool_calls = result.tool_calls;
      }

      const openaiResp = {
        id: `chatcmpl-${crypto.randomUUID()}`,
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model: MODEL,
        choices: [
          {
            index: 0,
            message: choiceMessage,
            finish_reason: choiceMessage.tool_calls ? "tool_calls" : "stop",
          },
        ],
        usage: result.usage ?? null,
      };

      return Response.json(openaiResp);
    }

    return new Response("not_found", { status: 404 });
  },
};
