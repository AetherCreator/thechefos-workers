import type { Env } from '../../types';
import { loadTrackedDeps } from '../../depsLoader';
import { fetchAtomFeed } from '../../feedAdapters';
import { isSeen, markSeen, buildSeenKey } from './seen';
import { judgeSeverity } from './judge';
import { validateChangelogLead } from '../../changelogSchema';
import type { ChangelogLead } from '../../changelogSchema';
import { triage } from './triage';
import { fileLeadAsOpsRow } from './fileLead';
import { emitHuntScaffold } from './huntScaffold';
import { pingImmediate, queueDailyDigest } from './telegram';
import { writeAuditEntry } from './audit';

const WALL_BUDGET_MS = 240_000;
const MAX_LEADS = 50;

export async function runChangelog(env: Env, _request: Request, _ctx: ExecutionContext): Promise<Response> {
  const startMs = Date.now();
  const leads: ChangelogLead[] = [];
  const errors: string[] = [];
  let deps_polled = 0;
  let new_entries = 0;

  let deps;
  try {
    deps = await loadTrackedDeps(env);
  } catch (e: any) {
    return Response.json({
      ok: false,
      persona: 'changelog-watcher',
      error: `deps_load_failed: ${String(e?.message ?? e).slice(0, 200)}`
    }, { status: 500 });
  }

  for (const dep of deps) {
    if (Date.now() - startMs > WALL_BUDGET_MS) break;
    if (leads.length >= MAX_LEADS) break;

    try {
      const entries = await fetchAtomFeed(dep.feed);
      deps_polled++;

      for (const entry of entries) {
        if (Date.now() - startMs > WALL_BUDGET_MS) break;
        if (leads.length >= MAX_LEADS) break;

        const key = buildSeenKey(dep.name, entry.id);
        if (await isSeen(env, key)) continue;

        new_entries++;

        const judged = await judgeSeverity(env, dep.name, entry.title, entry.link, entry.summary);

        const lead: ChangelogLead = {
          schema_version: 'locke-1.2-changelog',
          dep_name: dep.name,
          release_tag: entry.title || entry.id,
          release_url: entry.link,
          severity: judged.severity,
          criticality: dep.criticality,
          severity_signals: judged.signals.map(s => `${s.signal}: ${s.evidence}`),
          title: entry.title || `${dep.name} release`,
          summary: entry.summary || entry.title || dep.name,
          ts: new Date().toISOString()
        };

        try {
          validateChangelogLead(lead);
        } catch (ve: any) {
          errors.push(`validate_failed ${dep.name}:${entry.id.slice(0, 40)}: ${String(ve?.message ?? ve).slice(0, 120)}`);
          await markSeen(env, key, { first_seen_ts: lead.ts, severity: judged.severity, lead_url: lead.release_url });
          continue;
        }

        leads.push(lead);
        await markSeen(env, key, {
          first_seen_ts: lead.ts,
          severity: judged.severity,
          lead_url: lead.release_url
        });
      }
    } catch (e: any) {
      errors.push(`${dep.name}: ${String(e?.message ?? e).slice(0, 120)}`);
    }
  }

  // ── C4: triage + file + telegram + scaffold + audit ──────────────────────
  const triage_results: Array<{
    ops_id: string;
    section: string;
    priority: string;
    filed_ok: boolean;
    idempotency_hit?: boolean;
    telegram?: string;
    scaffold?: string;
    audit_ok: boolean;
  }> = [];
  // C4 soft-fail errors kept separate so existing errors field shape is preserved.
  const triage_errors: string[] = [];

  for (const lead of leads) {
    const decision = triage(lead);
    const filed = await fileLeadAsOpsRow(env, lead, decision);
    if (!filed.ok) {
      triage_errors.push(`ops_file_failed ${lead.dep_name}: ${filed.error || 'unknown'}`);
    }

    // Telegram dispatch
    if (decision.telegram === 'immediate') {
      await pingImmediate(env, lead).catch(() => {});
    } else if (decision.telegram === 'daily_digest') {
      await queueDailyDigest(env, lead).catch(() => {});
    }

    // HUNT.md scaffold for breaking_change × high
    if (decision.auto_fork_hunt) {
      await emitHuntScaffold(env, lead).catch(() => {});
    }

    // Guard Layer audit JSON
    const auditResult = await writeAuditEntry(env, lead, decision, filed);
    if (!auditResult.ok) {
      triage_errors.push(`audit_failed ${lead.dep_name}: ${auditResult.error || 'unknown'}`);
    }

    triage_results.push({
      ops_id: filed.ops_id,
      section: decision.section,
      priority: decision.priority,
      filed_ok: filed.ok,
      idempotency_hit: filed.idempotency_hit,
      telegram: decision.telegram,
      scaffold: decision.auto_fork_hunt ? 'emitted' : 'skipped',
      audit_ok: auditResult.ok,
    });
  }

  return Response.json({
    ok: true,
    persona: 'changelog-watcher',
    deps_polled,
    new_entries,
    leads_emitted: leads.length,
    leads,
    triage_results,
    triage_errors,
    wall_ms: Date.now() - startMs,
    errors
  });
}
