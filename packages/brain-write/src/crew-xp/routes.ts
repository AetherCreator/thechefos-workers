import { Hono } from 'hono';
import { grantXp, readAll } from './index';
import type { CrewXpEnv } from './index';

type Env = { Bindings: CrewXpEnv & { BRAIN_WRITE_API_SECRET: string } };

export const crewXpRoutes = new Hono<Env>();

// Auth middleware — matches existing brain-write pattern
crewXpRoutes.use('/*', async (c, next) => {
  const secret = c.req.header('x-brain-write-secret');
  if (!secret || secret !== c.env.BRAIN_WRITE_API_SECRET) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  return next();
});

crewXpRoutes.post('/xp-grant', async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'body_not_json' }, 400);
  }
  try {
    const result = await grantXp(c.env, body);
    return c.json(result, 200);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.startsWith('grant_payload_invalid')) {
      return c.json({ error: msg }, 400);
    }
    return c.json({ error: 'internal', detail: msg }, 500);
  }
});

crewXpRoutes.get('/xp-read', async (c) => {
  const roles = await readAll(c.env);
  return c.json({ roles }, 200);
});
