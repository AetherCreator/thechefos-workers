// cost-telemetry Worker — Workers AI neuron-burn observability for the autonomous swarm.
// No LLM (model:null in /health). Reads brain/05-leads/_sessions via GitHub Contents API,
// counts fires per persona, multiplies by per-fire calibration constants, returns rollup.
// KV-cached per-day; recomputes on stale cache or /run-manual fire. Hourly cron + 23:00 UTC daily brain-write.

interface Env {
  KV: KVNamespace;
  PERSONA: string;
  TELEMETRY_SCHEMA_VERSION: string;
  NEURON_CAP: string;
  LOCKE_NEURONS_PER_FIRE: string;
  COUNCIL_NEURONS_PER_FIRE: string;
  SCHEMER_NEURONS_PER_FIRE: string;
  REVIEWER_NEURONS_PER_FIRE: string;
  BRAIN_RAW_BASE: string;
  BRAIN_GH_API_BASE: string;
  BRAIN_WRITE_URL: string;
  GITHUB_TOKEN: string;
  BRAIN_WRITE_SECRET: string;
  TELEMETRY_RUN_SECRET: string;
}

interface Rollup {
  traffic_light: string;
  neurons_used_estimate: number;
  neurons_remaining_estimate: number;
  neurons_cap: number;
  locke_fires_today: number;
  council_fires_today: number;
  schemer_fires_today: number;
  reviewer_fires_today: number;
  last_updated: string;
  basis: string;
}

function trafficLight(used: number, cap: number): "green" | "yellow" | "red" | "depleted" {
  if (used >= cap) return "depleted";
  if (used >= 0.85 * cap) return "red";
  if (used >= 0.5 * cap) return "yellow";
  return "green";
}

async function recomputeRollup(env: Env): Promise<Rollup> {
  const today = new Date().toISOString().slice(0, 10);
  const sessionsPath = "brain/05-leads/_sessions";
  const counts = { locke: 0, council: 0, schemer: 0, reviewer: 0 };
  try {
    const r = await fetch(`${env.BRAIN_GH_API_BASE}/${sessionsPath}`, {
      headers: {
        "Authorization": `Bearer ${env.GITHUB_TOKEN}`,
        "Accept": "application/vnd.github.v3+json",
        "User-Agent": "cost-telemetry/1.0"
      }
    });
    if (r.ok) {
      const items = await r.json() as Array<{ name: string }>;
      for (const it of items) {
        if (!it.name.includes(today)) continue;
        if (it.name.startsWith("locke-lamora-")) counts.locke++;
        else if (it.name.startsWith("council-")) counts.council++;
        else if (it.name.startsWith("schemer-")) counts.schemer++;
        else if (it.name.startsWith("reviewer-")) counts.reviewer++;
      }
    }
  } catch (e) {
    console.warn(`recomputeRollup brain fetch failed: ${e}`);
  }
  const cap = parseInt(env.NEURON_CAP, 10);
  const used = counts.locke * parseInt(env.LOCKE_NEURONS_PER_FIRE, 10)
    + counts.council * parseInt(env.COUNCIL_NEURONS_PER_FIRE, 10)
    + counts.schemer * parseInt(env.SCHEMER_NEURONS_PER_FIRE, 10)
    + counts.reviewer * parseInt(env.REVIEWER_NEURONS_PER_FIRE, 10);
  return {
    traffic_light: trafficLight(used, cap),
    neurons_used_estimate: used,
    neurons_remaining_estimate: Math.max(0, cap - used),
    neurons_cap: cap,
    locke_fires_today: counts.locke,
    council_fires_today: counts.council,
    schemer_fires_today: counts.schemer,
    reviewer_fires_today: counts.reviewer,
    last_updated: new Date().toISOString(),
    basis: "session-file-count x calibration-constants"
  };
}

async function loadRollup(env: Env): Promise<Rollup> {
  const dateStr = new Date().toISOString().slice(0, 10);
  const key = `rollup:${dateStr}`;
  const cached = await env.KV.get<Rollup>(key, "json");
  if (cached) {
    const updated = new Date(cached.last_updated);
    if (Date.now() - updated.getTime() < 10 * 60 * 1000) {
      return cached;
    }
  }
  const fresh = await recomputeRollup(env);
  try {
    await env.KV.put(key, JSON.stringify(fresh));
  } catch (e) {
    console.warn(`KV write failed: ${e}`);
  }
  return fresh;
}

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/health") {
      return Response.json({ ok: true, persona: env.PERSONA, schema: env.TELEMETRY_SCHEMA_VERSION, model: null });
    }
    if (url.pathname === "/dashboard") {
      const rollup = await loadRollup(env);
      return Response.json(rollup);
    }
    if (url.pathname === "/run-manual" && request.method === "POST") {
      const secret = url.searchParams.get("secret");
      if (secret !== env.TELEMETRY_RUN_SECRET) {
        return new Response("Forbidden", { status: 401 });
      }
      const fresh = await recomputeRollup(env);
      try {
        const today = new Date().toISOString().slice(0, 10);
        await env.KV.put(`rollup:${today}`, JSON.stringify(fresh));
      } catch (e) {
        console.warn(`KV write failed: ${e}`);
      }
      return Response.json(fresh);
    }
    return new Response("Not Implemented", { status: 501 });
  },
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil((async () => {
      try {
        const fresh = await recomputeRollup(env);
        const today = new Date().toISOString().slice(0, 10);
        await env.KV.put(`rollup:${today}`, JSON.stringify(fresh));
        if (new Date().getUTCHours() === 23) {
          const path = `brain/02-knowledge/cost-rollup-${today}.md`;
          const content = `# Cost Rollup ${today}\n\n` +
            `- Traffic light: ${fresh.traffic_light}\n` +
            `- Neurons used (estimate): ${fresh.neurons_used_estimate} / ${fresh.neurons_cap}\n` +
            `- Locke fires: ${fresh.locke_fires_today}\n` +
            `- Council fires: ${fresh.council_fires_today}\n` +
            `- Schemer fires: ${fresh.schemer_fires_today}\n` +
            `- Reviewer fires: ${fresh.reviewer_fires_today}\n` +
            `- Last updated: ${fresh.last_updated}\n` +
            `- Basis: ${fresh.basis}\n`;
          await fetch(env.BRAIN_WRITE_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-webhook-secret": env.BRAIN_WRITE_SECRET },
            body: JSON.stringify({ path, content, message: `cost-telemetry: rollup ${today}` })
          });
        }
      } catch (e) {
        console.error(`scheduled rollup failed: ${e}`);
      }
    })());
  }
};
