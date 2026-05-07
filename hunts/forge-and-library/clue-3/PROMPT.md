[SUBSTANTIAL]

# C3 — Locke Harvest Worker `[CODE-AUTONOMOUS]` `[DETERMINISTIC]` `[SUBSTANTIAL]`

**Hunt:** forge-and-library
**Clue:** 3 of 8
**Surface:** `[CODE-AUTONOMOUS]` — Tyler DM `/build forge-and-library 3` to `@Mastro_ClaudeBot` → WF04 → auto-exec.sh reads `[SUBSTANTIAL]` first line → claude-exec.sh → Claude Code 2.x via free-cc-proxy → NIM Nemotron-120B
**Class:** `[DETERMINISTIC]` — write 3 files verbatim from this PROMPT; no creative synthesis; ops are file-create + git-commit + CI-poll
**Executor:** `[SUBSTANTIAL]` — multi-file Cloudflare Worker scaffold; needs Read/Write/Edit/Bash and git push, beyond hunter-exec.py's 5-tool surface
**Bible:** 1.1 + §A7 (audit-wrap) + §A8 (reasoning-weight) + §A9 (executor classification)
**Repo:** `AetherCreator/thechefos-workers`
**Depends on:** C2 (LIBRARIAN-SCHEMA.md, LOCKE-OUTPUT-SCHEMA.md — both on origin/main)

---

## Mission

Create the `packages/locke-harvest/` Cloudflare Worker exactly as specified below. Three files, written verbatim. Push to `origin/main`. Wait for the existing `.github/workflows/deploy.yml` CI to run. Verify the `locke-harvest` Worker deployed successfully. Write `COMPLETE.md`.

The Worker implements `LIBRARIAN-SCHEMA.md` (harvest framework) with `LOCKE-OUTPUT-SCHEMA.md` (Lead JSON contract). MVP scope: Phase 1 (SearXNG meta-search) + Phase 3 (Gemini Flash analysis). Phase 2 (Agent-Reach extraction) is deferred — C1 pre-flight audit confirms Agent-Reach is not yet installed on InfiniVeg. KV-backed cross-invocation dedup is also deferred to keep MVP clean; the Worker uses in-memory dedup only for now (per-invocation set of seen URLs). Both deferrals are documented in COMPLETE.md.

You will not synthesize. You will copy the code blocks below into files at the exact paths specified. The variance you are allowed: nothing.

---

## Pre-flight (§A7 audit-wrap discipline)

Run these in order. AUDIT steps may legitimately exit non-zero — read the exit code as data, do not treat as failure. STRICT steps must exit 0.

```bash
# AUDIT 1 — confirm we are in the cloned working tree
pwd                                                    # AUDIT (any path under workspace ok)
git rev-parse --abbrev-ref HEAD                        # STRICT (must be main)

# AUDIT 2 — confirm C2 deliverables landed
test -f hunts/forge-and-library/LIBRARIAN-SCHEMA.md && echo "LIBRARIAN-SCHEMA: present" || echo "LIBRARIAN-SCHEMA: MISSING"
test -f hunts/forge-and-library/LOCKE-OUTPUT-SCHEMA.md && echo "LOCKE-OUTPUT-SCHEMA: present" || echo "LOCKE-OUTPUT-SCHEMA: MISSING"

# AUDIT 3 — confirm packages/ dir exists at root (sibling will live here)
ls -d packages 2>/dev/null && echo "packages/ exists" || echo "packages/ does NOT exist (will create)"

# AUDIT 4 — confirm deploy.yml exists
test -f .github/workflows/deploy.yml && echo "deploy.yml: present" || echo "deploy.yml: MISSING"

# AUDIT 5 — locke-harvest must NOT already exist
test -d packages/locke-harvest && echo "ABORT: packages/locke-harvest already exists" || echo "OK: clean slate"

# STRICT 6 — Tyler's user must be set for commits (claude-exec.sh handles this; verify)
git config user.name
git config user.email
```

If any AUDIT 2 result is `MISSING`, stop and write a clear failure note to clue-3/COMPLETE.md instead of proceeding — C2 is a hard dependency.
If AUDIT 5 is `ABORT`, stop with the same kind of note — this clue must not overwrite an existing scaffold.

---

## Task 1 — Create directory structure

```bash
mkdir -p packages/locke-harvest/src
```

---

## Task 2 — Write `packages/locke-harvest/wrangler.toml` verbatim

Write the file at `packages/locke-harvest/wrangler.toml` with **exactly** the following content. No additions. No reformatting.

