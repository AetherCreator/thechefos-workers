// locke-harvest Worker — path-routed dual-persona shell (C1 refactor).
// Personas: lookout (Sunday cron, /run/lookout), changelog-watcher (daily cron, /run/changelog).
// Lookout soul: prompts/LOOKOUT-SOUL.md | Schema: LOCKE-OUTPUT-SCHEMA.md

import { runLookout } from './personas/lookout/run';
import { runChangelog } from './personas/changelog-watcher/run';
import type { Env } from './types';

function checkSecret(url: URL, request: Request, env: Env): boolean {
  const secret = url.searchParams.get('secret') ?? request.headers.get('x-harvest-secret');
  return secret === env.HARVEST_RUN_SECRET;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/health' && request.method === 'GET') {
      return Response.json({
        ok: true,
        persona: env.PERSONA,
        schema: env.SCHEMA_VERSION,
        model: env.NIM_MODEL,
        search_adapters: 'reddit+hn+brave (hybrid v2)',
        personas: ['lookout', 'changelog-watcher']
      });
    }

    // Back-compat shim: POST /run → 308 → /run/lookout (preserves existing curl callers)
    if (url.pathname === '/run' && request.method === 'POST') {
      const dest = new URL(request.url);
      dest.pathname = '/run/lookout';
      return new Response(null, { status: 308, headers: { Location: dest.toString() } });
    }

    if (url.pathname === '/run/lookout' && request.method === 'POST') {
      if (!checkSecret(url, request, env)) return new Response('Forbidden', { status: 403 });
      return runLookout(env, request, ctx);
    }

    if (url.pathname === '/run/changelog' && request.method === 'POST') {
      if (!checkSecret(url, request, env)) return new Response('Forbidden', { status: 403 });
      return runChangelog(env, request, ctx);
    }

    return Response.json({ error: 'not_found' }, { status: 404 });
  },

  async scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    if (event.cron === '0 0 * * SUN') {
      const req = new Request('https://locke-harvest.internal/cron', {
        headers: { 'x-trigger': 'cron' }
      });
      ctx.waitUntil(runLookout(env, req, ctx).then(() => undefined));
    } else if (event.cron === '0 9 * * *') {
      const req = new Request('https://locke-harvest.internal/cron');
      ctx.waitUntil(runChangelog(env, req, ctx).then(() => undefined));
    }
  }
};
