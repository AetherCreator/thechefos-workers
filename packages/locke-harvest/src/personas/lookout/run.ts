// Lookout persona — extracted from index.ts per C1 refactor.
// Implements LIBRARIAN-SCHEMA.md framework + LOCKE-OUTPUT-SCHEMA.md contract.
// See prompts/LOOKOUT-SOUL.md for full role definition.

import { search as adapterSearch, routeFor } from '../../searchAdapters';
import type { Env } from '../../types';

// Theme clusters per prompts/LOCKE-THEME-CLUSTERS.md (the-prism clue-1).
// 5 themes × 4 queries. 2026-05-11 evening: lobsters + indiehackers queries
// replaced with reddit subreddit equivalents (Z3 free-coverage decision) so
// all 20 queries route through Reddit native search.json + HN Algolia — zero
// paid-tier dependency. Distinct subreddits count as distinct communities per
// LOCKE-OUTPUT-SCHEMA §2, preserving cross-community diversity for
// `pattern_type: repeated` per §3.
const HUNT_CLUSTERS: Record<string, string[]> = {
  manual_process_pain: [
    'site:reddit.com "I spend hours" manual OR "by hand"',
    'site:news.ycombinator.com "we built" OR "I built" "to automate"',
    'site:reddit.com/r/sysadmin "tedious" workflow',
    'site:reddit.com/r/Entrepreneur "I was spending" "every week"'
  ],
  build_vs_buy_friction: [
    'site:reddit.com "I built my own" "because" tool',
    'site:news.ycombinator.com "I rolled my own" OR "wrote my own"',
    'site:reddit.com/r/SideProject "couldn\'t find" "so I built"',
    'site:reddit.com/r/webdev "yak shaving" OR "ended up building"'
  ],
  current_solution_failures: [
    'site:reddit.com/r/SaaS "switched from" "because"',
    'site:reddit.com/r/startups "alternative to" "but" "doesn\'t"',
    'site:news.ycombinator.com "Show HN" "alternative" OR "better than"',
    'site:reddit.com/r/smallbusiness "tried" "but" "ended up"'
  ],
  mvp_validation_signals: [
    'site:reddit.com/r/SaaS "first paying customer" OR "first sale"',
    'site:reddit.com/r/indiehackers "validated" OR "MRR"',
    'site:news.ycombinator.com "Show HN" "looking for feedback"',
    'site:reddit.com/r/SideProject "month 1" OR "month 2" "revenue"'
  ],
  growth_bottleneck: [
    'site:reddit.com/r/SaaS "stuck at" MRR OR "plateau"',
    'site:reddit.com/r/Entrepreneur "can\'t scale" OR "bottleneck"',
    'site:news.ycombinator.com "Ask HN" "scaling" solo',
    'site:reddit.com/r/buildinpublic "the hardest part" OR "bottleneck"'
  ]
};
const HUNT_QUERIES: Array<{ theme: string; query: string }> = Object.entries(HUNT_CLUSTERS)
  .flatMap(([theme, queries]) => queries.map(query => ({ theme, query })));

const SYSTEM_PROMPT = `You are Lookout, Tyler's demand-signal hunter posted to the crow's nest of the THDD crew. Extract product opportunities from search results.

Rules:
- PAIN over features. Profile WHO hurts (role, industry, budget). Identify existing solutions + why they fail.
- Be honest: one complaint ≠ a market. Cross-community patterns matter. Honest beats fabricated.
- evidence[] per LOCKE-OUTPUT-SCHEMA v1.2 §2: {thread_url, community, snippet, harvested_at, pattern_signal, pain_match}. community: reddit | reddit:r/<name> | hn | lobsters | indiehackers | other:<host>. HN-linked GitHub repos use other:github.com. Use exactly the harvested_at value provided in the schema example below; never invent timestamps.

- evidence[].pain_match (REQUIRED, 30-200 chars) is how you prove coherence. State the role, workflow, and broken state of the thread's user, and how they match the lead's pain_statement. If you cannot write a coherent pain_match that ties to the lead's pain_statement, the entry is NOT corroborates.

- pattern_signal selection (STRUCTURAL — driven by pain_match):
  * corroborates → pain_match articulates SAME role, SAME workflow, SAME broken state as the lead's pain_statement
  * orthogonal → related theme but different role/workflow/state (do not let topic keywords like "manual", "automate", "slow", "tedious" deceive you across unrelated domains)
  * contradicts → opposite outcome or refuted premise

WORKED EXAMPLES:

OK (corroborates ×3 → repeated):
  Lead pain_statement: "Solo SaaS founders losing 6+ hrs/week to support tickets"
  Evidence A pain_match: "Solo SaaS founder; workflow=customer support; broken state=6h/week reconciling tickets. Match."
  Evidence B pain_match: "Solo SaaS founder on r/SaaS; workflow=support tickets; broken state=50+/day eating focus. Match."
  Evidence C pain_match: "Bootstrapped SaaS solo dev; workflow=customer support; broken state=weekend hours lost to tickets. Match."

NOT OK (intra-theme but incoherent — fire 10 failure pattern):
  Lead pain_statement: "Solo bootstrapped founders scaling team beyond one person"
  Evidence A pain_match: "Solo founder asks how to scale from 1-person to bigger team — direct match." → corroborates
  Evidence B (about churn): "App maker asks how to reduce app churn. Different role (app maker not founder), different workflow (retention not hiring), different broken state. NOT coherent with scaling team." → orthogonal

- pattern_type per §3 against your evidence:
  * single_signal: length=1 OR all communities identical
  * repeated: length≥3 AND ≥2 distinct communities AND all corroborates
  * long_con: length≥5 with ≥3 distinct (or ≥2 distinct spanning >30d)
  * any contradicts/orthogonal → single_signal
- Mark lower if evidence doesn't earn higher.

Return ONLY a JSON array. [] if no real signal. No prose. No fences. No <think>.`;

