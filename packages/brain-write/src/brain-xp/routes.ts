import { Hono } from 'hono';
import { XpTouchBodySchema } from './schema';
import { touchXp, readXp } from './index';
import type { BrainXpEnv } from './index';
import { effectiveXp } from './decay';

const GITHUB_API = 'https://api.github.com';
const REPO_OWNER = 'AetherCreator';
const REPO_NAME = 'SuperClaude';

type BrainXpRouteEnv = BrainXpEnv & { BRAIN_WRITE_API_SECRET: string; GITHUB_TOKEN: string };
type Env = { Bindings: BrainXpRouteEnv };

export const brainXpRoutes = new Hono<Env>();

brainXpRoutes.use('/*', async (c, next) => {
  const secret = c.req.header('x-brain-write-secret');
  if (!secret || secret !== c.env.BRAIN_WRITE_API_SECRET) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  return next();
});

brainXpRoutes.post('/xp-touch', async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ ok: false, error: 'body_not_json' }, 400);
  }
  const parsed = XpTouchBodySchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ ok: false, error: 'invalid_body', details: parsed.error.format() }, 400);
  }
  try {
    await touchXp(c.env, parsed.data.path, parsed.data.source, parsed.data.delta ?? 1);
    return c.json({ ok: true });
  } catch (e) {
    console.error('[brain-xp] xp-touch db error:', e);
    return c.json({ ok: false, error: 'db_error' });
  }
});

brainXpRoutes.get('/xp-read', async (c) => {
  const path = c.req.query('path');
  const topStr = c.req.query('top');
  const bottomStr = c.req.query('bottom');
  const now = new Date();

  try {
    if (path) {
      const result = await readXp(c.env, path, now);
      return c.json(result);
    }

    if (topStr !== undefined || bottomStr !== undefined) {
      const N = parseInt(topStr ?? bottomStr ?? '10', 10);
      const order = topStr !== undefined ? 'DESC' : 'ASC';
      const rows = await c.env.SUPERCLAUDE_BRAIN.prepare(
        `SELECT path, xp, last_touched_at, touch_count, source_of_touch FROM brain_xp ORDER BY xp ${order} LIMIT ?`
      ).bind(N).all<{
        path: string;
        xp: number;
        last_touched_at: string;
        touch_count: number;
        source_of_touch: string | null;
      }>();

      const results = (rows.results ?? []).map(row => ({
        path: row.path,
        xp: row.xp,
        effective: effectiveXp(row.xp, row.last_touched_at, now),
        last_touched_at: row.last_touched_at,
        touch_count: row.touch_count,
        source_of_touch: row.source_of_touch,
      }));
      return c.json({ results });
    }

    return c.json({ ok: false, error: 'missing_query', hint: 'provide ?path=, ?top=N, or ?bottom=N' }, 400);
  } catch (e) {
    console.error('[brain-xp] xp-read db error:', e);
    return c.json({ ok: false, error: 'db_error' }, 500);
  }
});

brainXpRoutes.get('/read', async (c) => {
  const path = c.req.query('path');
  if (!path) return c.json({ error: 'missing_query', hint: '?path=...' }, 400);

  const res = await fetch(
    `${GITHUB_API}/repos/${REPO_OWNER}/${REPO_NAME}/contents/${path}`,
    {
      headers: {
        Authorization: `Bearer ${c.env.GITHUB_TOKEN}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'SuperClaude-Brain-Ops',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    }
  );

  if (res.status === 404) return c.json({ error: 'not_found', path }, 404);
  if (!res.ok) return c.json({ error: 'github_error', status: res.status }, 502);

  const data = await res.json<{ content: string; encoding: string; sha: string; path: string }>();
  const content = decodeURIComponent(escape(atob(data.content.replace(/\n/g, ''))));

  return c.json({ path: data.path ?? path, content, sha: data.sha });
});
