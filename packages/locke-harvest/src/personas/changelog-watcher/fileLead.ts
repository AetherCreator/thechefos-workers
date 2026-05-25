// File a changelog lead as an OPS row via brain-write /api/ops/file.
// Soft-fails: if the POST fails, returns { ok: false } rather than throwing.

import type { Env } from '../../types';
import type { ChangelogLead } from '../../changelogSchema';
import type { TriageDecision } from './triage';

// Sanitize a string for use in an OPS ID (uppercase, alphanumeric + hyphens only)
function slugify(s: string): string {
  return s.toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30);
}

export function buildOpsId(lead: ChangelogLead): string {
  const dep = slugify(lead.dep_name);
  const tag = slugify(lead.release_tag);
  const sev = slugify(lead.severity);
  return `OPS-CHANGELOG-${dep}-${tag}-${sev}`;
}

export interface FileLeadResult {
  ok: boolean;
  ops_id: string;
  commit_url?: string;
  idempotency_hit?: boolean;
  error?: string;
}

export async function fileLeadAsOpsRow(
  env: Env,
  lead: ChangelogLead,
  decision: TriageDecision,
): Promise<FileLeadResult> {
  const ops_id = buildOpsId(lead);
  const title = `[${lead.severity}] ${lead.dep_name} ${lead.release_tag}`;
  const summary = (lead.summary || '').slice(0, 500);
  const signals = lead.severity_signals.slice(0, 3).join('; ');
  const body = `${title}. ${summary}${signals ? ` | signals: ${signals}` : ''} — [release](${lead.release_url})`;

  const payload = {
    ops_id,
    priority: decision.priority,
    section: decision.section,
    title,
    body,
    ...(decision.auto_stale_at ? { auto_stale_at: decision.auto_stale_at } : {}),
    metadata: { domain: 'infra', dep_name: lead.dep_name, severity: lead.severity },
  };

  const brainWriteUrl = env.BRAIN_WRITE_URL
    ? env.BRAIN_WRITE_URL.replace('/api/brain/push', '/api/ops/file')
    : 'https://api.thechefos.app/api/ops/file';

  try {
    const res = await fetch(brainWriteUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Brain-Write-Key': env.BRAIN_WRITE_SECRET || '',
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      return { ok: false, ops_id, error: `http_${res.status}: ${detail.slice(0, 200)}` };
    }

    const data = await res.json() as { ok: boolean; ops_id: string; commit_url?: string; idempotency_hit?: boolean };
    return {
      ok: true,
      ops_id: data.ops_id,
      commit_url: data.commit_url,
      idempotency_hit: data.idempotency_hit ?? false,
    };
  } catch (e) {
    return { ok: false, ops_id, error: String(e).slice(0, 200) };
  }
}