```toml
name = "locke-harvest"
main = "src/index.ts"
compatibility_date = "2026-05-01"
compatibility_flags = ["nodejs_compat"]
account_id = "cc231edbff18405233612d7afb657f1f"

[triggers]
crons = ["0 0 * * 0"]

[vars]
PERSONA = "locke-lamora"
BRAIN_PATH = "brain/05-leads"
SEARXNG_URL = "https://searxng-tunnel.thechefos.app/search"
INTEL_LOG_URL = "https://api.thechefos.app/api/intel/log"
BRAIN_WRITE_URL = "https://api.thechefos.app/api/brain/push"
GEMINI_MODEL = "gemini-2.0-flash"
SCHEMA_VERSION = "locke-1.0"
MAX_LEADS_PER_RUN = "5"
WALL_CLOCK_BUDGET_MS = "480000"
GEMINI_BUDGET = "50"
```

---

## Task 3 — Write `packages/locke-harvest/package.json` verbatim

Write the file at `packages/locke-harvest/package.json` with **exactly** the following content.

```json
{
  "name": "locke-harvest",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "deploy": "wrangler deploy",
    "dev": "wrangler dev"
  },
  "devDependencies": {
    "@cloudflare/workers-types": "^4.20250101.0",
    "typescript": "^5.6.0",
    "wrangler": "^3.85.0"
  }
}
```

---

## Task 4 — Write `packages/locke-harvest/src/index.ts` verbatim

Write the file at `packages/locke-harvest/src/index.ts` with **exactly** the following content. The file is ~280 lines. Do not edit, reformat, or simplify.

```typescript
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
```

---

## Task 5 — Commit + push

```bash
git add packages/locke-harvest/wrangler.toml \
        packages/locke-harvest/package.json \
        packages/locke-harvest/src/index.ts

git status --short                                    # AUDIT (should show 3 new files)
git diff --cached --stat                              # AUDIT

git commit -m "forge-and-library C3: locke-harvest Worker scaffold (LIBRARIAN-SCHEMA + LOCKE-OUTPUT-SCHEMA)"
git push origin main
```

Capture the commit SHA from `git log -1 --format=%H` for COMPLETE.md.

---

## Task 6 — Verify deploy.yml CI

Wait up to 4 minutes for the GitHub Actions deploy.yml workflow to pick up the push and run. Poll with the GitHub API.

```bash
COMMIT_SHA=$(git log -1 --format=%H)
TOKEN=$(cat /opt/secrets/github-token)
REPO="AetherCreator/thechefos-workers"

# Wait up to 4 min for the run to appear + complete
for i in $(seq 1 24); do
  sleep 10
  RUN=$(curl -s -H "Authorization: Bearer $TOKEN" \
    "https://api.github.com/repos/$REPO/actions/runs?head_sha=$COMMIT_SHA&per_page=1" \
    | python3 -c "import sys,json; d=json.load(sys.stdin); r=(d.get('workflow_runs') or [None])[0]; print((r or {}).get('status','none'), (r or {}).get('conclusion','none'), (r or {}).get('id','none'))")
  echo "[$i] run: $RUN"
  STATUS=$(echo "$RUN" | awk '{print $1}')
  CONCL=$(echo "$RUN" | awk '{print $2}')
  if [ "$STATUS" = "completed" ]; then
    if [ "$CONCL" = "success" ]; then
      echo "CI green ✅"
      break
    else
      echo "CI failed: $CONCL"
      # Capture the run id for COMPLETE.md but do NOT auto-revert
      RUN_ID=$(echo "$RUN" | awk '{print $3}')
      echo "RUN_ID=$RUN_ID" > /tmp/clue3-ci-failed.env
      break
    fi
  fi
done
```

If CI fails: write COMPLETE.md with status `partial — CI red`, include the run id and a 1-line theory (most likely cause: `deploy.yml` does not yet include `packages/locke-harvest/` in its matrix; this is a Tyler-side patch one commit later — DO NOT amend deploy.yml from this clue, that is out of scope).

If CI never appears within 4 minutes: write COMPLETE.md with status `partial — CI did not trigger` and note the SHA.

---

## Task 7 — Write `hunts/forge-and-library/clue-3/COMPLETE.md`

Write `hunts/forge-and-library/clue-3/COMPLETE.md`. Template below. Fill the bracketed `<…>` slots with real values. Then `git add`, commit, push.

