export type SeverityLevel = 'security_advisory' | 'breaking_change' | 'deprecation' | 'minor';
export type CriticalityLevel = 'high' | 'medium' | 'low';

export interface ChangelogLead {
  schema_version: 'locke-1.2-changelog';
  dep_name: string;
  release_tag: string;
  release_url: string;
  severity: SeverityLevel;
  criticality: CriticalityLevel;
  severity_signals: string[];
  title: string;
  summary: string;
  ts: string;
}

const SEVERITY_VALUES: ReadonlySet<string> = new Set([
  'security_advisory',
  'breaking_change',
  'deprecation',
  'minor'
]);

const CRITICALITY_VALUES: ReadonlySet<string> = new Set(['high', 'medium', 'low']);

const REQUIRED_STRING_FIELDS: ReadonlyArray<keyof ChangelogLead> = [
  'dep_name',
  'release_tag',
  'release_url',
  'title',
  'summary',
  'ts'
];

export function validateChangelogLead(x: unknown): asserts x is ChangelogLead {
  if (!x || typeof x !== 'object') {
    throw new Error('validateChangelogLead: not an object');
  }

  const obj = x as Record<string, unknown>;

  if (obj['schema_version'] !== 'locke-1.2-changelog') {
    throw new Error(
      `validateChangelogLead: schema_version must be 'locke-1.2-changelog', got '${obj['schema_version']}'`
    );
  }

  for (const field of REQUIRED_STRING_FIELDS) {
    if (typeof obj[field] !== 'string' || !(obj[field] as string)) {
      throw new Error(`validateChangelogLead: missing or empty field '${field}'`);
    }
  }

  if (!SEVERITY_VALUES.has(obj['severity'] as string)) {
    throw new Error(
      `validateChangelogLead: invalid severity '${obj['severity']}' — must be one of ${[...SEVERITY_VALUES].join('|')}`
    );
  }

  if (!CRITICALITY_VALUES.has(obj['criticality'] as string)) {
    throw new Error(
      `validateChangelogLead: invalid criticality '${obj['criticality']}' — must be one of ${[...CRITICALITY_VALUES].join('|')}`
    );
  }

  if (!Array.isArray(obj['severity_signals'])) {
    throw new Error("validateChangelogLead: severity_signals must be an array");
  }
}
