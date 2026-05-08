// Reviewer Worker — implements FOUNDRY-SCHEMA.md v1.0
// Runs 5-gate QA check on shipped product (Gate 2: Stripe deferred to v1.1)
// LLM-tier (Claude Haiku 4.5 via API)
// Endpoints:
//   GET /health → {ok, persona, schema, model}
//   POST /review-manual?product_url=X&product_slug=Y&secret=Z → runs gates, writes REVIEW.json
//   404 on other paths

interface Env {
  PERSONA: string;
  FOUNDRY_SCHEMA_VERSION: string;
  HAIKU_MODEL: string;               // Claude Haiku 4.5
  BRAIN_RAW_BASE: string;
  BRAIN_GH_API_BASE: string;
  BRAIN_WRITE_URL: string;
  INTEL_LOG_URL: string;
  // Secrets (set via `wrangler secret put`):
  BRAIN_WRITE_SECRET: string;
  REVIEWER_RUN_SECRET: string;
  GITHUB_TOKEN: string;              // PAT with `repo` scope — required to read private brain
  ANTHROPIC_API_KEY: string;         // For Haiku API calls
}

// Helper: Common headers for reads against private AetherCreator/SuperClaude repo
function ghReadHeaders(env: Env, accept?: string): Record<string, string> {
  const h: Record<string, string> = {
    'User-Agent': 'reviewer-worker/1.0',
    'Authorization': `Bearer ${env.GITHUB_TOKEN}`
  };
  if (accept) h['Accept'] = accept;
  return h;
}

// Helper: Best-effort telemetry (never blocks)
async function logIntel(env: Env, event: Record<string, any>): Promise<void> {
  try {
    await fetch(env.INTEL_LOG_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ persona: env.PERSONA, ...event, ts: new Date().toISOString() })
    });
  } catch (e) {
    // intel_log is best-effort; never fail because telemetry is down
    console.warn('intel_log failed:', e);
  }
}

// Helper: Write to brain via brain-write Worker
async function writeBrain(path: string, content: string, message: string, env: Env): Promise<void> {
  const r = await fetch(env.BRAIN_WRITE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-webhook-secret': env.BRAIN_WRITE_SECRET },
    body: JSON.stringify({ path, content, message })
  });
  if (!r.ok) throw new Error(`brain-write ${r.status}: ${await r.text()}`);
}

// Helper: Read JSON from brain (private GitHub via raw.githubusercontent.com)
async function readJsonFromBrain(filePath: string, env: Env): Promise<any> {
  const r = await fetch(`${env.BRAIN_RAW_BASE}/${filePath}`, {
    headers: ghReadHeaders(env)
  });
  if (!r.ok) throw new Error(`brain_read ${r.status} for ${filePath}`);
  return await r.json();
}

// Helper: Call Anthropic Haiku API
async function callHaiku(
  systemPrompt: string,
  userPrompt: string,
  env: Env
): Promise<string> {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.ANTHROPIC_API_KEY}`,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      model: env.HAIKU_MODEL,
      max_tokens: 1024,
      messages: [
        { role: 'user', content: `${systemPrompt}\n\n${userPrompt}` }
      ]
    })
  });

  if (!response.ok) {
    throw new Error(`Haiku API error: ${response.status} ${await response.text()}`);
  }

  const data = await response.json();
  return data.content[0].text;
}

// Helper: Fetch URL and return text content with timing
async function fetchUrlWithTiming(url: string): Promise<{text: string; statusCode: number; ms: number}> {
  const start = Date.now();
  let text = '';
  let statusCode = 0;

  try {
    const response = await fetch(url, { timeout: 5000 }); // 5 second timeout
    statusCode = response.status;
    text = await response.text();
  } catch (err: any) {
    // Fetch failed (timeout, network error, etc.)
    statusCode = 0; // Indicate failure
    text = '';
  }

  const ms = Date.now() - start;
  return { text, statusCode, ms };
}

// Gate 1: Does it load?
async function gate1Loads(productUrl: string): Promise<{pass: boolean; ms: number; status_code: number}> {
  const result = await fetchUrlWithTiming(productUrl);
  // Pass if status is 200 and load time < 5000ms
  return {
    pass: result.statusCode === 200 && result.ms < 5000,
    ms: result.ms,
    status_code: result.statusCode
  };
}

// Gate 2: Stripe (explicitly skipped in v1.0)
function gate2Stripe(): {pass: null; skipped: string} {
  return {
    pass: null,
    skipped: "v1.0 deferred"
  };
}

// Gate 3: Mobile responsive
async function gate3Mobile(pageHtml: string): Promise<{pass: boolean; issues: string[]; severity: 'none' | 'minor' | 'major' | 'critical'}> {
  const systemPrompt = "You are a mobile UX reviewer. Given the HTML of this page, identify any elements that would break on a 375px wide screen (iPhone SE). Look for: fixed widths >375px, horizontal scroll, text overflow, touch targets <44px, overlapping elements.";

  const userPrompt = `