function buildUserPrompt(
  results: Array<{ url: string; title: string; snippet: string; theme: string }>,
  harvestedAt: string
): string {
  const trimmed = results.map(r => ({
    url: r.url,
    title: (r.title || '').slice(0, 120),
    snippet: (r.snippet || '').slice(0, 240),
    theme: r.theme
  }));
  return `Analyze candidates for product demand signals. Each candidate carries its theme cluster (manual_process_pain | build_vs_buy_friction | current_solution_failures | mvp_validation_signals | growth_bottleneck).

Candidates:
${JSON.stringify(trimmed, null, 2)}

For each opportunity (max 5), return JSON matching exactly:
{
  "lead_id": "kebab-3-to-64-chars",
  "source_threads": [{"url":"...","platform":"reddit","title":"...","upvotes":0,"comment_count":0,"harvested_at":"ISO8601"}],
  "mark_profile": "20-200 chars: who hurts + budget signal (avoid 'everyone'/'all developers')",
  "pain_statement": "30-300 chars, specific",
  "pain_frequency": "daily|weekly|monthly|once",
  "pain_intensity": "annoying|painful|critical",
  "existing_solutions": [{"name":"X","weakness":"why it fails","signals":["quote"]}],
  "angle": "30-400 chars, what a simple product looks like",
  "estimated_price": "$X.XX/mo",
  "market_size_signal": "niche|solid|large",
  "confidence": "low|medium|high|dead_certain",
  "pattern_type": "single_signal|repeated|long_con",
  "thread_count": 0,
  "total_upvotes": 0,
  "related_leads": [],
  "locke_notes": "30-300 chars in your voice — Lookout, the demand-signal hunter (field name retained for schema compat)",
  "evidence": [
    {
      "thread_url": "https://... (MUST come from candidates above)",
      "community": "reddit:r/<name> | reddit | hn | lobsters | indiehackers | other:<host>",
      "snippet": "1-500 char exact quote signaling the pain",
      "harvested_at": "${harvestedAt}",
      "pattern_signal": "corroborates|contradicts|orthogonal",
      "pain_match": "30-200 chars: how this thread's role+workflow+broken_state matches the lead's pain_statement"
    }
  ]
}

evidence[]: ≥1 entry. No duplicate thread_url per lead. Every entry MUST include pain_match. Use exactly "${harvestedAt}" for evidence[].harvested_at — do NOT generate dates. pattern_type enforced per §3.

Return ONLY a JSON array. [] if no real signal. Honest beats fabricated.`;
}

async function logIntel(env: Env, event: Record<string, any>): Promise<void> {
  try {
    await fetch(env.INTEL_LOG_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ persona: env.PERSONA, ...event, ts: new Date().toISOString() })
    });
  } catch (e) {
    console.warn('intel_log failed:', e);
  }
}

