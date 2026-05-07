// Locke Harvest Worker — implements LIBRARIAN-SCHEMA.md framework + LOCKE-OUTPUT-SCHEMA.md contract.
// Trigger: cron "0 0 * * 0" (Sunday midnight UTC) OR POST /run?secret=X for manual fire.
// MVP scope: Phase 1 (SearXNG) + Phase 3 (Gemini analysis). Phase 2 (Agent-Reach) deferred per C1 audit.
// MVP dedup: in-memory only (per-invocation Set<string>). KV-backed cross-invocation dedup is post-MVP.

interface Env {
  PERSONA: string;
  BRAIN_PATH: string;
  SEARXNG_URL: string;
  INTEL_LOG_URL: string;
  BRAIN_WRITE_URL: string;
  GEMINI_MODEL: string;
  SCHEMA_VERSION: string;
  MAX_LEADS_PER_RUN: string;
  WALL_CLOCK_BUDGET_MS: string;
  GEMINI_BUDGET: string;
  // Secrets (set via `wrangler secret put`):
  GEMINI_API_KEY: string;
  BRAIN_WRITE_SECRET: string;
  HARVEST_RUN_SECRET: string;
}

const HUNT_QUERIES = [
  'site:reddit.com "I wish there was" tool app',
  'site:reddit.com "I spend hours" manual workflow',
  'site:reddit.com "there has to be a better way"',
  'site:news.ycombinator.com "Show HN" "looking for feedback"',
  'site:reddit.com "switched from" "because"',
  'site:reddit.com/r/SaaS "validated" OR "first paying customer"',
  'site:reddit.com/r/indiehackers "revenue" AND "solo"',
  'site:reddit.com "wish" AND "tool" AND "exists"',
  'site:reddit.com "manual process" "annoying"',
  'site:reddit.com "alternative to" "but"'
];

const SYSTEM_PROMPT = `You are Locke Lamora, the Thorn of Camorr — Tyler's autonomous demand signal hunter.
You read forum threads as a thief reads a tavern: looking for marks, listening for pain.
Your job: extract structured product opportunity data from raw search results.

Rules:
- Focus on PAIN, not features
- Profile WHO is hurting (role, industry, budget signals)
- Identify existing solutions and WHY they fail
- Be brutally honest about signal strength. One person complaining is not a market
- Flag Long Con patterns: same pain across different communities

Return ONLY a JSON array of leads. No prose. No markdown fences. No commentary.`;

function buildUserPrompt(results: Array<{ url: string; title: string; snippet: string }>): string {
  return `Analyze these search results for product demand signals.

Search results:
${JSON.stringify(results, null, 2)}

For each potential opportunity (max 5), return JSON matching this exact shape:
{
  "lead_id": "kebab-slug-3-to-64-chars",
  "source_threads": [{"url":"...","platform":"reddit","title":"...","upvotes":0,"comment_count":0,"harvested_at":"ISO8601"}],
  "mark_profile": "20-200 chars, who is hurting + budget signal (avoid 'everyone' / 'all developers')",
  "pain_statement": "30-300 chars, specific manual or painful action",
  "pain_frequency": "daily|weekly|monthly|once",
  "pain_intensity": "annoying|painful|critical",
  "existing_solutions": [{"name":"X","weakness":"why it fails","signals":["quote"]}],
  "angle": "30-400 chars, what a simple product would look like",
  "estimated_price": "$X.XX/mo",
  "market_size_signal": "niche|solid|large",
  "confidence": "low|medium|high|dead_certain",
  "pattern_type": "single_signal|repeated|long_con",
  "thread_count": 0,
  "total_upvotes": 0,
  "related_leads": [],
  "locke_notes": "30-300 chars, your one-liner in Locke's voice"
}

Return ONLY a JSON array. Return [] if no real signal found. Honest beats fabricated.`;
}

async function logIntel(env: Env, event: Record<string, any>): Promise<void> {
  try {
    await fetch(env.INTEL_LOG_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ persona: env.PERSONA, ...event, ts: new Date().toISOString() })
    });
  } catch (e) {
    // intel_log is best-effort; never fail the hunt because telemetry is down
    console.warn('intel_log failed:', e);
  }
}