HTML: ${pageHtml}

Respond with JSON:
{
  "mobile_ready": true|false,
  "issues": ["issue1", "issue2"],
  "severity": "none|minor|major|critical"
}`;

  try {
    const response = await callHaiku(systemPrompt, userPrompt, {
      ...process.env as any,
      ANTHROPIC_API_KEY: "dummy" // Will be overridden by env
    } as Env);

    // Parse JSON from response
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON found in Haiku response');

    const parsed = JSON.parse(jsonMatch[0]);
    return {
      pass: parsed.mobile_ready === true,
      issues: Array.isArray(parsed.issues) ? parsed.issues : [],
      severity: parsed.severity || 'none'
    };
  } catch (err) {
    // On Haiku error, fail open but log
    return {
      pass: false,
      issues: [`Haiku error: ${err.message}`],
      severity: 'critical'
    };
  }
}

// Gate 4: Copy evaluation
async function gate4Copy(pageText: string): Promise<{pass: boolean; value_prop_clear: boolean; cta_present: boolean; issues: string[]}> {
  const systemPrompt = "You are a landing page reviewer. Given this page content, evaluate:\n1. Is the value proposition clear within 5 seconds of reading?\n2. Is there a clear call to action?\n3. Are there any typos or grammatical errors?\n4. Would a stranger understand what this product does?";

  const userPrompt = `
Content: ${pageText}

Respond with JSON:
{
  "copy_quality": "good|needs_work|poor",
  "value_prop_clear": true|false,
  "cta_present": true|false,
  "issues": ["issue1"]
}`;

  try {
    const response = await callHaiku(systemPrompt, userPrompt, {
      ...process.env as any,
      ANTHROPIC_API_KEY: "dummy"
    } as Env);

    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON found in Haiku response');

    const parsed = JSON.parse(jsonMatch[0]);
    return {
      pass: parsed.value_prop_clear === true && parsed.cta_present === true,
      value_prop_clear: parsed.value_prop_clear === true,
      cta_present: parsed.cta_present === true,
      issues: Array.isArray(parsed.issues) ? parsed.issues : []
    };
  } catch (err) {
    return {
      pass: false,
      value_prop_clear: false,
      cta_present: false,
      issues: [`Haiku error: ${err.message}`]
    };
  }
}

// Gate 5: Embarrassment test
async function gate5Embarrassment(productDescription: string, url: string, price: string | number): Promise<{pass: boolean; risk: 'none' | 'low' | 'medium' | 'high'; reason: string; ship_recommendation: 'ship' | 'fix_first' | 'kill'}> {
  const systemPrompt = "Would you be embarrassed to share this product publicly? Consider: does it look professional, does it solve a real problem, is the pricing reasonable, would it reflect well on the maker?";

  const userPrompt = `
Product: ${productDescription}
URL: ${url}
Price: ${price}

