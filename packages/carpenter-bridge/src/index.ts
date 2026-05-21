// carpenter-bridge — OpenAI-compat front for env.AI.run('@cf/moonshotai/kimi-k2.6')
// H1 Clue 3 (2026-05-22) — initial deploy, plain completions only.
// H2 Clue 3 patch (2026-05-21) — pass through Workers AI's native OpenAI-shape choices[]
//   when the model emits tool_calls. Falls back to legacy {response: "..."} shape for backward compat.
//   Discovered when Kimi K2.6 returned tool_calls nested in result.choices[0].message — bridge was
//   only looking at result.response (legacy) and result.tool_calls (top-level, never populated), so
//   it stripped tool_calls and emitted finish_reason: "stop" with content: "".
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
      if (body.tool_choice !== undefined) aiArgs.tool_choice = body.tool_choice;
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

      // H2 patch: Workers AI Kimi K2.6 with tools returns OpenAI-shape {choices: [...]} directly.
      // Plain completions without tools return legacy {response: "string"}. Handle both.
      let choiceMessage: any;
      let finishReason: string;

      if (Array.isArray(result.choices) && result.choices.length > 0) {
        // Native OpenAI shape from Workers AI (tool-calling path).
        const choice = result.choices[0];
        choiceMessage = choice.message ?? { role: "assistant", content: "" };
        // Normalize content: Workers AI may send null when tool_calls present; OpenAI clients
        // generally expect either a string or omitted content. Keep null to signal "no text".
        if (choiceMessage.content === undefined) choiceMessage.content = null;
        finishReason =
          choice.finish_reason ??
          (Array.isArray(choiceMessage.tool_calls) && choiceMessage.tool_calls.length > 0
            ? "tool_calls"
            : "stop");
      } else {
        // Legacy Workers AI shape: {response: "string", tool_calls?: [...]}
        choiceMessage = { role: "assistant", content: result.response ?? "" };
        if (Array.isArray(result.tool_calls) && result.tool_calls.length > 0) {
          choiceMessage.tool_calls = result.tool_calls;
        }
        finishReason =
          Array.isArray(choiceMessage.tool_calls) && choiceMessage.tool_calls.length > 0
            ? "tool_calls"
            : "stop";
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
            finish_reason: finishReason,
          },
        ],
        usage: result.usage ?? null,
      };

      return Response.json(openaiResp);
    }

    return new Response("not_found", { status: 404 });
  },
};
