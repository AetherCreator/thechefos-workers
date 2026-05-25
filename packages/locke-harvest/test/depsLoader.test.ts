import { describe, it, expect, vi, beforeEach } from 'vitest';
import { parseTrackedDepsYaml, loadTrackedDeps } from '../src/depsLoader';

// Representative subset of the real tracked-dependencies.yml structure
const SAMPLE_YAML = `version: 1
updated: 2026-05-15
maintainer: tyler

dependencies:
  # High criticality stack
  - name: cloudflare-workers-sdk
    feed: https://github.com/cloudflare/workers-sdk/releases.atom
    criticality: high
    notes: |
      wrangler + miniflare. Every Worker in thechefos-workers/ deploys via
      this. Breaking flag changes require workflow and Action updates.

  - name: n8n
    feed: https://github.com/n8n-io/n8n/releases.atom
    criticality: high
    notes: |
      Docker on InfiniVeg. Workflow schema changes can silently invalidate
      live workflows.

  # Medium criticality with tbd feed — should be skipped
  - name: nvidia-nim-nemotron
    feed: tbd
    criticality: medium
    notes: |
      NIM Nemotron. NVIDIA AI catalog announcements need RSS/atom source.

  # Another tbd — should also be skipped
  - name: cloudflare-ai-models
    feed: tbd
    criticality: medium
    notes: |
      Workers AI catalog. CF doesn't publish atom.

  - name: react
    feed: https://github.com/facebook/react/releases.atom
    criticality: medium
    notes: |
      ChefOS, SuperConci, MoreWords all on React 19.

  - name: tailwindcss
    feed: https://github.com/tailwindlabs/tailwindcss/releases.atom
    criticality: low
    notes: |
      ChefOS + SuperConci styling.
`;

describe('parseTrackedDepsYaml', () => {
  it('parses dependency entries correctly', () => {
    const deps = parseTrackedDepsYaml(SAMPLE_YAML);
    expect(deps.length).toBe(4); // 6 total minus 2 tbd
    const cf = deps.find(d => d.name === 'cloudflare-workers-sdk');
    expect(cf).toBeDefined();
    expect(cf!.feed).toBe('https://github.com/cloudflare/workers-sdk/releases.atom');
    expect(cf!.criticality).toBe('high');
  });

  it('filters out feed: tbd entries', () => {
    const deps = parseTrackedDepsYaml(SAMPLE_YAML);
    const names = deps.map(d => d.name);
    expect(names).not.toContain('nvidia-nim-nemotron');
    expect(names).not.toContain('cloudflare-ai-models');
  });

  it('preserves criticality values correctly', () => {
    const deps = parseTrackedDepsYaml(SAMPLE_YAML);
    const byName = Object.fromEntries(deps.map(d => [d.name, d]));
    expect(byName['n8n'].criticality).toBe('high');
    expect(byName['react'].criticality).toBe('medium');
    expect(byName['tailwindcss'].criticality).toBe('low');
  });

  it('throws on invalid criticality value', () => {
    const badYaml = SAMPLE_YAML.replace(
      'criticality: high\n    notes: |\n      wrangler',
      'criticality: extreme\n    notes: |\n      wrangler'
    );
    expect(() => parseTrackedDepsYaml(badYaml)).toThrowError(/invalid criticality/);
  });

  it('returns empty array for yaml with no dependency entries', () => {
    const deps = parseTrackedDepsYaml('version: 1\nupdated: 2026-01-01\n');
    expect(deps).toEqual([]);
  });
});

describe('loadTrackedDeps', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns cached deps when KV cache hit', async () => {
    const cachedDeps = [{ name: 'cached-dep', feed: 'https://example.com/feed.atom', criticality: 'low' as const }];
    const mockEnv = {
      GITHUB_TOKEN: 'test-token',
      CHANGELOG_SEEN: {
        get: vi.fn().mockResolvedValue(JSON.stringify(cachedDeps)),
        put: vi.fn().mockResolvedValue(undefined)
      }
    };

    const result = await loadTrackedDeps(mockEnv as any);
    expect(result).toEqual(cachedDeps);
    expect(mockEnv.CHANGELOG_SEEN.put).not.toHaveBeenCalled();
  });

  it('fetches from GitHub API on cache miss and caches result', async () => {
    const base64Yaml = Buffer.from(SAMPLE_YAML, 'utf-8').toString('base64');
    const mockEnv = {
      GITHUB_TOKEN: 'test-token',
      CHANGELOG_SEEN: {
        get: vi.fn().mockResolvedValue(null),
        put: vi.fn().mockResolvedValue(undefined)
      }
    };

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ content: base64Yaml, encoding: 'base64' })
      })
    );

    const result = await loadTrackedDeps(mockEnv as any);
    expect(result.length).toBe(4); // 6 minus 2 tbd
    expect(mockEnv.CHANGELOG_SEEN.put).toHaveBeenCalledWith(
      '_deps_cache',
      expect.any(String),
      { expirationTtl: 3600 }
    );
  });

  it('throws when GitHub API returns non-200', async () => {
    const mockEnv = {
      GITHUB_TOKEN: 'test-token',
      CHANGELOG_SEEN: {
        get: vi.fn().mockResolvedValue(null),
        put: vi.fn()
      }
    };

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 404 })
    );

    await expect(loadTrackedDeps(mockEnv as any)).rejects.toThrow('loadTrackedDeps: 404');
  });
});
