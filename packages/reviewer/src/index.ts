// Reviewer Worker — implements FOUNDRY-SCHEMA.md v1.0
// Runs 5-gate QA check on shipped product (Gate 2: Stripe deferred to v1.1).
// LLM-tier: Workers AI Kimi K2.6 in-network — pivoted 2026-05-07 from
// Anthropic Haiku per FOUNDRY-SCHEMA §11 Spirit Test (zero Anthropic API
// surfaces in autonomous swarm). Also fixes Hunter`s env-passing bug where
// gates called callHaiku with `process.env as any` (Workers don`t have
// process.env, so the real env never reached the LLM call).
//
// Endpoints:
//   GET  /health
//   POST /review-manual?product_url=X&product_slug=Y&secret=Z
//   404 on other paths

interface Env {
  AI: any;                           // Workers AI binding (Kimi K2.6 in-network)
  PERSONA: string;
  FOUNDRY_SCHEMA_VERSION: string;
  NIM_MODEL: string;                 // Workers AI model id (@cf/moonshotai/kimi-k2.6)
  BRAIN_RAW_BASE: string;
  BRAIN_GH_API_BASE: string;
  BRAIN_WRITE_URL: string;
  INTEL_LOG_URL: string;
  PER_GATE_TIMEOUT_MS: string;       // "30000"
  TYLER_CHAT_ID: string;
  // Secrets:
  BRAIN_WRITE_SECRET: string;
  REVIEWER_RUN_SECRET: string;
  GITHUB_TOKEN: string;              // PAT with repo scope (for any future brain reads)
}

function ghReadHeaders(env: Env, accept?: string): Record<string, string> {
  const h: Record<string, string> = {
    "User-Agent": "reviewer-worker/1.0",
    "Authorization": "Bearer " + env.GITHUB_TOKEN
  };
  if (accept) h["Accept"] = accept;
  return h;
}

async function logIntel(env: Env, event: Record<string, any>): Promise<void> {
  try {
    await fetch(env.INTEL_LOG_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(Object.assign({ persona: env.PERSONA, ts: new Date().toISOString() }, event))
    });
  } catch (e) {
    console.warn("intel_log failed:", e);
  }
}

async function writeBrain(path: string, content: string, message: string, env: Env): Promise<void> {
  const r = await fetch(env.BRAIN_WRITE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-webhook-secret": env.BRAIN_WRITE_SECRET },
    body: JSON.stringify({ path: path, content: content, message: message })
  });
  if (!r.ok) throw new Error("brain-write " + r.status + ": " + (await r.text()));
}

function extractJsonObject(text: string): any {
  const noThink = text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  const noFence = noThink.replace(/^```(?:json)?\s*/m, "").replace(/```\s*$/m, "").trim();
  const start = noFence.indexOf("{");
  const end = noFence.lastIndexOf("}");
  const slice = (start >= 0 && end > start) ? noFence.slice(start, end + 1) : noFence;
  return JSON.parse(slice);
}

// Reasoning suppression — cuts K2.6 <think> load so generation is fast and
// content is non-empty. /no_think directive + explicit instruction covers both
// known Kimi suppression surfaces. extractJsonObject <think>-strip is backstop.
const REASONING_SUPPRESS = "Answer immediately. Output ONLY the JSON object. Do NOT produce extended reasoning or <think> blocks. /no_think\n\n";

// Kimi K2.6 via Workers AI binding (in-network, sync). Mirrors Locke + Council
// + Schemer pattern. Promise.race wrapper because env.AI.run() does not accept
// AbortSignal. Per-gate timeout via env.PER_GATE_TIMEOUT_MS.
// Retry-with-backoff: up to 3 attempts, 400ms*attempt between retries.
// Retries on: ai_error (thrown), empty content, timeout. After 3 failures,
// re-throws the last error for the gate function to catch.
export async function callKimi(systemPrompt: string, userPrompt: string, env: Env, _backoffMs = 400): Promise<any> {
  const timeoutMs = parseInt(env.PER_GATE_TIMEOUT_MS || "30000", 10);
  const suppressedSystem = REASONING_SUPPRESS + systemPrompt;
  const MAX_ATTEMPTS = 3;

  let lastError: any;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    if (attempt > 1) {
      await new Promise(r => setTimeout(r, _backoffMs * (attempt - 1)));
    }
    try {
      const aiCallP = (async () => {
        const result: any = await env.AI.run(env.NIM_MODEL, {
          messages: [
            { role: "system", content: suppressedSystem },
            { role: "user", content: userPrompt }
          ],
          temperature: 0.3,
          max_tokens: 4096   // reasoning suppressed; gate JSON is ~500 tok
        });
        const t =
          (typeof result?.response === "string" && result.response) ||
          result?.choices?.[0]?.message?.content ||
          result?.result?.response ||
          "";
        if (!t) throw new Error("AI binding empty: keys=" + Object.keys(result || {}).join(","));
        return t;
      })();
      // Silence dangling rejection if the other side of the race wins
      aiCallP.catch(() => {});
      const timeoutP = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error("timeout")), timeoutMs);
      });
      timeoutP.catch(() => {});
      const text = await Promise.race([aiCallP, timeoutP]);
      return extractJsonObject(text as string);
    } catch (err: any) {
      lastError = err;
      if (attempt < MAX_ATTEMPTS) console.warn(`callKimi attempt ${attempt} failed: ${err?.message}`);
    }
  }
  throw lastError;
}

