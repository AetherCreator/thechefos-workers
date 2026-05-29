import { describe, it, expect, vi, afterEach } from 'vitest';
import { callJudge, findLeadPath, isNonLeadFilename } from './index';

function makeEnv(aiRun: ReturnType<typeof vi.fn>): any {
  return {
    AI: { run: aiRun },
    NIM_MODEL: '@cf/moonshotai/kimi-k2.6',
    PER_JUDGE_TIMEOUT_MS: '60000',
  };
}

const VALID_REALIST = JSON.stringify({
  judge: 'realist',
  score: 75,
  verdict: 'Feasible for a solo dev in a weekend.',
  red_flags: [],
  green_flags: ['Simple UI'],
  build_estimate: '8',
});
const VALID_RESPONSE = { choices: [{ message: { content: VALID_REALIST } }] };

function makeCouncilEnv(overrides: Record<string, any> = {}): any {
  return {
    BRAIN_GH_API_BASE: 'https://api.github.com/repos/owner/brain/contents',
    GITHUB_TOKEN: 'test-token',
    ...overrides
  };
}

function makeFileListing(names: string[], dirPath: string): any[] {
  return names.map(name => ({ name, path: `${dirPath}/${name}`, type: 'file' }));
}

afterEach(() => { vi.restoreAllMocks(); });

describe('findLeadPath — new format + legacy fallback (3.2)', () => {
  it('resolves new-format file from today dir', async () => {
    const today = new Date().toISOString().slice(0, 10);
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
    const result = await findLeadPath('bakers-percentage-calc', makeCouncilEnv());
    expect(result).toBe(`brain/05-leads/${today}/bakers-percentage-calc.single_signal.high.json`);
  });

  it('resolves legacy file from _drafts when today/yesterday dirs return 404', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
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
    const result = await findLeadPath('bakers-percentage-calc', makeCouncilEnv());
    expect(result).toBe('brain/05-leads/_drafts/bakers-percentage-calc.json');
  });

  it('does not return verdict sidecars as lead paths', async () => {
    const today = new Date().toISOString().slice(0, 10);
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
    const result = await findLeadPath('bakers-percentage-calc', makeCouncilEnv());
    expect(result).toBeNull();
  });

  it('returns null if lead not found in any candidate dir', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
    const result = await findLeadPath('missing-lead', makeCouncilEnv());
    expect(result).toBeNull();
  });
});

describe('lead↔verdict stem consistency (3.2)', () => {
  it('new-format lead produces matching verdict path via replace', () => {
    const leadPath = 'brain/05-leads/_drafts/bakers-percentage-calc.single_signal.high.json';
    const verdictPath = leadPath.replace(/\.json$/, '.verdict.json');
    expect(verdictPath).toBe('brain/05-leads/_drafts/bakers-percentage-calc.single_signal.high.verdict.json');
    const leadStem = leadPath.split('/').pop()!.replace(/\.json$/, '');
    const verdictStem = verdictPath.split('/').pop()!.replace(/\.verdict\.json$/, '');
    expect(leadStem).toBe(verdictStem);
  });

  it('leadFileStem derivation matches full filename stem', () => {
    const leadPath = 'brain/05-leads/2026-05-29/my-lead.repeated.medium.json';
    const leadFileStem = leadPath.split('/').pop()!.replace(/\.json$/, '');
    expect(leadFileStem).toBe('my-lead.repeated.medium');
    expect(`brain/05-leads/_canary/${leadFileStem}.verdict.json`)
      .toBe('brain/05-leads/_canary/my-lead.repeated.medium.verdict.json');
  });
});

describe('isNonLeadFilename (3.2 sweep prefilter)', () => {
  it('matches analyzer-trace dumps', () => {
    expect(isNonLeadFilename('analyzer-trace-abc.json')).toBe(true);
  });

  it('matches nim-error dumps', () => {
    expect(isNonLeadFilename('nim-error-abc.json')).toBe(true);
  });

  it('does not match valid new-format lead filenames', () => {
    expect(isNonLeadFilename('bakers-percentage-calc.single_signal.high.json')).toBe(false);
  });

  it('does not match legacy lead filenames', () => {
    expect(isNonLeadFilename('bakers-percentage-calc.json')).toBe(false);
  });
});

describe('callJudge retry-with-backoff', () => {
  it('returns scored result (NOT abstain) when first attempt throws ai_error then second succeeds', async () => {
    const aiRun = vi.fn()
      .mockRejectedValueOnce(new Error('ai_error: upstream transient'))
      .mockResolvedValueOnce(VALID_RESPONSE);

    const result = await callJudge('realist', 'system', 'user', makeEnv(aiRun), 0);

    expect(result.abstain).toBeUndefined();
    expect(result.score).toBe(75);
    expect(result.judge).toBe('realist');
    expect(aiRun).toHaveBeenCalledTimes(2);
  });

  it('returns scored result when first attempt returns empty content then second succeeds', async () => {
    const aiRun = vi.fn()
      .mockResolvedValueOnce({})              // no content → "AI binding empty" → retry
      .mockResolvedValueOnce(VALID_RESPONSE);

    const result = await callJudge('realist', 'system', 'user', makeEnv(aiRun), 0);

    expect(result.abstain).toBeUndefined();
    expect(result.score).toBe(75);
    expect(aiRun).toHaveBeenCalledTimes(2);
  });

  it('returns abstain exactly once after all 3 attempts fail', async () => {
    const aiRun = vi.fn().mockRejectedValue(new Error('ai_error: persistent failure'));

    const result = await callJudge('realist', 'system', 'user', makeEnv(aiRun), 0);

    expect(result.abstain).toBe(true);
    expect(result.judge).toBe('realist');
    expect(result.reason).toMatch(/ai_error/);
    expect(aiRun).toHaveBeenCalledTimes(3);
  });
});
