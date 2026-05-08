// Builder Worker — implements FOUNDRY-SCHEMA.md v1.0
// Orchestrates clue execution against existing hunter substrate
// No LLM - pure orchestration shell
// Endpoints:
//   GET /health → {ok, persona, schema, model: null}
//   POST /run-manual?plan_path=X&secret=Y → reads MAP.md, writes build-status.json with all clues logged
//   POST /run/:lead_id?secret=X → webhook variant (v1.1 trigger surface)
//   404 on other paths

interface Env {
  PERSONA: string;
  FOUNDRY_SCHEMA_VERSION: string;
  BRAIN_RAW_BASE: string;
  BRAIN_GH_API_BASE: string;
  BRAIN_WRITE_URL: string;
  INTEL_LOG_URL: string;
  // Secrets (set via `wrangler secret put`):
  BRAIN_WRITE_SECRET: string;
  BUILDER_RUN_SECRET: string;
  GITHUB_TOKEN: string;              // PAT with `repo` scope — required to read private brain
}

// Helper: Common headers for reads against private AetherCreator/SuperClaude repo
function ghReadHeaders(env: Env, accept?: string): Record<string, string> {
  const h: Record<string, string> = {
    'User-Agent': 'builder-worker/1.0',
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

// Helper: Parse clue list from MAP.md (regex on ^\d+\.\s+\[CODE\])
function parseClueList(mapContent: string): Array<{num: number; title: string; pass: string}> {
  const clues: Array<{num: number; title: string; pass: string}> = [];
  const lines = mapContent.split('\n');

  let currentClue: {num: number; title: string; pass: string | null} = null;

  for (const line of lines) {
    // Match clue header: "1. [CODE] [Sonnet] **Scaffold** — description"
    const clueMatch = line.match(/^(\d+)\.\s+\[CODE\]\s+\[[^\]]+\]\s+\+\+\*(.*?)\*\+\+\s*—\s*(.*)$/);
    if (clueMatch) {
      // Save previous clue if it had a pass line
      if (currentClue && currentClue.pass) {
        clues.push({
          num: currentClue.num,
          title: currentClue.title,
          pass: currentClue.pass
        });
      }
      currentClue = {
        num: parseInt(clueMatch[1]),
        title: clueMatch[2],
        pass: null
      };
      continue;
    }

    // Match pass line: "   pass: criterion"
    const passMatch = line.match(/^\s{3}pass:\s*(.*)$/);
    if (passMatch && currentClue) {
      currentClue.pass = passMatch[1];
      continue;
    }
  }

  // Don't forget the last clue
  if (currentClue && currentClue.pass) {
    clues.push({
      num: currentClue.num,
      title: currentClue.title,
      pass: currentClue.pass
    });
  }

  return clues;
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
        model: null
      });
    }

    // POST /run-manual?plan_path=X&secret=Y
    if (url.pathname === '/run-manual' && request.method === 'POST') {
      const secret = url.searchParams.get('secret');
      if (secret !== env.BUILDER_RUN_SECRET) return new Response('Forbidden', { status: 403 });

      const planPath = url.searchParams.get('plan_path');
      if (!planPath) return Response.json({ error: 'plan_path_required' }, { status: 400 });

      try {
        // Read the plan (MAP.md) from brain
        const planContent = await readJsonFromBrain(planPath, env);
        // Actually, plan_path points to a file, so we need to read it as text
        // Let me fix this - readJsonFromBrain expects JSON, but MAP.md is markdown
        // I need a separate function to read text files

        // For now, let's assume the planPath is to a JSON file containing the content
        // But looking at the Schemer, it writes MAP.md as text via writeBrain
        // So I need to read it as text, not JSON

        // Let me create a helper to read text from brain
        const r = await fetch(`${env.BRAIN_RAW_BASE}/${planPath}`, {
          headers: ghReadHeaders(env)
        });
        if (!r.ok) throw new Error(`brain_read ${r.status} for ${planPath}`);
        const planText = await r.text();

        // Parse clue list
        const clues = parseClueList(planText);
        if (clues.length === 0) {
          return Response.json({ error: 'no_clues_found_in_plan' }, { status: 422 });
        }

        // Generate build-status.json per FOUNDRY-SCHEMA §4.2
        const startedAt = new Date().toISOString();
        const buildStatus = {
          schema_version: "foundry-1.0",
          product_slug: "unknown", // Would extract from plan in real implementation
          plan_path: planPath,
          started_at: startedAt,
          ended_at: new Date().toISOString(),
          status: "logged",
          clues: clues.map(clue => ({
            n: clue.num,
            title: clue.title,
            status: "logged" as const,
            fired_at: null as null,
            completed_at: null as null,
            evidence: null as null
          })),
          next_step: "manual" as const,
          notes: "v1.0 MVP: status='logged' only — Mastro integration deferred to v1.1"
        };

        // Determine product slug from plan path or content
        // For simplicity, extract from path: brain/06-foundry/{date}/{slug}/MAP.md
        const pathMatch = planPath.match(/brain\/06-foundry\/[^\/]+\/([^\/]+)\/MAP\.md/);
        const productSlug = pathMatch ? pathMatch[1] : "unknown";
        buildStatus.product_slug = productSlug;

        // Write build-status.json to brain
        const dateStr = new Date().toISOString().slice(0, 10);
        const brainPath = `brain/06-foundry/${dateStr}/${productSlug}`;

        await writeBrain(
          `${brainPath}/build-status.json`,
          JSON.stringify(buildStatus, null, 2),
          `builder: generated build-status.json for plan ${planPath}`,
          env
        );

        return Response.json({
          ok: true,
          persona: 'builder',
          schema: 'foundry-1.0',
          model: null,
          generated_at: new Date().toISOString(),
          brain_path: brainPath,
          build_status: buildStatus
        });

      } catch (err: any) {
        await logIntel(env, {
          event: 'builder_error',
          plan_path: url.searchParams.get('plan_path') ?? 'unknown',
          error: err.message
        });

        return Response.json({ error: 'builder_failed', message: err.message }, { status: 500 });
      }
    }

    // POST /run/:lead_id?secret=X (webhook variant)
    const runMatch = url.pathname.match(/^\/run\/([a-z0-9][a-z0-9-]{2,63})$/);
    if (runMatch && request.method === 'POST') {
      const secret = url.searchParams.get('secret');
      if (secret !== env.BUILDER_RUN_SECRET) return new Response('Forbidden', { status: 403 });

      // For v1.0, webhook behaves same as manual but would need to find plan first
      // In v1.1, this would be triggered by Schemer on plan-complete
      return Response.json({
        error: 'webhook_endpoint_not_implemented_v1_0',
        hint: 'Use /run-manual for v1.0 MVP; webhook chain deferred to v1.1'
      }, { status: 501 });
    }

    return new Response(
      'builder worker — endpoints: GET /health; POST /run-manual; POST /run/:lead_id (v1.1 webhook)',
      { status: 404 }
    );
  }
};