async function fetchUrlWithTiming(url: string): Promise<{text: string; statusCode: number; ms: number}> {
  const start = Date.now();
  let text = "";
  let statusCode = 0;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
    statusCode = response.status;
    text = await response.text();
  } catch (err: any) {
    statusCode = 0;
    text = "";
  }
  const ms = Date.now() - start;
  return { text: text, statusCode: statusCode, ms: ms };
}

async function gate1Loads(productUrl: string): Promise<{pass: boolean; ms: number; status_code: number}> {
  const result = await fetchUrlWithTiming(productUrl);
  return {
    pass: result.statusCode === 200 && result.ms < 5000,
    ms: result.ms,
    status_code: result.statusCode
  };
}

function gate2Stripe(): {pass: null; skipped: string} {
  return { pass: null, skipped: "v1.0 deferred" };
}

async function gate3Mobile(pageHtml: string, env: Env): Promise<{pass: boolean; issues: string[]; severity: "none" | "minor" | "major" | "critical"}> {
  const systemPrompt = "You are a mobile UX reviewer. Given the HTML of a page, identify any elements that would break on a 375px wide screen (iPhone SE). Look for: fixed widths >375px, horizontal scroll, text overflow, touch targets <44px, overlapping elements. Respond ONLY with valid JSON. No prose, no markdown fences.";
  const userPrompt = "HTML (truncated to 4000 chars if longer): " + pageHtml.slice(0, 4000) + "\n\nReturn:\n{\n  \"mobile_ready\": true | false,\n  \"issues\": [\"issue1\", \"issue2\"],\n  \"severity\": \"none\" | \"minor\" | \"major\" | \"critical\"\n}";
  try {
    const parsed = await callKimi(systemPrompt, userPrompt, env);
    const sev = ["none", "minor", "major", "critical"].includes(parsed.severity) ? parsed.severity : "none";
    return {
      pass: parsed.mobile_ready === true,
      issues: Array.isArray(parsed.issues) ? parsed.issues.slice(0, 5).map((i: any) => String(i)) : [],
      severity: sev
    };
  } catch (err: any) {
    return { pass: false, issues: ["gate3 error: " + (err?.message ?? err)], severity: "critical" };
  }
}

async function gate4Copy(pageText: string, env: Env): Promise<{pass: boolean; value_prop_clear: boolean; cta_present: boolean; issues: string[]}> {
  const systemPrompt = "You are a landing page reviewer. Given page content, evaluate: (1) Is the value proposition clear within 5 seconds of reading? (2) Is there a clear call to action? (3) Typos or grammatical errors? (4) Would a stranger understand what this product does? Respond ONLY with valid JSON.";
  const userPrompt = "Content (truncated to 4000 chars if longer): " + pageText.slice(0, 4000) + "\n\nReturn:\n{\n  \"copy_quality\": \"good\" | \"needs_work\" | \"poor\",\n  \"value_prop_clear\": true | false,\n  \"cta_present\": true | false,\n  \"issues\": [\"issue1\"]\n}";
  try {
    const parsed = await callKimi(systemPrompt, userPrompt, env);
    return {
      pass: parsed.value_prop_clear === true && parsed.cta_present === true,
      value_prop_clear: parsed.value_prop_clear === true,
      cta_present: parsed.cta_present === true,
      issues: Array.isArray(parsed.issues) ? parsed.issues.slice(0, 5).map((i: any) => String(i)) : []
    };
  } catch (err: any) {
    return { pass: false, value_prop_clear: false, cta_present: false, issues: ["gate4 error: " + (err?.message ?? err)] };
  }
}