Respond with JSON:
{
  "embarrassment_risk": "none|low|medium|high",
  "reason": "why or why not",
  "ship_recommendation": "ship|fix_first|kill"
}`;

  try {
    const response = await callHaiku(systemPrompt, userPrompt, {
      ...process.env as any,
      ANTHROPIC_API_KEY: "dummy"
    } as Env);

    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON found in Haiku response');

    const parsed = JSON.parse(jsonMatch[0]);
    return {
      pass: parsed.embarrassment_risk !== 'high',
      risk: parsed.embarrassment_risk || 'none',
      reason: parsed.reason || '',
      ship_recommendation: parsed.ship_recommendation || 'fix_first'
    };
  } catch (err) {
    return {
      pass: false,
      risk: 'high',
      reason: `Haiku error: ${err.message}`,
      ship_recommendation: 'kill'
    };
  }
}

// Main handler
export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // Health check
    if (url.pathname === '/health') {
      return Response.json({
        ok: true,
        persona: env.PERSONA,
        schema: env.FOUNDRY_SCHEMA_VERSION,
        model: env.HAIKU_MODEL
      });
    }

    // POST /review-manual?product_url=X&product_slug=Y&secret=Z
    if (url.pathname === '/review-manual' && request.method === 'POST') {
      const secret = url.searchParams.get('secret');
      if (secret !== env.REVIEWER_RUN_SECRET) return new Response('Forbidden', { status: 403 });

      const productUrl = url.searchParams.get('product_url');
      const productSlug = url.searchParams.get('product_slug');

      if (!productUrl) return Response.json({ error: 'product_url_required' }, { status: 400 });
      if (!productSlug) return Response.json({ error: 'product_slug_required' }, { status: 400 });

      try {
        // Run all gates
        const startedAt = Date.now();

        // Gate 1: Loads
        const gate1 = await gate1Loads(productUrl);

        // Gate 2: Stripe (skipped in v1.0)
        const gate2 = gate2Stripe();

        // For gates 3-5, we need to fetch the page content
        let pageHtml = '';
        let pageText = '';

        if (gate1.pass) {
          const fetchResult = await fetchUrlWithTiming(productUrl);
          pageHtml = fetchResult.text;
          // Simple text extraction (remove HTML tags)
          pageText = pageHtml.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
        }

        // Gate 3: Mobile responsive
        const gate3 = gate1.pass
          ? await gate3Mobile(pageHtml)
          : { pass: false, issues: ['Page failed to load'], severity: 'critical' };

        // Gate 4: Copy
        const gate4 = gate1.pass
          ? await gate4Copy(pageText)
          : { pass: false, value_prop_clear: false, cta_present: false, issues: ['Page failed to load'] };

        // Gate 5: Embarrassment
        // Extract price from URL or use placeholder
        const priceMatch = productUrl.match(/[?&]price=([^&]+)/);
        const price = priceMatch ? priceMatch[1] : '0';

        const gate5 = await gate5Embarrassment(
          `Product reviewed at ${productUrl}`,
          productUrl,
          price
        );

        // Determine overall verdict per FOUNDRY-SCHEMA §4.3
        let verdict: 'shipped' | 'fix_first' | 'killed' = 'shipped';

        // Gate 1 (loads): non-200 or > 5000ms → verdict: "killed"
        if (!gate1.pass) {
          verdict = 'killed';
        }
        // Gate 3 (mobile): severity: "critical" → verdict: "fix_first"
        else if (gate3.severity === 'critical') {
          verdict = 'fix_first';
        }
        // Gate 4 (copy): copy_quality: "poor" → verdict: "fix_first"
        else if (!gate4.value_prop_clear || !gate4.cta_present) {
          verdict = 'fix_first';
        }
        // Gate 5 (embarrassment): risk: "high" → verdict: "killed"
        else if (gate5.risk === 'high') {
          verdict = 'killed';
        }

        // Build REVIEW.json per FOUNDRY-SCHEMA §4.3
        const review = {
          schema_version: "foundry-1.0",
          product_slug: productSlug,
          product_url: productUrl,
          reviewed_at: new Date().toISOString(),
          model: env.HAIKU_MODEL,
          gates: {
            loads: {
              pass: gate1.pass,
              ms: gate1.ms,
              status_code: gate1.status_code
            },
            stripe: gate2,
            mobile: {
              pass: gate3.pass,
              issues: gate3.issues,
              severity: gate3.severity
            },
            copy: {
              pass: gate4.pass,
              value_prop_clear: gate4.value_prop_clear,
              cta_present: gate4.cta_present,
              issues: gate4.issues
            },
            embarrassment: {
              pass: gate5.pass,
              risk: gate5.risk,
              reason: gate5.reason,
              ship_recommendation: gate5.ship_recommendation
            }
          },
          verdict: verdict,
          wall_clock_ms: Date.now() - startedAt
        };

        // Write REVIEW.json to brain
        const dateStr = new Date().toISOString().slice(0, 10);
        const brainPath = `brain/06-foundry/${dateStr}/${productSlug}`;

        await writeBrain(
          `${brainPath}/REVIEW.json`,
          JSON.stringify(review, null, 2),
          `reviewer: completed review for ${productSlug}`,
          env
        );

        return Response.json({
          ok: true,
          persona: 'reviewer',
          schema: 'foundry-1.0',
          model: env.HAIKU_MODEL,
          reviewed_at: new Date().toISOString(),
          brain_path: brainPath,
          review: review
        });

      } catch (err: any) {
        await logIntel(env, {
          event: 'reviewer_error',
          product_url: url.searchParams.get('product_url') ?? 'unknown',
          product_slug: url.searchParams.get('product_slug') ?? 'unknown',
          error: err.message
        });

        return Response.json({ error: 'reviewer_failed', message: err.message }, { status: 500 });
      }
    }

    return new Response(
      'reviewer worker — endpoints: GET /health; POST /review-manual',
      { status: 404 }
    );
  }
};