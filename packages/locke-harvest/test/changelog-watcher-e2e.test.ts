import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { runChangelog } from '../src/personas/changelog-watcher/run';
import { buildSeenKey } from '../src/personas/changelog-watcher/seen';
import { validateChangelogLead } from '../src/changelogSchema';

// ── Fixtures ─────────────────────────────────────────────────────────────────

const DEPS_YAML = `version: 1
updated: 2026-05-25
maintainer: tyler

dependencies:
  - name: dep-alpha
    feed: https://feeds.example.com/dep-alpha.atom
    criticality: high
    notes: Alpha dep

  - name: dep-beta
    feed: https://feeds.example.com/dep-beta.atom
    criticality: medium
    notes: Beta dep
`;

function makeFeed(depName: string, entries: { id: string; title: string; link: string; summary: string }[]): string {
  const items = entries
    .map(
      e => `  <entry>
    <id>${e.id}</id>
    <title>${e.title}</title>
    <link href="${e.link}"/>
    <updated>2026-05-25T10:00:00Z</updated>
    <summary>${e.summary}</summary>
  </entry>`
    )
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>${depName}</title>
${items}
</feed>`;
}

const ALPHA_ENTRIES = [
  { id: 'alpha-entry-1', title: 'dep-alpha v1.0.0', link: 'https://example.com/alpha/v1', summary: 'Minor bugfix release.' },
  { id: 'alpha-entry-2', title: 'dep-alpha v1.1.0', link: 'https://example.com/alpha/v1.1', summary: 'Deprecates old API.' },
  { id: 'alpha-entry-3', title: 'dep-alpha v2.0.0', link: 'https://example.com/alpha/v2', summary: 'Breaking: removed foo() method.' }
];

const BETA_ENTRIES = [
  { id: 'beta-entry-1', title: 'dep-beta v3.0.0', link: 'https://example.com/beta/v3', summary: 'Security patch for CVE-2026-0001.' },
  { id: 'beta-entry-2', title: 'dep-beta v3.1.0', link: 'https://example.com/beta/v3.1', summary: 'New feature addition.' },
  { id: 'beta-entry-3', title: 'dep-beta v3.2.0', link: 'https://example.com/beta/v3.2', summary: 'Performance improvements.' }
];

const ALPHA_FEED = makeFeed('dep-alpha', ALPHA_ENTRIES);
const BETA_FEED = makeFeed('dep-beta', BETA_ENTRIES);

// Pre-seed: alpha-entry-1 and beta-entry-1 are already seen → 4 new entries total
function buildPreSeededKV(): Record<string, string> {
  const store: Record<string, string> = {};
  const alphaKey = buildSeenKey('dep-alpha', 'alpha-entry-1');
  const betaKey = buildSeenKey('dep-beta', 'beta-entry-1');
  store[alphaKey] = JSON.stringify({ first_seen_ts: '2026-05-20T00:00:00Z', severity: 'minor', lead_url: 'https://example.com/alpha/v1' });
  store[betaKey] = JSON.stringify({ first_seen_ts: '2026-05-20T00:00:00Z', severity: 'security_advisory', lead_url: 'https://example.com/beta/v3' });
  return store;
}

function createMockKV(preSeeded: Record<string, string> = {}) {
  const store = { ...preSeeded };
  return {
    get: vi.fn().mockImplementation((key: string) => Promise.resolve(store[key] ?? null)),
    put: vi.fn().mockImplementation((key: string, value: string) => {
      store[key] = value;
      return Promise.resolve();
    }),
    _store: store
  };
}

const CANNED_AI_RESPONSE = JSON.stringify({
  severity: 'breaking_change',
  confidence: 0.85,
  signals: [{ signal: 'api_removed', evidence: 'method removed in release notes' }]
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('changelog-watcher E2E', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function buildMockEnv(kv: ReturnType<typeof createMockKV>) {
    const base64Yaml = Buffer.from(DEPS_YAML, 'utf-8').toString('base64');
    return {
      AI: {
        run: vi.fn().mockResolvedValue({ response: CANNED_AI_RESPONSE })
      },
      NIM_MODEL: '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
      GITHUB_TOKEN: 'test-token',
      CHANGELOG_SEEN: kv,
      PERSONA: 'changelog-watcher',
      BRAIN_PATH: 'brain/05-leads',
      INTEL_LOG_URL: 'https://example.com/intel',
      BRAIN_WRITE_URL: 'https://example.com/brain',
      NIM_URL: 'https://example.com/nim',
      SCHEMA_VERSION: 'locke-1.2',
      MAX_LEADS_PER_RUN: '50',
      WALL_CLOCK_BUDGET_MS: '240000',
      PER_QUERY_SLEEP_MS: '0',
      NIM_BUDGET: '50',
      NIM_API_KEY: 'test-nim-key',
      BRAIN_WRITE_SECRET: 'test-secret',
      HARVEST_RUN_SECRET: 'test-run-secret',
      BRAVE_SEARCH_API_KEY: 'test-brave-key',
      _base64Yaml: base64Yaml
    };
  }

  function mockFetch(mockEnvObj: ReturnType<typeof buildMockEnv>) {
    vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
      if (String(url).includes('api.github.com')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ content: mockEnvObj._base64Yaml, encoding: 'base64' })
        });
      }
      if (String(url).includes('dep-alpha')) {
        return Promise.resolve({ ok: true, text: async () => ALPHA_FEED });
      }
      if (String(url).includes('dep-beta')) {
        return Promise.resolve({ ok: true, text: async () => BETA_FEED });
      }
      return Promise.resolve({ ok: false, status: 404, text: async () => 'not found' });
    }));
  }

  it('polls 2 deps and emits 4 new leads (1 pre-seeded per dep skipped)', async () => {
    const kv = createMockKV(buildPreSeededKV());
    const env = buildMockEnv(kv);
    mockFetch(env);

    const req = new Request('https://locke-harvest.internal/run/changelog');
    const res = await runChangelog(env as any, req, {} as ExecutionContext);
    expect(res.status).toBe(200);

    const body = await res.json() as any;
    expect(body.ok).toBe(true);
    expect(body.persona).toBe('changelog-watcher');
    expect(body.deps_polled).toBe(2);
    expect(body.new_entries).toBe(4);
    expect(body.leads_emitted).toBe(4);
    expect(body.leads.length).toBe(4);
  });

  it('all emitted leads pass schema validation', async () => {
    const kv = createMockKV(buildPreSeededKV());
    const env = buildMockEnv(kv);
    mockFetch(env);

    const req = new Request('https://locke-harvest.internal/run/changelog');
    const res = await runChangelog(env as any, req, {} as ExecutionContext);
    const body = await res.json() as any;

    for (const lead of body.leads) {
      expect(() => validateChangelogLead(lead)).not.toThrow();
    }
  });

  it('calls markSeen once per new entry (4 times)', async () => {
    const kv = createMockKV(buildPreSeededKV());
    const env = buildMockEnv(kv);
    mockFetch(env);

    const req = new Request('https://locke-harvest.internal/run/changelog');
    await runChangelog(env as any, req, {} as ExecutionContext);

    // 4 markSeen calls for new entries (+ 1 deps-cache write from depsLoader, filtered out)
    const entryCalls = (kv.put as ReturnType<typeof vi.fn>).mock.calls.filter(([k]: [string]) => k !== '_deps_cache');
    expect(entryCalls.length).toBe(4);
  });

  it('re-run after first pass emits 0 new leads (full dedup)', async () => {
    const kv = createMockKV(buildPreSeededKV());
    const env = buildMockEnv(kv);
    mockFetch(env);

    const req1 = new Request('https://locke-harvest.internal/run/changelog');
    await runChangelog(env as any, req1, {} as ExecutionContext);

    // Second run: all entries now seen
    const req2 = new Request('https://locke-harvest.internal/run/changelog');
    const res2 = await runChangelog(env as any, req2, {} as ExecutionContext);
    const body2 = await res2.json() as any;

    expect(body2.ok).toBe(true);
    expect(body2.new_entries).toBe(0);
    expect(body2.leads_emitted).toBe(0);
    expect(body2.leads.length).toBe(0);
  });

  it('correctly uses Council (AI) judgment: leads carry breaking_change severity from mock', async () => {
    const kv = createMockKV(buildPreSeededKV());
    const env = buildMockEnv(kv);
    mockFetch(env);

    const req = new Request('https://locke-harvest.internal/run/changelog');
    const res = await runChangelog(env as any, req, {} as ExecutionContext);
    const body = await res.json() as any;

    for (const lead of body.leads) {
      expect(lead.severity).toBe('breaking_change');
    }
    expect((env.AI.run as ReturnType<typeof vi.fn>).mock.calls.length).toBe(4);
  });

  it('per-dep error does not kill the run — other deps still polled', async () => {
    const kv = createMockKV({});
    const env = buildMockEnv(kv);

    // dep-alpha feed throws; dep-beta feed returns normally
    vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
      if (String(url).includes('api.github.com')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ content: env._base64Yaml, encoding: 'base64' })
        });
      }
      if (String(url).includes('dep-alpha')) {
        return Promise.resolve({ ok: false, status: 503, text: async () => 'service unavailable' });
      }
      if (String(url).includes('dep-beta')) {
        return Promise.resolve({ ok: true, text: async () => BETA_FEED });
      }
      return Promise.resolve({ ok: false, status: 404, text: async () => 'not found' });
    }));

    const req = new Request('https://locke-harvest.internal/run/changelog');
    const res = await runChangelog(env as any, req, {} as ExecutionContext);
    const body = await res.json() as any;

    expect(body.ok).toBe(true);
    // dep-alpha errored, dep-beta succeeded
    expect(body.deps_polled).toBe(1);
    expect(body.errors.length).toBe(1);
    expect(body.errors[0]).toContain('dep-alpha');
    // dep-beta had 3 entries, none pre-seeded
    expect(body.leads_emitted).toBe(3);
  });

  it('isUnderCap called before AI (cost cap stub returns true — full judge runs)', async () => {
    const kv = createMockKV(buildPreSeededKV());
    const env = buildMockEnv(kv);
    mockFetch(env);

    const req = new Request('https://locke-harvest.internal/run/changelog');
    const res = await runChangelog(env as any, req, {} as ExecutionContext);
    const body = await res.json() as any;

    // Cost cap always true → full AI judge ran for all 4 new entries
    expect(body.leads_emitted).toBe(4);
    expect((env.AI.run as ReturnType<typeof vi.fn>).mock.calls.length).toBe(4);
  });
});
