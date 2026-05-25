import { describe, it, expect } from 'vitest';
import { validateChangelogLead } from '../src/changelogSchema';

const VALID_LEAD = {
  schema_version: 'locke-1.2-changelog' as const,
  dep_name: 'cloudflare-workers-sdk',
  release_tag: 'wrangler@4.94.0',
  release_url: 'https://github.com/cloudflare/workers-sdk/releases/tag/wrangler%404.94.0',
  severity: 'minor' as const,
  criticality: 'high' as const,
  severity_signals: ['Patch Changes: dependency updates'],
  title: 'wrangler@4.94.0 released',
  summary: 'New wrangler release with minor and patch changes.',
  ts: '2026-05-22T13:22:01Z'
};

describe('validateChangelogLead', () => {
  it('accepts a fully valid lead without throwing', () => {
    expect(() => validateChangelogLead(VALID_LEAD)).not.toThrow();
  });

  it('accepts all valid severity enum values', () => {
    for (const severity of ['security_advisory', 'breaking_change', 'deprecation', 'minor']) {
      expect(() => validateChangelogLead({ ...VALID_LEAD, severity })).not.toThrow();
    }
  });

  it('accepts all valid criticality enum values', () => {
    for (const criticality of ['high', 'medium', 'low']) {
      expect(() => validateChangelogLead({ ...VALID_LEAD, criticality })).not.toThrow();
    }
  });

  it('rejects non-object input', () => {
    expect(() => validateChangelogLead(null)).toThrow();
    expect(() => validateChangelogLead('string')).toThrow();
    expect(() => validateChangelogLead(42)).toThrow();
  });

  it('rejects wrong schema_version', () => {
    expect(() => validateChangelogLead({ ...VALID_LEAD, schema_version: 'locke-1.2' })).toThrow(
      /schema_version/
    );
  });

  it('rejects missing dep_name', () => {
    const { dep_name, ...rest } = VALID_LEAD;
    expect(() => validateChangelogLead(rest)).toThrow(/dep_name/);
  });

  it('rejects missing release_tag', () => {
    const { release_tag, ...rest } = VALID_LEAD;
    expect(() => validateChangelogLead(rest)).toThrow(/release_tag/);
  });

  it('rejects missing release_url', () => {
    const { release_url, ...rest } = VALID_LEAD;
    expect(() => validateChangelogLead(rest)).toThrow(/release_url/);
  });

  it('rejects invalid severity enum', () => {
    expect(() => validateChangelogLead({ ...VALID_LEAD, severity: 'urgent' })).toThrow(/severity/);
    expect(() => validateChangelogLead({ ...VALID_LEAD, severity: 'critical' })).toThrow(/severity/);
  });

  it('rejects invalid criticality enum', () => {
    expect(() => validateChangelogLead({ ...VALID_LEAD, criticality: 'extreme' })).toThrow(/criticality/);
    expect(() => validateChangelogLead({ ...VALID_LEAD, criticality: 'urgent' })).toThrow(/criticality/);
  });

  it('rejects non-array severity_signals', () => {
    expect(() => validateChangelogLead({ ...VALID_LEAD, severity_signals: 'not-an-array' })).toThrow(
      /severity_signals/
    );
  });

  it('rejects empty string in required string fields', () => {
    expect(() => validateChangelogLead({ ...VALID_LEAD, title: '' })).toThrow(/title/);
    expect(() => validateChangelogLead({ ...VALID_LEAD, summary: '' })).toThrow(/summary/);
    expect(() => validateChangelogLead({ ...VALID_LEAD, ts: '' })).toThrow(/ts/);
  });
});
