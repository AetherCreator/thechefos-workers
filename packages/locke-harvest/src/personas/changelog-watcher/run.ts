import type { Env } from '../../types';

export async function runChangelog(_env: Env, _request: Request, _ctx: ExecutionContext): Promise<Response> {
  return Response.json({ ok: true, persona: 'changelog-watcher', stub: true, message: 'C2 wires this' });
}
