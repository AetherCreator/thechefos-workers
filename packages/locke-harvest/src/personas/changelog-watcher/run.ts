import type { Env } from '../../types';
import { loadTrackedDeps } from '../../depsLoader';
import { fetchAtomFeed } from '../../feedAdapters';
import { isSeen, markSeen, buildSeenKey } from './seen';
import { judgeSeverity } from './judge';
import { validateChangelogLead } from '../../changelogSchema';
import type { ChangelogLead } from '../../changelogSchema';

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

  return Response.json({
    ok: true,
    persona: 'changelog-watcher',
    deps_polled,
    new_entries,
    leads_emitted: leads.length,
    leads,
    wall_ms: Date.now() - startMs,
    errors
  });
}