async function callLLM(systemPrompt: string, userPrompt: string, env: Env): Promise<{ text: string; raw: any }> {
  const response: any = await env.AI.run(env.NIM_MODEL, {
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ],
    temperature: 0.3,
    max_tokens: 6144,
    stream: false
  });
  const rawText =
    response?.response ||
    response?.choices?.[0]?.message?.content ||
    response?.choices?.[0]?.text ||
    '';
  const text = typeof rawText === 'string' ? rawText : JSON.stringify(rawText);
  if (!text) {
    throw new Error(`Workers AI empty: keys=${Object.keys(response || {}).join(',')} | preview=${JSON.stringify(response).slice(0, 600)}`);
  }
  return { text, raw: response };
}

const COMMUNITY_REGEX = /^(reddit(:r\/[a-zA-Z0-9_]+)?|hn|lobsters|indiehackers|other:[a-z0-9.-]+)$/;
const PATTERN_SIGNAL_ENUM = new Set(['corroborates', 'contradicts', 'orthogonal']);
const PATTERN_TYPE_RANK: Record<string, number> = { single_signal: 1, repeated: 2, long_con: 3 };

const STOPWORDS = new Set(['the','a','an','and','or','but','of','in','on','at','to','for','with','by','from','as','is','are','was','were','be','been','being','have','has','had','do','does','did','will','would','could','should','may','might','must','can','this','that','these','those','it','its','they','them','their','i','me','my','we','us','our','you','your','he','him','his','she','her','about','if','then','than','also','not','no','so','too','very','just','more','most','some','any','all','each','every']);

function contentWords(text: string): Set<string> {
  return new Set(
    (text || '')
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(w => w.length >= 3 && !STOPWORDS.has(w))
  );
}

function painMatchOverlap(painMatch: string, painStatement: string): number {
  const matchWords = contentWords(painMatch);
  const stmtWords = contentWords(painStatement);
  let overlap = 0;
  for (const w of matchWords) if (stmtWords.has(w)) overlap++;
  return overlap;
}

