import { describe, it, expect, beforeEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '../../../test/complete-validator/msw-setup';
import { Hono } from 'hono';
import { XpTouchBodySchema } from '../schema';
import { effectiveXp, HALF_LIFE_DAYS } from '../decay';
import { touchXp, readXp } from '../index';
import type { BrainXpEnv } from '../index';
import { brainXpRoutes } from '../routes';

// ─── Mock D1 ─────────────────────────────────────────────────────────────────

interface BrainXpRow {
  path: string;
  xp: number;
  last_touched_at: string;
  touch_count: number;
  source_of_touch: string | null;
  created_at: string;
}

class MockD1Statement {
  private params: unknown[] = [];
  constructor(private db: MockD1, private sql: string) {}

  bind(...values: unknown[]): this {
    this.params = values;
    return this;
  }

  async run(): Promise<{ success: boolean }> {
    if (this.db.shouldFail) throw new Error('MockD1: intentional failure');
    const sqlLower = this.sql.toLowerCase().trim();
    if (sqlLower.startsWith('insert into brain_xp')) {
      // bind order: path, delta, now, source, now, delta, now, source
      const [path, delta, now, source] = this.params;
      const existing = this.db.rows.get(path as string);
      if (existing) {
        existing.xp += delta as number;
        existing.last_touched_at = now as string;
        existing.touch_count += 1;
        existing.source_of_touch = source as string;
      } else {
        this.db.rows.set(path as string, {
          path: path as string,
          xp: delta as number,
          last_touched_at: now as string,
          touch_count: 1,
          source_of_touch: source as string | null,
          created_at: now as string,
        });
      }
    }
    return { success: true };
  }

  async first<T>(): Promise<T | null> {
    const [path] = this.params;
    const row = this.db.rows.get(path as string);
    return (row ?? null) as T | null;
  }

  async all<T>(): Promise<{ results: T[] }> {
    const sqlLower = this.sql.toLowerCase();
    let rows = Array.from(this.db.rows.values());
    if (sqlLower.includes('order by xp desc')) {
      rows.sort((a, b) => b.xp - a.xp);
    } else if (sqlLower.includes('order by xp asc')) {
      rows.sort((a, b) => a.xp - b.xp);
    }
    const [limit] = this.params;
    if (typeof limit === 'number') {
      rows = rows.slice(0, limit);
    }
    return { results: rows as unknown as T[] };
  }
}

class MockD1 {
  rows = new Map<string, BrainXpRow>();
  shouldFail = false;
  prepare(sql: string) { return new MockD1Statement(this, sql); }
}

const makeEnv = (db: MockD1): BrainXpEnv => ({ SUPERCLAUDE_BRAIN: db as unknown as D1Database });

// ─── Test Hono app for route tests ───────────────────────────────────────────

function makeApp(db: MockD1) {
  const app = new Hono<{ Bindings: BrainXpEnv & { BRAIN_WRITE_API_SECRET: string; GITHUB_TOKEN: string } }>();
  app.route('/api/brain', brainXpRoutes);
  return app;
}

const TEST_SECRET = 'test-brain-secret';
const TEST_TOKEN = 'test-github-token';
const authHeader = { 'x-brain-write-secret': TEST_SECRET };

function routeEnv(db: MockD1) {
  return {
    SUPERCLAUDE_BRAIN: db as unknown as D1Database,
    BRAIN_WRITE_API_SECRET: TEST_SECRET,
    GITHUB_TOKEN: TEST_TOKEN,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('brain-xp schema', () => {
  // Test 1
  it('accepts valid touch body', () => {
    const result = XpTouchBodySchema.safeParse({ path: 'brain/foo/bar.md', source: 'write' });
    expect(result.success).toBe(true);
  });

  // Test 2
  it('rejects bad source', () => {
    const result = XpTouchBodySchema.safeParse({ path: 'brain/foo.md', source: 'invalid_source' });
    expect(result.success).toBe(false);
  });
});

describe('brain-xp upsert + read', () => {
  let db: MockD1;
  let env: BrainXpEnv;

  beforeEach(() => {
    db = new MockD1();
    env = makeEnv(db);
  });

  // Test 3
  it('upsert-new row inserts with xp=delta, touch_count=1', async () => {
    await touchXp(env, 'brain/node-a.md', 'write');
    const row = await readXp(env, 'brain/node-a.md');
    expect(row.xp).toBe(1);
    expect(row.touch_count).toBe(1);
    expect(row.source_of_touch).toBe('write');
    expect(row.last_touched_at).toBeTruthy();
  });

  // Test 4
  it('upsert-existing increments xp and touch_count', async () => {
    await touchXp(env, 'brain/node-b.md', 'write', 3);
    await touchXp(env, 'brain/node-b.md', 'preload_ref', 2);
    const row = await readXp(env, 'brain/node-b.md');
    expect(row.xp).toBe(5);
    expect(row.touch_count).toBe(2);
    expect(row.source_of_touch).toBe('preload_ref');
  });

  // Test 5
  it('lazy-init: unseen path returns zero defaults', async () => {
    const row = await readXp(env, 'brain/unseen.md');
    expect(row.xp).toBe(0);
    expect(row.effective).toBe(0);
    expect(row.last_touched_at).toBeNull();
    expect(row.touch_count).toBe(0);
    expect(row.source_of_touch).toBeNull();
  });
});

describe('brain-xp decay math', () => {
  const isoNow = (offsetDays = 0): string => {
    const d = new Date();
    d.setTime(d.getTime() - offsetDays * 24 * 60 * 60 * 1000);
    return d.toISOString();
  };

  // Test 6
  it('decay @ t=0 equals xp', () => {
    const now = new Date();
    const result = effectiveXp(100, now.toISOString(), now);
    expect(result).toBeCloseTo(100, 5);
  });

  // Test 7
  it('decay @ half-life ≈ xp/2', () => {
    const now = new Date();
    const halfLifeAgo = isoNow(HALF_LIFE_DAYS);
    const result = effectiveXp(100, halfLifeAgo, now);
    expect(result).toBeCloseTo(50, 0);
  });

  // Test 8
  it('decay floor is never < 0', () => {
    const veryOldDate = new Date(0).toISOString(); // 1970
    const now = new Date();
    const result = effectiveXp(100, veryOldDate, now);
    expect(result).toBeGreaterThanOrEqual(0);
    // Also verify null path → 0
    expect(effectiveXp(100, null, now)).toBe(0);
  });
});

describe('brain-xp top/bottom ordering', () => {
  // Test 9
  it('top=2 returns highest xp first, bottom=2 returns lowest xp first', async () => {
    const db = new MockD1();
    const env = makeEnv(db);
    await touchXp(env, 'brain/low.md', 'write', 1);
    await touchXp(env, 'brain/mid.md', 'write', 5);
    await touchXp(env, 'brain/high.md', 'write', 10);

    const app = makeApp(db);
    const topRes = await app.request('/api/brain/xp-read?top=2', { headers: authHeader }, routeEnv(db));
    const topJson = await topRes.json<{ results: Array<{ path: string; xp: number }> }>();
    expect(topRes.status).toBe(200);
    expect(topJson.results).toHaveLength(2);
    expect(topJson.results[0].xp).toBe(10);
    expect(topJson.results[1].xp).toBe(5);

    const botRes = await app.request('/api/brain/xp-read?bottom=2', { headers: authHeader }, routeEnv(db));
    const botJson = await botRes.json<{ results: Array<{ path: string; xp: number }> }>();
    expect(botRes.status).toBe(200);
    expect(botJson.results).toHaveLength(2);
    expect(botJson.results[0].xp).toBe(1);
    expect(botJson.results[1].xp).toBe(5);
  });
});

describe('brain-xp HTTP route auth + error handling', () => {
  // Test 10
  it('401 when x-brain-write-secret is missing', async () => {
    const db = new MockD1();
    const app = makeApp(db);
    const res = await app.request(
      '/api/brain/xp-touch',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: 'brain/foo.md', source: 'write' }),
      },
      routeEnv(db)
    );
    expect(res.status).toBe(401);
  });

  // Test 11
  it('soft-degrade: DB error returns { ok: false } at status 200, never throws', async () => {
    const db = new MockD1();
    db.shouldFail = true;
    const app = makeApp(db);
    const res = await app.request(
      '/api/brain/xp-touch',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-brain-write-secret': TEST_SECRET },
        body: JSON.stringify({ path: 'brain/foo.md', source: 'write' }),
      },
      routeEnv(db)
    );
    expect(res.status).toBe(200);
    const json = await res.json<{ ok: boolean }>();
    expect(json.ok).toBe(false);
  });

  // Test 12
  it('/api/brain/read: happy path returns content, missing path returns 404', async () => {
    const db = new MockD1();
    const app = makeApp(db);
    const nodeContent = '# Test Node\nHello world.';
    const encoded = btoa(unescape(encodeURIComponent(nodeContent)));

    server.use(
      http.get('https://api.github.com/repos/AetherCreator/SuperClaude/contents/brain/test-node.md', () =>
        HttpResponse.json({
          path: 'brain/test-node.md',
          content: encoded,
          encoding: 'base64',
          sha: 'abc123def456abc123def456abc123def456abc1',
        })
      ),
      http.get('https://api.github.com/repos/AetherCreator/SuperClaude/contents/brain/missing.md', () =>
        HttpResponse.json({ message: 'Not Found' }, { status: 404 })
      ),
    );

    const happyRes = await app.request(
      '/api/brain/read?path=brain/test-node.md',
      { headers: authHeader },
      routeEnv(db)
    );
    expect(happyRes.status).toBe(200);
    const happyJson = await happyRes.json<{ content: string; sha: string }>();
    expect(happyJson.content).toBe(nodeContent);

    const missingRes = await app.request(
      '/api/brain/read?path=brain/missing.md',
      { headers: authHeader },
      routeEnv(db)
    );
    expect(missingRes.status).toBe(404);
  });
});
