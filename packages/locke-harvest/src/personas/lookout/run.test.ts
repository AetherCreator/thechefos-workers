import { describe, it, expect } from 'vitest';
import { sanitizeForFilename } from './run';

describe('sanitizeForFilename', () => {
  it('lowercases input', () => {
    expect(sanitizeForFilename('HIGH')).toBe('high');
    expect(sanitizeForFilename('Single_Signal')).toBe('single_signal');
  });

  it('replaces dots with underscores', () => {
    expect(sanitizeForFilename('dead.certain')).toBe('dead_certain');
  });

  it('replaces spaces with underscores', () => {
    expect(sanitizeForFilename('long con')).toBe('long_con');
  });

  it('passes through valid chars unchanged', () => {
    expect(sanitizeForFilename('single_signal')).toBe('single_signal');
    expect(sanitizeForFilename('dead-certain')).toBe('dead-certain');
    expect(sanitizeForFilename('high')).toBe('high');
  });

  it('strips any other non-[a-z0-9_-] chars', () => {
    expect(sanitizeForFilename('foo/bar')).toBe('foo_bar');
    expect(sanitizeForFilename('foo:bar')).toBe('foo_bar');
  });
});

describe('lead filename format (3.2)', () => {
  it('builds <lead_id>.<pattern_type>.<confidence>.json path', () => {
    const leadId = 'bakers-percentage-calc';
    const patternType = sanitizeForFilename('single_signal');
    const confidence = sanitizeForFilename('high');
    const filename = `${leadId}.${patternType}.${confidence}.json`;
    expect(filename).toBe('bakers-percentage-calc.single_signal.high.json');
  });

  it('lead stem and verdict stem are consistent', () => {
    const leadFilename = 'bakers-percentage-calc.single_signal.high.json';
    const verdictFilename = leadFilename.replace(/\.json$/, '.verdict.json');
    const leadStem = leadFilename.replace(/\.json$/, '');
    const verdictStem = verdictFilename.replace(/\.verdict\.json$/, '');
    expect(leadStem).toBe(verdictStem);
    expect(verdictFilename).toBe('bakers-percentage-calc.single_signal.high.verdict.json');
  });
});

describe('diagnostic dump path (3.3)', () => {
  it('analyzer-trace goes to brain/06-diagnostics/lookout/', () => {
    const sessionId = 'abc-123';
    const path = `brain/06-diagnostics/lookout/analyzer-trace-${sessionId}.json`;
    expect(path).toMatch(/^brain\/06-diagnostics\/lookout\//);
    expect(path).not.toMatch(/05-leads/);
    expect(path).not.toMatch(/_drafts/);
  });
});