```markdown
# C3 COMPLETE — locke-harvest Worker scaffold

**Date:** <ISO 8601 UTC>
**Substrate:** auto-exec.sh → claude-exec.sh (per `[SUBSTANTIAL]` first-line tag)
**Hunt:** forge-and-library
**Status:** <complete | partial — CI red | partial — CI did not trigger>

## Files committed

- `packages/locke-harvest/wrangler.toml`
- `packages/locke-harvest/package.json`
- `packages/locke-harvest/src/index.ts`

Source commit: `<SHA>`

## CI verification

- deploy.yml run id: `<id>`
- conclusion: `<success | failure | timeout>`
- duration: `<seconds>`

## Deferred (intentional, NOT failures)

- **KV-backed cross-invocation dedup** — MVP uses in-memory Set. Cross-invocation dedup per LIBRARIAN-SCHEMA §7 is post-MVP. Tyler creates KV via `wrangler kv namespace create locke-dedup` then adds binding to wrangler.toml when ready.
- **Phase 2 Agent-Reach** — C1 audit confirms not installed. Phase 1 (SearXNG) → Phase 3 (Gemini) only. When Agent-Reach lands, insert between phases without changing schemas.
- **SearXNG Cloudflare tunnel** — wrangler.toml points at `https://searxng-tunnel.thechefos.app/search`. Tyler verifies the tunnel exists; if not, first cron will surface it via `query_failed` intel events. NOT blocking deploy.

## Tyler-side post-deploy steps (DO NOT execute from this clue)

```
wrangler secret put GEMINI_API_KEY --name locke-harvest        # value from /opt/secrets/gemini-key
wrangler secret put BRAIN_WRITE_SECRET --name locke-harvest    # value: SuperDuperClaude
wrangler secret put HARVEST_RUN_SECRET --name locke-harvest    # any random 32-char string; save to /opt/secrets/locke-harvest-run-key
```

## Smoke (Tyler-side, becomes C4)

```
curl -X POST "https://locke-harvest.tveg-baking.workers.dev/run?secret=$(cat /opt/secrets/locke-harvest-run-key)"
```

Expect: `{"kept":N,"discarded":M,"status":"complete|no_signal|all_discarded","session_id":"…"}`. Successful smoke writes ≥1 file under `brain/05-leads/` (or `_drafts/`) and a session report under `brain/05-leads/_sessions/`.
```

Commit COMPLETE.md:

```bash
git add hunts/forge-and-library/clue-3/COMPLETE.md
git commit -m "forge-and-library C3 COMPLETE — locke-harvest Worker scaffolded"
git push origin main
```

---

## Pass conditions (all required for `[SUBSTANTIAL]` clean PASS)

1. ✅ `packages/locke-harvest/wrangler.toml` on `origin/main` matching this PROMPT byte-for-byte
2. ✅ `packages/locke-harvest/package.json` on `origin/main` matching this PROMPT byte-for-byte
3. ✅ `packages/locke-harvest/src/index.ts` on `origin/main` matching this PROMPT byte-for-byte
4. ✅ `hunts/forge-and-library/clue-3/COMPLETE.md` on `origin/main` with filled-in slots
5. ✅ deploy.yml CI run is `completed`. `success` is the happy path; `failure` is acceptable for clue-3 PASS as long as COMPLETE.md documents the failure honestly with the run id (a CI fix from `deploy.yml` matrix omission is a one-line Tyler-side follow-up, not a clue-3 retry)
6. ✅ Long John 🏴‍☠️ ping arrives in `@LongClaudeSilver_bot` DM after claude-exec.sh exits

## Forbidden

- DO NOT modify any file outside `packages/locke-harvest/` and `hunts/forge-and-library/clue-3/`
- DO NOT modify `.github/workflows/deploy.yml` (out of scope for this clue)
- DO NOT install dependencies (`npm install` will run in CI; do not run it here)
- DO NOT add Phase 2 Agent-Reach code (deferred — see Mission)
- DO NOT add KV bindings to wrangler.toml (deferred — see Mission)
- DO NOT execute `wrangler secret put` from this clue (Tyler-side step in COMPLETE.md)
- DO NOT execute `curl /run` smoke from this clue (that is C4)
- DO NOT split `src/index.ts` into multiple files — one file is the spec
- DO NOT add tests, linting, or formatters
- DO NOT amend prior commits

When all 6 pass conditions hold, your final reply line is:
`HUNT_COMPLETE: forge-and-library/clue-3 <source-SHA> <complete-SHA>`