async function gate5Embarrassment(productDescription: string, url: string, price: string, env: Env): Promise<{pass: boolean; risk: "none" | "low" | "medium" | "high"; reason: string; ship_recommendation: "ship" | "fix_first" | "kill"}> {
  const systemPrompt = "You are evaluating whether the maker should be embarrassed to share this product publicly. Consider: does it look professional, does it solve a real problem, is the pricing reasonable, would it reflect well on the maker? Respond ONLY with valid JSON.";
  const userPrompt = "Product: " + productDescription + "\nURL: " + url + "\nPrice: " + price + "\n\nReturn:\n{\n  \"embarrassment_risk\": \"none\" | \"low\" | \"medium\" | \"high\",\n  \"reason\": \"string, 200 chars max\",\n  \"ship_recommendation\": \"ship\" | \"fix_first\" | \"kill\"\n}";
  try {
    const parsed = await callKimi(systemPrompt, userPrompt, env);
    const risk = ["none", "low", "medium", "high"].includes(parsed.embarrassment_risk) ? parsed.embarrassment_risk : "none";
    const ship = ["ship", "fix_first", "kill"].includes(parsed.ship_recommendation) ? parsed.ship_recommendation : "fix_first";
    return {
      pass: risk !== "high",
      risk: risk,
      reason: String(parsed.reason || "").slice(0, 200),
      ship_recommendation: ship
    };
  } catch (err: any) {
    return { pass: false, risk: "high", reason: "gate5 error: " + (err?.message ?? err), ship_recommendation: "kill" };
  }
}

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return Response.json({
        ok: true,
        persona: env.PERSONA,
        schema: env.FOUNDRY_SCHEMA_VERSION,
        model: env.NIM_MODEL
      });
    }

    if (url.pathname === "/review-manual" && request.method === "POST") {
      const secret = url.searchParams.get("secret");
      if (secret !== env.REVIEWER_RUN_SECRET) return new Response("Forbidden", { status: 403 });

      const productUrl = url.searchParams.get("product_url");
      const productSlug = url.searchParams.get("product_slug");
      if (!productUrl) return Response.json({ error: "product_url_required" }, { status: 400 });
      if (!productSlug) return Response.json({ error: "product_slug_required" }, { status: 400 });

      const startedAt = Date.now();
      try {
        const gate1 = await gate1Loads(productUrl);
        const gate2 = gate2Stripe();

        let pageHtml = "";
        let pageText = "";
        if (gate1.pass) {
          const fetched = await fetchUrlWithTiming(productUrl);
          pageHtml = fetched.text;
          pageText = pageHtml.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
        }

        // Gates 3-5 in parallel; each capped via PER_GATE_TIMEOUT_MS in callKimi
        const [gate3, gate4, gate5] = await Promise.all([
          gate1.pass
            ? gate3Mobile(pageHtml, env)
            : Promise.resolve({ pass: false, issues: ["Page failed to load"], severity: "critical" as const }),
          gate1.pass
            ? gate4Copy(pageText, env)
            : Promise.resolve({ pass: false, value_prop_clear: false, cta_present: false, issues: ["Page failed to load"] }),
          gate5Embarrassment("Product reviewed at " + productUrl, productUrl, "0", env)
        ]);

        let verdict: "shipped" | "fix_first" | "killed" = "shipped";
        if (!gate1.pass) verdict = "killed";
        else if (gate3.severity === "critical") verdict = "fix_first";
        else if (!gate4.value_prop_clear || !gate4.cta_present) verdict = "fix_first";
        else if (gate5.risk === "high") verdict = "killed";

        const review = {
          schema_version: "foundry-1.0",
          product_slug: productSlug,
          product_url: productUrl,
          reviewed_at: new Date().toISOString(),
          model: env.NIM_MODEL,
          gates: {
            loads: { pass: gate1.pass, ms: gate1.ms, status_code: gate1.status_code },
            stripe: gate2,
            mobile: { pass: gate3.pass, issues: gate3.issues, severity: gate3.severity },
            copy: { pass: gate4.pass, value_prop_clear: gate4.value_prop_clear, cta_present: gate4.cta_present, issues: gate4.issues },
            embarrassment: { pass: gate5.pass, risk: gate5.risk, reason: gate5.reason, ship_recommendation: gate5.ship_recommendation }
          },
          verdict: verdict,
          wall_clock_ms: Date.now() - startedAt
        };

        const dateStr = new Date().toISOString().slice(0, 10);
        const brainPath = "brain/06-foundry/" + dateStr + "/" + productSlug;
        await writeBrain(
          brainPath + "/REVIEW.json",
          JSON.stringify(review, null, 2),
          "reviewer: " + productSlug + " -> " + verdict,
          env
        );

        await logIntel(env, {
          event: "review_complete",
          product_slug: productSlug,
          verdict: verdict,
          wall_clock_ms: review.wall_clock_ms
        });

        return Response.json({
          ok: true,
          persona: "reviewer",
          schema: "foundry-1.0",
          model: env.NIM_MODEL,
          reviewed_at: review.reviewed_at,
          brain_path: brainPath,
          review: review
        });

      } catch (err: any) {
        await logIntel(env, {
          event: "reviewer_error",
          product_slug: productSlug,
          error: String(err?.message ?? err).slice(0, 200)
        });
        return Response.json({ error: "reviewer_failed", message: String(err?.message ?? err) }, { status: 500 });
      }
    }

    return new Response("reviewer worker — endpoints: GET /health; POST /review-manual", { status: 404 });
  }
};
