// Schemer Worker — implements FOUNDRY-SCHEMA.md v1.0
// Converts approved Council verdicts into THDD hunt scaffolds (MAP.md + clue caches)
// Model: Workers AI Kimi K2.6 in-network (sync via env.AI.run())
// Endpoints:
//   GET /health → {ok, persona, schema, model}
//   POST /run-manual?lead_id=X&verdict_path=Y&secret=Z → reads verdict/brain, generates plan, writes to brain
//   POST /run/:lead_id?secret=X → webhook variant (v1.1 trigger surface)
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
  MAX_RETRIES: string;               // "2"
  WALL_CLOCK_BUDGET_MS: string;      // "120000"
  TYLER_CHAT_ID: string;
  // Secrets (set via `wrangler secret put`):
  BRAIN_WRITE_SECRET: string;
  SCHEMER_RUN_SECRET: string;
  GITHUB_TOKEN: string;              // PAT with `repo` scope — required to read private brain
}

// Helper: Common headers for reads against private AetherCreator/SuperClaude repo
function ghReadHeaders(env: Env, accept?: string): Record<string, string> {
  const h: Record<string, string> = {
    'User-Agent': 'schemer-worker/1.0',
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

// Helper: Read lead/verdict from brain (private GitHub via raw.githubusercontent.com)
async function readJsonFromBrain(filePath: string, env: Env): Promise<any> {
  const r = await fetch(`${env.BRAIN_RAW_BASE}/${filePath}`, {
    headers: ghReadHeaders(env)
  });
  if (!r.ok) throw new Error(`brain_read ${r.status} for ${filePath}`);
  return await r.json();
}

// Helper: Find lead file (search today, yesterday, _drafts)
async function findLeadPath(leadId: string, env: Env): Promise<string | null> {
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const candidates = [
    `brain/05-leads/${today}/${leadId}.json`,
    `brain/05-leads/${yesterday}/${leadId}.json`,
    `brain/05-leads/_drafts/${leadId}.json`
  ];
  for (const p of candidates) {
    try {
      const r = await fetch(`${env.BRAIN_RAW_BASE}/${p}`, {
        method: 'HEAD',
        headers: ghReadHeaders(env)
      });
      if (r.ok) return p;
    } catch { /* try next */ }
  }
  return null;
}

// Helper: Extract JSON object from text (strip thinking blocks, markdown fences)
function extractJsonObject(text: string): any {
  const noThink = text.replace(/<\/think>/gi, '').trim();
  const noFence = noThink.replace(/^```(?:json)?\s*/m, '').replace(/```\s*$/m, '').trim();
  const start = noFence.indexOf('{');
  const end = noFence.lastIndexOf('}');
  const slice = (start >= 0 && end > start) ? noFence.slice(start, end + 1) : noFence;
  return JSON.parse(slice);
}

// Helper: Call Kimi K2.6 via Workers AI binding (sync)
async function callKimi(
  systemPrompt: string,
  userPrompt: string,
  env: Env,
  maxTokens: number = 16384
): Promise<string> {
  const result: any = await env.AI.run(env.NIM_MODEL, {
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ],
    temperature: 0.3,
    max_tokens: maxTokens
  });

  // Workers AI sync shape: { response: "..." } native OR { choices: [{message: {content}}] }
  const text =
    (typeof result?.response === 'string' && result.response) ||
    result?.choices?.[0]?.message?.content ||
    result?.result?.response ||
    '';

  if (!text) {
    throw new Error(`AI binding empty: keys=${Object.keys(result || {}).join(',')} | preview=${JSON.stringify(result).slice(0, 400)}`);
  }
  return text;
}

// Helper: Validate generated plan per FOUNDRY-SCHEMA §4.1
function validatePlan(planText: string): { valid: boolean; violations: string[] } {
  const violations: string[] = [];

  // Check for MAP.md structure
  if (!planText.includes('# Hunt:')) violations.push('Missing "# Hunt:" header');
  if (!planText.includes('## Clues')) violations.push('Missing "## Clues" section');

  // Parse clues
  const clueMatches = planText.match(/^\d+\.\s+\[.*\]/gm);
  if (!clueMatches || clueMatches.length < 3) violations.push('Need 3-5 clues');
  if (clueMatches && clueMatches.length > 5) violations.push('Maximum 5 clues exceeded');

  // Check each clue has pass line
  const lines = planText.split('\n');
  let inClue = false;
  let clueCount = 0;
  for (const line of lines) {
    if (/^\d+\.\s+\[/.test(line)) {
      inClue = true;
      clueCount++;
      continue;
    }
    if (inClue && line.trim().startsWith('pass:')) {
      inClue = false;
      continue;
    }
    if (inClue && line.trim() === '') {
      // Empty line within clue - continue
      continue;
    }
    if (inClue && /^\d+\.\s+\[/.test(line)) {
      // New clue started without pass line
      violations.push(`Clue ${clueCount} missing pass line`);
      inClue = true;
      clueCount++;
      continue;
    }
  }
  if (inClue) {
    // Last clue check
    if (!planText.split('\n').some(line => line.trim().startsWith('pass:'))) {
      violations.push(`Clue ${clueCount} missing pass line`);
    }
  }

  // Check for [CODE] and tier tags
  const codeTagMatches = planText.match(/\[CODE\]/g);
  if (!codeTagMatches || codeTagMatches.length < 3) violations.push('Each clue needs [CODE] tag');

  const sonnetMatches = planText.match(/\[Sonnet\]/g);
  const haikuMatches = planText.match(/\[Haiku\]/g);
  if ((sonnetMatches?.length ?? 0) + (haikuMatches?.length ?? 0) < 3) {
    violations.push('Each clue needs [Sonnet] or [Haiku] tier tag');
  }

  // Check estimated time ≤ 4 hours
  const timeMatch = planText.match(/Estimated build time\s*\n\s*\{?\s*(\d+(?:\.\d+)?)\s*hours?\s*\}?/i);
  if (timeMatch) {
    const hours = parseFloat(timeMatch[1]);
    if (hours > 4) violations.push(`Estimated time ${hours} hours exceeds 4 hour limit`);
  } else {
    violations.push('Missing or malformed "Estimated build time" line');
  }

  // Check clue 1 contains "Scaffold"
  const firstClueMatch = planText.match(/^1\.\s+\[.*\]\s+(.*?)(?:\n|$)/m);
  if (firstClueMatch && !firstClueMatch[1].toLowerCase().includes('scaffold')) {
    violations.push('Clue 1 title must contain "Scaffold"');
  }

  return { valid: violations.length === 0, violations };
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
        model: env.NIM_MODEL
      });
    }

    // POST /run-manual?lead_id=X&verdict_path=Y&secret=Z
    if (url.pathname === '/run-manual' && request.method === 'POST') {
      const secret = url.searchParams.get('secret');
      if (secret !== env.SCHEMER_RUN_SECRET) return new Response('Forbidden', { status: 403 });

      const leadId = url.searchParams.get('lead_id');
      if (!leadId) return Response.json({ error: 'lead_id_required' }, { status: 400 });

      const verdictPath = url.searchParams.get('verdict_path');
      const leadPath = verdictPath || await findLeadPath(leadId, env);
      if (!leadPath) return Response.json({ error: 'lead_not_found', lead_id: leadId }, { status: 404 });

      try {
        // Read lead and verdict
        const lead = await readJsonFromBrain(leadPath, env);
        const verdictPathActual = leadPath.replace(/\.json$/, '.verdict.json');
        const verdict = await readJsonFromBrain(verdictPathActual, env);

        if (verdict.verdict !== 'approved') {
          return Response.json({ error: 'verdict_not_approved', verdict: verdict.verdict }, { status: 422 });
        }

        // Generate product slug from lead
        const productSlug = lead.product_slug || lead.lead_id.toLowerCase().replace(/[^a-z0-9]+/g, '-');

        // Build prompts for Kimi
        const systemPrompt = `You are The Schemer — a product architect who converts validated demand signals into executable build plans. You write THDD (Treasure Hunt Driven Development) scaffolds that Claude Code can execute autonomously.

Your output is a complete MAP.md + clue cache files. Every clue must be:
- Self-contained (all context needed is in the clue)
- Testable (clear pass/fail criteria)
- Deployable (includes the push-to-GitHub step)
- Ordered correctly (dependencies respected)

You think like a chef doing mise en place: everything prepped, measured, and in position before the first pan hits the heat.

Output ONLY the MAP.md content. Do not include clue cache files in this response — they will be generated separately if needed.`;

        const userPrompt = `Generate a complete THDD hunt for this approved product:

LEAD: ${JSON.stringify(lead, null, 2)}
COUNCIL_RESULTS: ${JSON.stringify(verdict, null, 2)}

Available infrastructure:
- Vercel (hosting + serverless functions)
- Stripe (payments, keys already configured)
- Cloudflare Workers (API proxy if needed)
- React 19 + Tailwind 4 (UI)
- Supabase (backend if needed, already connected)
- Domain: auto-assigned via Vercel

Output a MAP.md with this structure:

# Hunt: {product-slug}
Schema: foundry-1.0
Generated: {current ISO8601 timestamp}
Source verdict: {verdict_path}
Source lead: {lead_id}
Goal: {one sentence — what ships}
Repo: {product-slug} (new repo)
Treasure: {what Tyler sees when it works}

## Clues

1. [CODE] [Sonnet] **Scaffold** — {one-line desc}
   pass: {explicit criterion incl. GitHub push step}

2. [CODE] [Sonnet] **{Title}** — {one-line desc}
   pass: {criterion}

(3-5 clues total)

## Estimated build time
{N} hours (must be ≤ 4)`;

        // Call Kimi with retries
        let planText = '';
        let lastError = '';
        for (let attempt = 0; attempt <= parseInt(env.MAX_RETRIES); attempt++) {
          try {
            planText = await callKimi(systemPrompt, userPrompt, env);
            break;
          } catch (err: any) {
            lastError = err.message;
            if (attempt === parseInt(env.MAX_RETRIES)) throw err;
            // Brief pause before retry
            await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
          }
        }

        // Validate plan
        const validation = validatePlan(planText);
        if (!validation.valid) {
          // Write diagnostic to brain
          const sessionId = crypto.randomUUID();
          const diagnostic = {
            session_id: sessionId,
            lead_id: lead.lead_id,
            verdict_path: verdictPathActual,
            attempted_plan: planText,
            validation_errors: validation.violations,
            prompt_used: { system: systemPrompt, user: userPrompt },
            timestamp: new Date().toISOString()
          };

          await writeBrain(
            `brain/06-foundry/_drafts/schemer-error-${sessionId}.json`,
            JSON.stringify(diagnostic, null, 2),
            `schemer: validation failed for lead ${lead.lead_id}`,
            env
          );

          return Response.json({
            error: 'plan_validation_failed',
            violations: validation.violations,
            attempted_plan: planText
          }, { status: 422 });
        }

        // Write MAP.md and clue caches to brain
        const dateStr = new Date().toISOString().slice(0, 10);
        const brainPath = `brain/06-foundry/${dateStr}/${productSlug}`;

        await writeBrain(
          `${brainPath}/MAP.md`,
          planText,
          `schemer: generated MAP.md for lead ${lead.lead_id}`,
          env
        );

        // Generate simple clue cache files (placeholder for v1.0)
        const clueMatches = planText.match(/^\d+\.\s+\[.*\]/gm);
        if (clueMatches) {
          for (let i = 0; i < clueMatches.length; i++) {
            const clueNum = i + 1;
            await writeBrain(
              `${brainPath}/clue-caches/${clueNum}.md`,
              `# Clue ${clueNum}\n\nContext: See MAP.md clue ${clueNum}\n\nImplementation notes generated by Schemer.\n`,
              `schemer: generated clue cache ${clueNum} for lead ${lead.lead_id}`,
              env
            );
          }
        }

        // Return plan summary
        return Response.json({
          ok: true,
          persona: 'schemer',
          schema: 'foundry-1.0',
          model: env.NIM_MODEL,
          generated_at: new Date().toISOString(),
          brain_path: brainPath,
          plan_summary: {
            clues_found: clueMatches?.length ?? 0,
            estimated_time_hours: planText.match(/Estimated build time\s*\n\s*\{?\s*(\d+(?:\.\d+)?)\s*hours?\s*\}?/i)?.[1] ?? 'unknown'
          }
        });

      } catch (err: any) {
        await logIntel(env, {
          event: 'schemer_error',
          lead_id: url.searchParams.get('lead_id') ?? 'unknown',
          error: err.message
        });

        return Response.json({ error: 'schemer_failed', message: err.message }, { status: 500 });
      }
    }

    // POST /run/:lead_id?secret=X (webhook variant)
    const runMatch = url.pathname.match(/^\/run\/([a-z0-9][a-z0-9-]{2,63})$/);
    if (runMatch && request.method === 'POST') {
      const secret = url.searchParams.get('secret');
      if (secret !== env.SCHEMER_RUN_SECRET) return new Response('Forbidden', { status: 403 });

      // For v1.0, webhook behaves same as manual but without verdict_path override
      // In v1.1, this would be triggered by Council on approved verdict
      return Response.json({
        error: 'webhook_endpoint_not_implemented_v1_0',
        hint: 'Use /run-manual for v1.0 MVP; webhook chain deferred to v1.1'
      }, { status: 501 });
    }

    return new Response(
      'schemer worker — endpoints: GET /health; POST /run-manual; POST /run/:lead_id (v1.1 webhook)',
      { status: 404 }
    );
  }
};