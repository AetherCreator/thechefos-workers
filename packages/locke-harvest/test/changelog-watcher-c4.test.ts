// C4 E2E test: triage wiring, /api/ops/file calls, Telegram, HUNT.md scaffold, audit JSONs.
// All external calls are mocked via vi.stubGlobal('fetch', ...).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { runChangelog } from '../src/personas/changelog-watcher/run';
import { triage } from '../src/personas/changelog-watcher/triage';
import { buildSeenKey } from '../src/personas/changelog-watcher/seen';

// ── Fixtures ─────────────────────────────────────────────────────────────────

const DEPS_YAML = `version: 1
updated: 2026-05-25
maintainer: tyler

dependencies:
  - name: dep-sec
    feed: https://feeds.example.com/dep-sec.atom
    criticality: high
    notes: Security-critical dep

  - name: dep-break
    feed: https://feeds.example.com/dep-break.atom
    criticality: high
    notes: High-criticality dep

  - name: dep-dep
    feed: https://feeds.example.com/dep-dep.atom
    criticality: medium
    notes: Medium criticality dep

  - name: dep-minor
    feed: https://feeds.example.com/dep-minor.atom
    criticality: low
    notes: Low criticality dep
`;

function makeFeed(depName: string, id: string, title: string, link: string, summary: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>${depName}</title>
  <entry>
    <id>${id}</id>
    <title>${title}</title>
    <link href="${link}"/>
    <updated>2026-05-25T10:00:00Z</updated>
    <summary>${summary}</summary>
  </entry>
</feed>`;
}

const FEEDS: Record<string, string> = {
  'dep-sec': makeFeed('dep-sec', 'sec-1', 'dep-sec v9.0.0', 'https://example.com/sec/v9', 'CVE-2026-001 patched'),
  'dep-break': makeFeed('dep-break', 'break-1', 'dep-break v2.0.0', 'https://example.com/break/v2', 'Breaking: removed legacy API'),
  'dep-dep': makeFeed('dep-dep', 'dep-1', 'dep-dep v1.5.0', 'https://example.com/dep/v1.5', 'Deprecates old config format'),
  'dep-minor': makeFeed('dep-minor', 'minor-1', 'dep-minor v0.9.1', 'https://example.com/minor/v0.9.1', 'Minor patch release'),
};

// AI returns different severity based on summary content
function makeAIResponse(summary: string): string {
  if (summary.includes('CVE') || summary.includes('security')) {
    return JSON.stringify({ severity: 'security_advisory', confidence: 0.95, signals: [{ signal: 'cve_mentioned', evidence: summary }] });
  }
  if (summary.includes('Breaking') || summary.includes('removed')) {
    return JSON.stringify({ severity: 'breaking_change', confidence: 0.9, signals: [{ signal: 'api_removed', evidence: summary }] });
  }
  if (summary.includes('Deprecat')) {
    return JSON.stringify({ severity: 'deprecation', confidence: 0.85, signals: [{ signal: 'deprecation_notice', evidence: summary }] });
  }
  return JSON.stringify({ severity: 'minor', confidence: 0.8, signals: [{ signal: 'patch_release', evidence: summary }] });
}

function createMockKV(preSeeded: Record<string, string> = {}) {
  const store: Record<string, string> = { ...preSeeded };
  return {
    get: vi.fn().mockImplementation((key: string) => Promise.resolve(store[key] ?? null)),
    put: vi.fn().mockImplementation((key: string, value: string) => {
      store[key] = value;
      return Promise.resolve();
    }),
    _store: store,
  };
}

function buildMockEnv(kv: ReturnType<typeof createMockKV>, digestKv?: ReturnType<typeof createMockKV>) {
  const base64Yaml = Buffer.from(DEPS_YAML, 'utf-8').toString('base64');
  return {
    AI: {
      run: vi.fn().mockImplementation(async (_model: string, opts: any) => {
        const userMsg = opts?.messages?.find((m: any) => m.role === 'user')?.content || '';
        return { response: makeAIResponse(userMsg) };
      }),
    },
    NIM_MODEL: '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
    GITHUB_TOKEN: 'test-token',
    CHANGELOG_SEEN: kv,
    DAILY_DIGEST_KV: digestKv,
    PERSONA: 'changelog-watcher',
    BRAIN_PATH: 'brain/05-leads',
    INTEL_LOG_URL: 'https://example.com/intel',
    BRAIN_WRITE_URL: 'https://brain-write.example.com/api/brain/push',
    NIM_URL: 'https://example.com/nim',
    SCHEMA_VERSION: 'locke-1.2',
    MAX_LEADS_PER_RUN: '50',
    WALL_CLOCK_BUDGET_MS: '240000',
    PER_QUERY_SLEEP_MS: '0',
    NIM_BUDGET: '50',
    NIM_API_KEY: 'test-nim-key',
    BRAIN_WRITE_SECRET: 'bw-secret',
    HARVEST_RUN_SECRET: 'run-secret',
    BRAVE_SEARCH_API_KEY: 'brave-key',
    MASTRO_BOT_TOKEN: 'tg-bot-token',
    TYLER_CHAT_ID: '12345678',
    _base64Yaml: base64Yaml,
  };
}

// Track all outgoing fetch calls by URL pattern
interface FetchCall {
  url: string;
  method: string;
  bodyText?: string;
}

let fetchCalls: FetchCall[] = [];

function setupFetchMock(env: ReturnType<typeof buildMockEnv>) {
  fetchCalls = [];
  vi.stubGlobal('fetch', vi.fn().mockImplementation(async (url: string, options: any) => {
    const method = options?.method ?? 'GET';
    const bodyText = typeof options?.body === 'string' ? options.body : undefined;
    fetchCalls.push({ url: String(url), method, bodyText });

    // GitHub Contents API — deps YAML (GET only)
    if (String(url).includes('api.github.com') && String(url).includes('tracked-dependencies')) {
      return { ok: true, json: async () => ({ content: env._base64Yaml, encoding: 'base64' }) };
    }
    // Atom feeds — scope strictly to feeds.example.com to avoid matching dep names in GitHub URLs
    if (String(url).startsWith('https://feeds.example.com/')) {
      for (const [dep, feedXml] of Object.entries(FEEDS)) {
        if (String(url).includes(dep)) {
          return { ok: true, text: async () => feedXml };
        }
      }
    }
    // brain-write /api/ops/file
    if (String(url).includes('/api/ops/file')) {
      return {
        ok: true,
        json: async () => ({
          ok: true,
          ops_id: JSON.parse(bodyText || '{}').ops_id || 'OPS-MOCK',
          commit_url: 'https://github.com/AetherCreator/SuperClaude/commit/mock-sha',
          idempotency_hit: false,
        }),
      };
    }
    // GitHub PUT for audit JSON and hunt scaffold
    if (String(url).includes('api.github.com') && method === 'PUT') {
      return {
        ok: true,
        json: async () => ({ commit: { sha: 'audit-sha', html_url: 'https://github.com/AetherCreator/SuperClaude/commit/audit-sha' } }),
      };
    }
    // Telegram sendMessage
    if (String(url).includes('api.telegram.org')) {
      return {
        ok: true,
        json: async () => ({ ok: true, result: { message_id: 999 } }),
      };
    }
    return { ok: false, status: 404, text: async () => 'not found' };
  }));
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('changelog-watcher C4 E2E', () => {
  beforeEach(() => { vi.restoreAllMocks(); fetchCalls = []; });
  afterEach(() => { vi.restoreAllMocks(); });

  it('all 4 leads are filed via /api/ops/file', async () => {
    const kv = createMockKV();
    const digestKv = createMockKV();
    const env = buildMockEnv(kv, digestKv);
    setupFetchMock(env);

    const res = await runChangelog(env as any, new Request('https://x.internal/run/changelog'), {} as ExecutionContext);
    const body = await res.json() as any;
    expect(body.ok).toBe(true);
    expect(body.leads_emitted).toBe(4);

    const opsFileCalls = fetchCalls.filter(c => c.url.includes('/api/ops/file') && c.method === 'POST');
    expect(opsFileCalls.length).toBe(4);
  });

  it('security_advisory lead gets immediate telegram ping', async () => {
    const kv = createMockKV();
    const digestKv = createMockKV();
    const env = buildMockEnv(kv, digestKv);
    setupFetchMock(env);

    await runChangelog(env as any, new Request('https://x.internal/run/changelog'), {} as ExecutionContext);

    const tgCalls = fetchCalls.filter(c => c.url.includes('api.telegram.org'));
    expect(tgCalls.length).toBe(1);
    const tgBody = JSON.parse(tgCalls[0].bodyText || '{}');
    expect(tgBody.text).toContain('SECURITY ADVISORY');
    expect(tgBody.chat_id).toBe('12345678');
  });

  it('breaking_change × high lead queues daily digest in DAILY_DIGEST_KV', async () => {
    const kv = createMockKV();
    const digestKv = createMockKV();
    const env = buildMockEnv(kv, digestKv);
    setupFetchMock(env);

    await runChangelog(env as any, new Request('https://x.internal/run/changelog'), {} as ExecutionContext);

    const digestPuts = (digestKv.put as ReturnType<typeof vi.fn>).mock.calls.filter(
      ([k]: [string]) => k.startsWith('daily_digest:'),
    );
    expect(digestPuts.length).toBe(1);
    const [, value] = digestPuts[0];
    const entry = JSON.parse(value);
    expect(entry.severity).toBe('breaking_change');
    expect(entry.dep_name).toBe('dep-break');
  });

  it('breaking_change × high emits 1 HUNT.md scaffold via GitHub PUT', async () => {
    const kv = createMockKV();
    const digestKv = createMockKV();
    const env = buildMockEnv(kv, digestKv);
    setupFetchMock(env);

    await runChangelog(env as any, new Request('https://x.internal/run/changelog'), {} as ExecutionContext);

    const scaffoldPuts = fetchCalls.filter(
      c => c.url.includes('api.github.com') && c.method === 'PUT' && c.url.includes('hunts/auto/'),
    );
    expect(scaffoldPuts.length).toBe(1);
    const body = JSON.parse(scaffoldPuts[0].bodyText || '{}');
    expect(body.message).toContain('hunt-scaffold');
    expect(body.message).toContain('dep-break');
  });

  it('4 audit JSONs are written to brain/06-meta/auto-actions/', async () => {
    const kv = createMockKV();
    const digestKv = createMockKV();
    const env = buildMockEnv(kv, digestKv);
    setupFetchMock(env);

    await runChangelog(env as any, new Request('https://x.internal/run/changelog'), {} as ExecutionContext);

    const auditPuts = fetchCalls.filter(
      c => c.url.includes('api.github.com') && c.method === 'PUT' && c.url.includes('06-meta/auto-actions/'),
    );
    expect(auditPuts.length).toBe(4);
    for (const call of auditPuts) {
      const payload = JSON.parse(call.bodyText || '{}');
      const content = JSON.parse(decodeURIComponent(escape(atob(payload.content))));
      expect(content.actor).toBe('locke-changelog-watcher');
      expect(content.action.type).toBe('ops_board_file');
    }
  });

  it('triage_results field in response contains all 4 entries with audit_ok: true', async () => {
    const kv = createMockKV();
    const digestKv = createMockKV();
    const env = buildMockEnv(kv, digestKv);
    setupFetchMock(env);

    const res = await runChangelog(env as any, new Request('https://x.internal/run/changelog'), {} as ExecutionContext);
    const body = await res.json() as any;
    expect(body.triage_results).toHaveLength(4);
    for (const r of body.triage_results) {
      expect(r.ops_id).toMatch(/^OPS-/);
      expect(r.filed_ok).toBe(true);
      expect(r.audit_ok).toBe(true);
    }
  });

  it('security_advisory lead maps to URGENT section, minor maps to BACKLOG', async () => {
    const kv = createMockKV();
    const digestKv = createMockKV();
    const env = buildMockEnv(kv, digestKv);
    setupFetchMock(env);

    const res = await runChangelog(env as any, new Request('https://x.internal/run/changelog'), {} as ExecutionContext);
    const body = await res.json() as any;

    const results: any[] = body.triage_results;
    const secResult = results.find((r: any) => r.ops_id.includes('DEP-SEC'));
    const minorResult = results.find((r: any) => r.ops_id.includes('DEP-MINOR'));

    expect(secResult?.section).toBe('URGENT');
    expect(minorResult?.section).toBe('BACKLOG');
    expect(minorResult?.priority).toBe('Low');
  });
});

// ── Triage unit tests (table-driven, 12 combos) ───────────────────────────────

describe('triage decision table', () => {
  const cases: Array<{
    severity: string;
    criticality: string;
    expectedPriority: string;
    expectedSection: string;
    expectedTelegram: string;
    expectedAutoFork: boolean;
  }> = [
    { severity: 'security_advisory', criticality: 'high',   expectedPriority: 'URGENT', expectedSection: 'URGENT',  expectedTelegram: 'immediate',    expectedAutoFork: false },
    { severity: 'security_advisory', criticality: 'medium', expectedPriority: 'URGENT', expectedSection: 'URGENT',  expectedTelegram: 'immediate',    expectedAutoFork: false },
    { severity: 'security_advisory', criticality: 'low',    expectedPriority: 'URGENT', expectedSection: 'URGENT',  expectedTelegram: 'immediate',    expectedAutoFork: false },
    { severity: 'breaking_change',   criticality: 'high',   expectedPriority: 'URGENT', expectedSection: 'URGENT',  expectedTelegram: 'daily_digest', expectedAutoFork: true  },
    { severity: 'breaking_change',   criticality: 'medium', expectedPriority: 'URGENT', expectedSection: 'URGENT',  expectedTelegram: 'daily_digest', expectedAutoFork: false },
    { severity: 'breaking_change',   criticality: 'low',    expectedPriority: 'URGENT', expectedSection: 'URGENT',  expectedTelegram: 'daily_digest', expectedAutoFork: false },
    { severity: 'deprecation',       criticality: 'high',   expectedPriority: 'Normal', expectedSection: 'BACKLOG', expectedTelegram: 'silent',       expectedAutoFork: false },
    { severity: 'deprecation',       criticality: 'medium', expectedPriority: 'Normal', expectedSection: 'BACKLOG', expectedTelegram: 'silent',       expectedAutoFork: false },
    { severity: 'deprecation',       criticality: 'low',    expectedPriority: 'Normal', expectedSection: 'BACKLOG', expectedTelegram: 'silent',       expectedAutoFork: false },
    { severity: 'minor',             criticality: 'high',   expectedPriority: 'Low',    expectedSection: 'BACKLOG', expectedTelegram: 'silent',       expectedAutoFork: false },
    { severity: 'minor',             criticality: 'medium', expectedPriority: 'Low',    expectedSection: 'BACKLOG', expectedTelegram: 'silent',       expectedAutoFork: false },
    { severity: 'minor',             criticality: 'low',    expectedPriority: 'Low',    expectedSection: 'BACKLOG', expectedTelegram: 'silent',       expectedAutoFork: false },
  ];

  for (const c of cases) {
    it(`${c.severity} × ${c.criticality} → ${c.expectedSection}/${c.expectedPriority}/${c.expectedTelegram}/fork=${c.expectedAutoFork}`, () => {
      const d = triage({ severity: c.severity as any, criticality: c.criticality as any });
      expect(d.priority).toBe(c.expectedPriority);
      expect(d.section).toBe(c.expectedSection);
      expect(d.telegram).toBe(c.expectedTelegram);
      expect(d.auto_fork_hunt).toBe(c.expectedAutoFork);
    });
  }

  it('minor leads get auto_stale_at set ~14 days in the future', () => {
    const d = triage({ severity: 'minor', criticality: 'low' });
    expect(d.auto_stale_at).toBeDefined();
    const staleDate = new Date(d.auto_stale_at!);
    const nowPlusDays = new Date();
    nowPlusDays.setDate(nowPlusDays.getDate() + 13); // at least 13 days away
    expect(staleDate.getTime()).toBeGreaterThan(nowPlusDays.getTime());
  });
});