async function searxngSearch(query: string, env: Env): Promise<Array<{ url: string; title: string; content: string }>> {
  const url = new URL(env.SEARXNG_URL);
  url.searchParams.set('q', query);
  url.searchParams.set('format', 'json');
  url.searchParams.set('safesearch', '0');
  const r = await fetch(url.toString(), { headers: { 'User-Agent': 'locke-harvest/1.0' } });
  if (!r.ok) throw new Error(`SearXNG ${r.status}`);
  const data: any = await r.json();
  return (data.results || []).slice(0, 10);
}

async function callGemini(systemPrompt: string, userPrompt: string, env: Env): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${env.GEMINI_MODEL}:generateContent?key=${env.GEMINI_API_KEY}`;
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
      generationConfig: { temperature: 0.3, maxOutputTokens: 4096 }
    })
  });
  if (!r.ok) throw new Error(`Gemini ${r.status}: ${await r.text()}`);
  const data: any = await r.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
}

function isValidLead(lead: any): { ok: boolean; reason?: string } {
  if (!lead || typeof lead !== 'object') return { ok: false, reason: 'not-object' };
  const required = ['lead_id', 'source_threads', 'mark_profile', 'pain_statement', 'pain_frequency',
    'pain_intensity', 'angle', 'estimated_price', 'market_size_signal', 'confidence',
    'pattern_type', 'thread_count', 'total_upvotes', 'locke_notes'];
  for (const f of required) {
    if (lead[f] === undefined || lead[f] === null) return { ok: false, reason: `missing:${f}` };
  }
  if (!/^[a-z0-9][a-z0-9-]{2,63}$/.test(lead.lead_id)) return { ok: false, reason: 'lead_id-format' };
  if (!Array.isArray(lead.source_threads) || lead.source_threads.length < 1) return { ok: false, reason: 'no-source-threads' };
  if (!['daily', 'weekly', 'monthly', 'once'].includes(lead.pain_frequency)) return { ok: false, reason: 'pain_frequency-enum' };
  if (!['annoying', 'painful', 'critical'].includes(lead.pain_intensity)) return { ok: false, reason: 'pain_intensity-enum' };
  if (!['niche', 'solid', 'large'].includes(lead.market_size_signal)) return { ok: false, reason: 'market_size_signal-enum' };
  if (!['low', 'medium', 'high', 'dead_certain'].includes(lead.confidence)) return { ok: false, reason: 'confidence-enum' };
  if (!['single_signal', 'repeated', 'long_con'].includes(lead.pattern_type)) return { ok: false, reason: 'pattern_type-enum' };
  if (/^(everyone|all (developers|users|people)|most (people|users))/i.test(lead.mark_profile)) return { ok: false, reason: 'generic-mark_profile' };
  return { ok: true };
}

async function writeBrain(path: string, content: string, message: string, env: Env): Promise<void> {
  const r = await fetch(env.BRAIN_WRITE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-webhook-secret': env.BRAIN_WRITE_SECRET },
    body: JSON.stringify({ path, content, message })
  });
  if (!r.ok) throw new Error(`brain-write ${r.status}: ${await r.text()}`);
}

async function runHunt(env: Env, trigger: 'cron' | 'manual'): Promise<{ kept: number; discarded: number; status: string; session_id: string }> {
  const sessionId = crypto.randomUUID();
  const startedAt = Date.now();
  const wallClockBudget = parseInt(env.WALL_CLOCK_BUDGET_MS, 10);
  const maxLeads = parseInt(env.MAX_LEADS_PER_RUN, 10);
  const geminiBudget = parseInt(env.GEMINI_BUDGET, 10);

  await logIntel(env, { event: 'harvest_start', session_id: sessionId, trigger });

  const seenUrls = new Set<string>();
  const candidates: Array<{ url: string; title: string; snippet: string }> = [];
  let geminiCalls = 0;

  // Phase 1 — SearXNG meta-search
  for (const q of HUNT_QUERIES) {
    if (Date.now() - startedAt > wallClockBudget) {
      await logIntel(env, { event: 'budget_exhausted', reason: 'wall_clock_phase1', session_id: sessionId });
      break;
    }
    try {
      const results = await searxngSearch(q, env);
      await logIntel(env, { event: 'query_executed', session_id: sessionId, query: q, count: results.length });
      for (const r of results) {
        if (!r.url || seenUrls.has(r.url)) continue;
        seenUrls.add(r.url);
        candidates.push({ url: r.url, title: r.title || '', snippet: r.content || '' });
      }
    } catch (e: any) {
      await logIntel(env, { event: 'query_failed', session_id: sessionId, query: q, error: String(e?.message ?? e) });
    }
  }

  if (candidates.length < 3) {
    await logIntel(env, { event: 'harvest_complete', session_id: sessionId, status: 'no_signal', kept: 0, discarded: 0 });
    return { kept: 0, discarded: 0, status: 'no_signal', session_id: sessionId };
  }

  // Phase 3 — Gemini analysis (Phase 2 Agent-Reach deferred; we send title+snippet only)
  let leads: any[] = [];
  try {
    if (geminiCalls >= geminiBudget) throw new Error('gemini_budget_exhausted');
    const userPrompt = buildUserPrompt(candidates.slice(0, 25));
    const text = await callGemini(SYSTEM_PROMPT, userPrompt, env);
    geminiCalls++;
    const cleaned = text.replace(/^```(?:json)?\s*/m, '').replace(/```\s*$/m, '').trim();
    const parsed = JSON.parse(cleaned);
    leads = Array.isArray(parsed) ? parsed : [];
  } catch (e: any) {
    await logIntel(env, { event: 'gemini_failed', session_id: sessionId, error: String(e?.message ?? e) });
    leads = [];
  }

  // Validate + write
  const today = new Date().toISOString().slice(0, 10);
  const harvestedAt = new Date().toISOString();
  let kept = 0, discarded = 0;

  for (const raw of leads.slice(0, maxLeads)) {
    const enriched = {
      schema_version: env.SCHEMA_VERSION,
      persona: env.PERSONA,
      harvest_session_id: sessionId,
      harvested_at: harvestedAt,
      ...raw
    };
    const validation = isValidLead(enriched);
    if (!validation.ok) {
      discarded++;
      await logIntel(env, { event: 'lead_discarded', session_id: sessionId, lead_id: raw?.lead_id, reason: validation.reason });
      continue;
    }
    const dir = (enriched.confidence === 'low' || enriched.pattern_type === 'single_signal')
      ? `${env.BRAIN_PATH}/_drafts`
      : `${env.BRAIN_PATH}/${today}`;
    const path = `${dir}/${enriched.lead_id}.json`;
    try {
      await writeBrain(path, JSON.stringify(enriched, null, 2),
        `locke-harvest: ${enriched.lead_id} (${enriched.confidence}/${enriched.pattern_type})`, env);
      kept++;
      await logIntel(env, { event: 'lead_kept', session_id: sessionId, lead_id: enriched.lead_id, confidence: enriched.confidence });
    } catch (e: any) {
      discarded++;
      await logIntel(env, { event: 'brain_write_failed', session_id: sessionId, lead_id: enriched.lead_id, error: String(e?.message ?? e) });
    }
  }

  // Session report
  const sessionReport = {
    session_id: sessionId,
    persona: env.PERSONA,
    trigger,
    started_at: new Date(startedAt).toISOString(),
    ended_at: new Date().toISOString(),
    wall_clock_ms: Date.now() - startedAt,
    candidates_scanned: candidates.length,
    gemini_calls: geminiCalls,
    leads_kept: kept,
    leads_discarded: discarded,
    status: kept > 0 ? 'complete' : (leads.length > 0 ? 'all_discarded' : 'no_leads')
  };
  try {
    await writeBrain(
      `${env.BRAIN_PATH}/_sessions/${env.PERSONA}-${sessionId}.json`,
      JSON.stringify(sessionReport, null, 2),
      `locke-harvest session: ${sessionId} (${kept} kept, ${discarded} discarded)`,
      env
    );
  } catch (e) {
    console.warn('session report write failed:', e);
  }
  await logIntel(env, { event: 'harvest_complete', session_id: sessionId, status: sessionReport.status, kept, discarded });
  return { kept, discarded, status: sessionReport.status, session_id: sessionId };
}

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/health') {
      return Response.json({ ok: true, persona: env.PERSONA, schema: env.SCHEMA_VERSION });
    }
    if (url.pathname === '/run' && request.method === 'POST') {
      const secret = url.searchParams.get('secret') ?? request.headers.get('x-harvest-secret');
      if (secret !== env.HARVEST_RUN_SECRET) {
        return new Response('Forbidden', { status: 403 });
      }
      const result = await runHunt(env, 'manual');
      return Response.json(result);
    }
    return new Response('locke-harvest worker — POST /run?secret=X to fire; GET /health for status', { status: 404 });
  },
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(runHunt(env, 'cron').then(() => undefined));
  }
};
