// Guard Layer audit trail for changelog-watcher actions.
// Writes a JSON entry to brain/06-meta/auto-actions/<YYYY-MM-DD>/<action_id>.json
// in SuperClaude via GitHub Contents API PUT.
// Soft-fails: errors are returned, never thrown.

import type { Env } from '../../types';
import type { ChangelogLead } from '../../changelogSchema';
import type { TriageDecision } from './triage';
import type { FileLeadResult } from './fileLead';

const REPO_OWNER = 'AetherCreator';
const REPO_NAME = 'SuperClaude';
const GITHUB_API = 'https://api.github.com';
const COMMITTER = { name: 'SuperClaude Brain Ops', email: 'brain-ops@thechefos.app' };

export interface AuditEntry {
  action_id: string;
  actor: 'locke-changelog-watcher';
  trigger: { type: 'atom_feed'; feed?: string; entry_id?: string };
  action: {
    type: 'ops_board_file';
    target: string;  // ops_id
    section: 'URGENT' | 'BACKLOG';
    priority: 'URGENT' | 'Normal' | 'Low';
  };
  verification: Array<{ check: string; passed: boolean; detail?: string }>;
  idempotency_key: string;  // sha of ops_id
  reverse_command: { command: 'manual_delete_ops_row'; params: { ops_id: string } };
  ts: string;
  lead: {
    dep_name: string;
    release_tag: string;
    severity: string;
    criticality: string;
  };
  filed: {
    ok: boolean;
    ops_id: string;
    commit_url?: string;
    idempotency_hit?: boolean;
    error?: string;
  };
}

function buildActionId(opsId: string): string {
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 23);
  const slug = opsId.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 30);
  return `lcw-${ts}-${slug}`;
}

async function sha256Hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

export interface WriteAuditResult {
  ok: boolean;
  path: string;
  commit_url?: string;
  error?: string;
}

export async function writeAuditEntry(
  env: Env,
  lead: ChangelogLead,
  decision: TriageDecision,
  filed: FileLeadResult,
): Promise<WriteAuditResult> {
  const ts = new Date().toISOString();
  const date = ts.slice(0, 10);
  const action_id = buildActionId(filed.ops_id);
  const idempotency_key = await sha256Hex(filed.ops_id);

  const entry: AuditEntry = {
    action_id,
    actor: 'locke-changelog-watcher',
    trigger: { type: 'atom_feed', feed: lead.release_url, entry_id: lead.release_tag },
    action: {
      type: 'ops_board_file',
      target: filed.ops_id,
      section: decision.section,
      priority: decision.priority,
    },
    verification: [
      { check: 'ops_board_file', passed: filed.ok, detail: filed.error },
    ],
    idempotency_key,
    reverse_command: { command: 'manual_delete_ops_row', params: { ops_id: filed.ops_id } },
    ts,
    lead: {
      dep_name: lead.dep_name,
      release_tag: lead.release_tag,
      severity: lead.severity,
      criticality: lead.criticality,
    },
    filed,
  };

  const path = `brain/06-meta/auto-actions/${date}/${action_id}.json`;
  const content = JSON.stringify(entry, null, 2);
  const contentBase64 = btoa(unescape(encodeURIComponent(content)));

  const headers: Record<string, string> = {
    Authorization: `Bearer ${env.GITHUB_TOKEN}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'SuperClaude-Brain-Ops',
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json',
  };

  try {
    const res = await fetch(
      `${GITHUB_API}/repos/${REPO_OWNER}/${REPO_NAME}/contents/${path}`,
      {
        method: 'PUT',
        headers,
        body: JSON.stringify({
          message: `audit: changelog-watcher ops_board_file ${filed.ops_id} (${lead.severity})`,
          content: contentBase64,
          committer: COMMITTER,
        }),
        signal: AbortSignal.timeout(15_000),
      },
    );

    if (res.ok) {
      const data = await res.json() as { commit: { html_url: string } };
      return { ok: true, path, commit_url: data.commit.html_url };
    }
    if (res.status === 422) {
      return { ok: true, path, error: 'audit_already_exists' };
    }
    const detail = await res.text().catch(() => '');
    return { ok: false, path, error: `github_${res.status}: ${detail.slice(0, 200)}` };
  } catch (e) {
    return { ok: false, path, error: String(e).slice(0, 200) };
  }
}
