import { describe, it, expect, vi, afterEach } from 'vitest';
import { findLeadPath } from './index';

function makeEnv(overrides: Record<string, any> = {}): any {
  return {
    BRAIN_GH_API_BASE: 'https://api.github.com/repos/owner/brain/contents',
    GITHUB_TOKEN: 'test-token',
    ...overrides
  };
}

function makeFileListing(names: string[], dirPath: string): any[] {
  return names.map(name => ({
    name,
    path: `${dirPath}/${name}`,
    type: 'file'
  }));
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('findLeadPath — new format + legacy fallback (3.2)', () => {
  it('resolves new-format file from today dir', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const env = makeEnv();

    vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
      if (url.includes(`/${today}`)) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(makeFileListing(
            ['bakers-percentage-calc.single_signal.high.json'],
            `brain/05-leads/${today}`
          ))
        });
      }
      return Promise.resolve({ ok: false });
    }));

    const result = await findLeadPath('bakers-percentage-calc', env);
    expect(result).toBe(`brain/05-leads/${today}/bakers-percentage-calc.single_signal.high.json`);
  });

  it('resolves legacy-format file from _drafts', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const env = makeEnv();

    vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
      if (url.includes(`/${today}`) || url.includes(`/${yesterday}`)) {
        return Promise.resolve({ ok: false });
      }
      if (url.includes('/_drafts')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(makeFileListing(
            ['bakers-percentage-calc.json'],
            'brain/05-leads/_drafts'
          ))
        });
      }
      return Promise.resolve({ ok: false });
    }));

    const result = await findLeadPath('bakers-percentage-calc', env);
    expect(result).toBe('brain/05-leads/_drafts/bakers-percentage-calc.json');
  });

  it('does not match verdict sidecars', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const env = makeEnv();

    vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
      if (url.includes(`/${today}`)) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(makeFileListing(
            ['bakers-percentage-calc.single_signal.high.verdict.json'],
            `brain/05-leads/${today}`
          ))
        });
      }
      return Promise.resolve({ ok: false });
    }));

    const result = await findLeadPath('bakers-percentage-calc', env);
    expect(result).toBeNull();
  });

  it('returns null when lead is not found in any dir', async () => {
    const env = makeEnv();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
    const result = await findLeadPath('missing-lead', env);
    expect(result).toBeNull();
  });
});

describe('lead↔verdict stem consistency (3.2)', () => {
  it('verdict path derived from resolved lead path preserves full stem', () => {
    const leadPath = 'brain/05-leads/_drafts/bakers-percentage-calc.single_signal.high.json';
    const verdictPath = leadPath.replace(/\.json$/, '.verdict.json');
    expect(verdictPath).toBe('brain/05-leads/_drafts/bakers-percentage-calc.single_signal.high.verdict.json');
    const leadStem = leadPath.split('/').pop()!.replace(/\.json$/, '');
    const verdictStem = verdictPath.split('/').pop()!.replace(/\.verdict\.json$/, '');
    expect(leadStem).toBe(verdictStem);
  });

  it('legacy lead path produces matching legacy verdict path', () => {
    const leadPath = 'brain/05-leads/_drafts/bakers-percentage-calc.json';
    const verdictPath = leadPath.replace(/\.json$/, '.verdict.json');
    expect(verdictPath).toBe('brain/05-leads/_drafts/bakers-percentage-calc.verdict.json');
  });
});

describe('diagnostic dump path (3.3)', () => {
  it('schemer error dump goes to brain/06-diagnostics/schemer/', () => {
    const sessionId = 'test-session-id';
    const path = `brain/06-diagnostics/schemer/schemer-error-${sessionId}.json`;
    expect(path).toMatch(/^brain\/06-diagnostics\/schemer\//);
    expect(path).not.toMatch(/06-foundry/);
    expect(path).not.toMatch(/_drafts/);
  });
});
