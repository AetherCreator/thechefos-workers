// Emit a HUNT.md scaffold for breaking_change × criticality:high leads.
// Creates hunts/auto/<dep>-<release-tag-slug>/CHARTER.md in SuperClaude
// via GitHub Contents API PUT (new file, no SHA).
// Fires ONLY when auto_fork_hunt === true per triage decision.
// Soft-fails: logs the error but does not abort the run.

import type { Env } from '../../types';
import type { ChangelogLead } from '../../changelogSchema';

const REPO_OWNER = 'AetherCreator';
const REPO_NAME = 'SuperClaude';
const GITHUB_API = 'https://api.github.com';
const COMMITTER = { name: 'SuperClaude Brain Ops', email: 'brain-ops@thechefos.app' };

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
}

function buildCharterContent(lead: ChangelogLead): string {
  const summary = (lead.summary || '').slice(0, 500);
  const signals = lead.severity_signals.map(s => `- ${s}`).join('\n');
  const ts = new Date().toISOString().split('T')[0];

  return [
    `---`,
    `hunt: auto-${slugify(lead.dep_name)}-${slugify(lead.release_tag)}`,
    `created: ${ts}`,
    `source: changelog-watcher`,
    `dep_name: ${lead.dep_name}`,
    `release_tag: ${lead.release_tag}`,
    `severity: ${lead.severity}`,
    `criticality: ${lead.criticality}`,
    `---`,
    ``,
    `# ${lead.dep_name} ${lead.release_tag} — Breaking Change Hunt`,
    ``,
    `**Release:** ${lead.release_url}`,
    `**Filed:** ${ts} by changelog-watcher`,
    ``,
    `## Summary`,
    ``,
    summary,
    ``,
    `## Evidence`,
    ``,
    `### Severity signals`,
    signals || '- (none logged)',
    ``,
    `## MAP`,
    ``,
    `TODO: Tyler to author clue breakdown`,
    ``,
    `<!-- baton: auto-forked from changelog-watcher; no recursion — auto-voyage gated on P5 Spirit Level -->`,
  ].join('\n');
}

export interface HuntScaffoldResult {
  ok: boolean;
  path?: string;
  commit_url?: string;
  error?: string;
}

export async function emitHuntScaffold(env: Env, lead: ChangelogLead): Promise<HuntScaffoldResult> {
  const dep = slugify(lead.dep_name);
  const tag = slugify(lead.release_tag);
  const path = `hunts/auto/${dep}-${tag}/CHARTER.md`;
  const content = buildCharterContent(lead);
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
          message: `hunt-scaffold: auto-fork ${lead.dep_name} ${lead.release_tag} (breaking × ${lead.criticality})`,
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
    // 422 = file already exists — idempotent; treat as success
    if (res.status === 422) {
      return { ok: true, path, commit_url: undefined };
    }
    const detail = await res.text().catch(() => '');
    return { ok: false, path, error: `github_${res.status}: ${detail.slice(0, 200)}` };
  } catch (e) {
    return { ok: false, path, error: String(e).slice(0, 200) };
  }
}