function isValidLead(lead: any): { ok: boolean; reason?: string } {
  if (!lead || typeof lead !== 'object') return { ok: false, reason: 'not-object' };
  const required = ['lead_id', 'source_threads', 'mark_profile', 'pain_statement', 'pain_frequency',
    'pain_intensity', 'angle', 'estimated_price', 'market_size_signal', 'confidence',
    'pattern_type', 'thread_count', 'total_upvotes', 'locke_notes', 'evidence'];
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

  if (!Array.isArray(lead.evidence) || lead.evidence.length < 1) {
    return { ok: false, reason: 'evidence-empty' };
  }
  const seenThreadUrls = new Set<string>();
  for (let i = 0; i < lead.evidence.length; i++) {
    const e = lead.evidence[i];
    if (!e || typeof e !== 'object') return { ok: false, reason: `evidence[${i}]-not-object` };
    if (typeof e.thread_url !== 'string' || !e.thread_url) return { ok: false, reason: `evidence[${i}].thread_url-missing` };
    try { new URL(e.thread_url); } catch { return { ok: false, reason: `evidence[${i}].thread_url-invalid` }; }
    if (seenThreadUrls.has(e.thread_url)) return { ok: false, reason: `evidence[${i}].thread_url-duplicate` };
    seenThreadUrls.add(e.thread_url);
    if (typeof e.community !== 'string' || !COMMUNITY_REGEX.test(e.community)) return { ok: false, reason: `evidence[${i}].community-format` };
    if (typeof e.snippet !== 'string' || e.snippet.length < 1 || e.snippet.length > 500) return { ok: false, reason: `evidence[${i}].snippet-length` };
    if (typeof e.harvested_at !== 'string' || !e.harvested_at) return { ok: false, reason: `evidence[${i}].harvested_at-missing` };
    if (typeof e.pattern_signal !== 'string' || !PATTERN_SIGNAL_ENUM.has(e.pattern_signal)) return { ok: false, reason: `evidence[${i}].pattern_signal-enum` };
    if (typeof e.pain_match !== 'string' || !e.pain_match) {
      return { ok: false, reason: `evidence[${i}].pain_match-missing` };
    }
    if (e.pain_match.length < 30 || e.pain_match.length > 200) {
      return { ok: false, reason: `evidence[${i}].pain_match-length` };
    }
    if (e.pattern_signal === 'corroborates') {
      if (painMatchOverlap(e.pain_match, lead.pain_statement) < 2) {
        return { ok: false, reason: `evidence[${i}].pain_match-incoherent` };
      }
    }
  }

  const evLen = lead.evidence.length;
  const distinctCommunities = new Set(lead.evidence.map((e: any) => e.community)).size;
  const allCorroborate = lead.evidence.every((e: any) => e.pattern_signal === 'corroborates');
  let daySpan = 0;
  if (evLen >= 2) {
    const times = lead.evidence
      .map((e: any) => Date.parse(e.harvested_at))
      .filter((t: number) => Number.isFinite(t));
    if (times.length >= 2) {
      daySpan = (Math.max(...times) - Math.min(...times)) / 86_400_000;
    }
  }
  let earned: 'single_signal' | 'repeated' | 'long_con';
  if (!allCorroborate) {
    earned = 'single_signal';
  } else if ((evLen >= 5 && distinctCommunities >= 3) || (distinctCommunities >= 2 && daySpan > 30)) {
    earned = 'long_con';
  } else if (evLen >= 3 && distinctCommunities >= 2) {
    earned = 'repeated';
  } else {
    earned = 'single_signal';
  }
  if (PATTERN_TYPE_RANK[lead.pattern_type] > PATTERN_TYPE_RANK[earned]) {
    return { ok: false, reason: 'pattern_type-evidence-mismatch' };
  }

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

function extractJsonArray(text: string): any[] {
  const noThink = text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  const noFence = noThink.replace(/^```(?:json)?\s*/m, '').replace(/```\s*$/m, '').trim();
  const start = noFence.indexOf('[');
  const end = noFence.lastIndexOf(']');
  const slice = (start >= 0 && end > start) ? noFence.slice(start, end + 1) : noFence;
  const parsed = JSON.parse(slice);
  return Array.isArray(parsed) ? parsed : [];
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function checkTelemetry(): Promise<{ traffic_light: string; neurons_remaining_estimate?: number }> {
  try {
    const r = await fetch("https://cost-telemetry.tveg-baking.workers.dev/dashboard", { signal: AbortSignal.timeout(5000) });
    if (!r.ok) return { traffic_light: "unknown" };
    return await r.json() as { traffic_light: string; neurons_remaining_estimate?: number };
  } catch {
    return { traffic_light: "unknown" };
  }
}

async function runHunt(env: Env, trigger: 'cron' | 'manual'): Promise<{ kept: number; discarded: number; status: string; session_id: string }> {
  const sessionId = crypto.randomUUID();
  const startedAt = Date.now();

  const tel = await checkTelemetry();
  if (tel.traffic_light === "red" || tel.traffic_light === "depleted") {
    await logIntel(env, { event: 'deferred_neurons_low', session_id: sessionId, trigger, telemetry: tel });
    const deferredReport = {
      session_id: sessionId,
      persona: env.PERSONA,
      trigger,
      started_at: new Date(startedAt).toISOString(),
      ended_at: new Date().toISOString(),
      wall_clock_ms: Date.now() - startedAt,
      candidates_scanned: 0,
      nim_calls: 0,
      leads_kept: 0,
      leads_discarded: 0,
      status: 'deferred',
      reason: 'neurons_low',
      telemetry: tel
    };
    try {
      await writeBrain(
        `${env.BRAIN_PATH}/_sessions/${env.PERSONA}-${sessionId}.json`,
        JSON.stringify(deferredReport, null, 2),
        `locke-harvest deferred: ${sessionId} (neurons_low)`,
        env
      );
    } catch (_) { /* best-effort */ }
    return { kept: 0, discarded: 0, status: 'deferred', session_id: sessionId };
  }

  const wallClockBudget = parseInt(env.WALL_CLOCK_BUDGET_MS, 10);
  const maxLeads = parseInt(env.MAX_LEADS_PER_RUN, 10);
  const nimBudget = parseInt(env.NIM_BUDGET, 10);
  const perQuerySleep = parseInt(env.PER_QUERY_SLEEP_MS || '0', 10);

  await logIntel(env, { event: 'harvest_start', session_id: sessionId, trigger });

  const seenUrls = new Set<string>();
  const candidates: Array<{ url: string; title: string; snippet: string; theme: string }> = [];
  let nimCalls = 0;

  const queryEvents: any[] = [];
  let queriesSucceeded = 0;
  let queriesFailed = 0;
  let queryIdx = 0;
  let budgetExhausted = false;
  const perQueryBuckets: Array<Array<{ url: string; title: string; snippet: string; theme: string }>> = [];
  for (const { theme, query } of HUNT_QUERIES) {
    if (Date.now() - startedAt > wallClockBudget) {
      budgetExhausted = true;
      queryEvents.push({ theme, query, status: 'skipped_budget' });
      perQueryBuckets.push([]);
      break;
    }
    if (queryIdx > 0 && perQuerySleep > 0) {
      await sleep(perQuerySleep);
    }
    queryIdx++;
    const bucket: Array<{ url: string; title: string; snippet: string; theme: string }> = [];
    try {
      const results = await adapterSearch(query, env);
      queriesSucceeded++;
      queryEvents.push({ theme, query, adapter: routeFor(query), count: results.length, status: 'ok' });
      for (const r of results) {
        if (!r.url || seenUrls.has(r.url)) continue;
        seenUrls.add(r.url);
        bucket.push({ url: r.url, title: r.title || '', snippet: r.content || '', theme });
      }
    } catch (e: any) {
      queriesFailed++;
      queryEvents.push({ theme, query, adapter: routeFor(query), status: 'error', error: String(e?.message ?? e).slice(0, 200) });
    }
    perQueryBuckets.push(bucket);
  }
  const maxBucketLen = perQueryBuckets.reduce((m, b) => Math.max(m, b.length), 0);
  for (let pos = 0; pos < maxBucketLen; pos++) {
    for (const bucket of perQueryBuckets) {
      if (pos < bucket.length) {
        candidates.push(bucket[pos]);
      }
    }
  }
  await logIntel(env, {
    event: 'phase1_summary',
    session_id: sessionId,
    queries_total: queryIdx,
    queries_succeeded: queriesSucceeded,
    queries_failed: queriesFailed,
    budget_exhausted: budgetExhausted,
    candidates_after_dedup: candidates.length,
    candidate_ordering: 'round_robin_per_query',
    events: queryEvents
  });

  if (candidates.length < 3) {
    await logIntel(env, { event: 'harvest_complete', session_id: sessionId, status: 'no_signal', kept: 0, discarded: 0 });
    return { kept: 0, discarded: 0, status: 'no_signal', session_id: sessionId };
  }

  const harvestedAt = new Date().toISOString();
  const candidatesSent = candidates.slice(0, 8);
  const userPrompt = buildUserPrompt(candidatesSent, harvestedAt);
  let leads: any[] = [];
  let nimText = '';
  let nimRaw: any = null;
  let nimError: string | null = null;
  let nimErrorStack: string | null = null;
  let reachedPhase3 = false;
  try {
    if (nimCalls >= nimBudget) throw new Error('nim_budget_exhausted');
    reachedPhase3 = true;
    const result = await callLLM(SYSTEM_PROMPT, userPrompt, env);
    nimText = result.text;
    nimRaw = result.raw;
    nimCalls++;
    leads = extractJsonArray(nimText);
  } catch (e: any) {
    const errMsg = String(e?.message ?? e);
    nimError = errMsg;
    nimErrorStack = String(e?.stack ?? '').slice(0, 2000);
    await logIntel(env, { event: 'nim_failed', session_id: sessionId, error: errMsg });
    leads = [];
  }

  if (reachedPhase3) {
    try {
      await writeBrain(
        `${env.BRAIN_PATH}/_drafts/analyzer-trace-${sessionId}.json`,
        JSON.stringify({
          session_id: sessionId,
          timestamp: new Date().toISOString(),
          model: env.NIM_MODEL,
          slice_indices: [0, 8],
          candidates_scanned_total: candidates.length,
          candidates_sent_count: candidatesSent.length,
          candidates_sent: candidatesSent,
          system_prompt: SYSTEM_PROMPT,
          user_prompt: userPrompt,
          raw_response: nimRaw,
          extracted_text: nimText,
          extracted_text_length: nimText.length,
          leads_parsed: leads,
          leads_parsed_count: leads.length,
          nim_error: nimError,
          nim_error_stack: nimErrorStack,
          notes: 'OPS-LOCKE-ANALYZER-TUNING diagnostic capture — model input/output for empty-leads disambiguation'
        }, null, 2),
        `locke-harvest analyzer trace: ${sessionId} (${leads.length} parsed, error=${nimError ?? 'none'})`,
        env
      );
    } catch (_) { /* best-effort */ }
  }

  const today = new Date().toISOString().slice(0, 10);
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

  const sessionReport = {
    session_id: sessionId,
    persona: env.PERSONA,
    trigger,
    started_at: new Date(startedAt).toISOString(),
    ended_at: new Date().toISOString(),
    wall_clock_ms: Date.now() - startedAt,
    candidates_scanned: candidates.length,
    nim_calls: nimCalls,
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

export async function runLookout(env: Env, request: Request, _ctx: ExecutionContext): Promise<Response> {
  const trigger = request.headers.get('x-trigger') === 'cron' ? 'cron' : 'manual';
  const result = await runHunt(env, trigger);
  return Response.json(result);
}
