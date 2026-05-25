import type { ValidatorEnv } from './types';
import { grantXp } from '../crew-xp/index';
import type { CrewXpEnv } from '../crew-xp/index';
import type { Agent } from './types';

/**
 * C2 Guard Layer hook — fires AFTER audit emit, BEFORE verification response.
 * Soft-degrade: any failure logs to the audit trail but NEVER blocks the COMPLETE.md verdict.
 * Role inference: agent field + crew_credit override (per Bible 1.5 §4 + CHARTER L4).
 *
 * Pa.C2 v1.1 patch (Opus chat-direct, 2026-05-25):
 *   - Removed non-deterministic `Date.now()` fallback that broke idempotency on webhook replay.
 *     `deriveCompletionId` now produces a content-addressed key per CHARTER §6 C2 cache.
 *   - Replaced `console.error` soft-degrade with an audit-trail emit to
 *     brain/06-meta/auto-actions/ (uses env.GITHUB_TOKEN already in scope).
 *     Failures are now visible to P3 Reflection + debugging.
 *   - Replaced `.includes()` substring matching (which mis-routed e.g. "vice-captain" → "captain")
 *     with exact-match normalization against CREW_ROLES_SET + AGENT_ALIASES.
 *   - Widened `parsed` type to surface hunt/clue/work_commit for the deterministic derivation
 *     path. Backward compatible: only run_id is required for the happy path.
 */

const CREW_ROLES_SET = new Set([
  'captain', 'mapmaker', 'quartermaster', 'hunter',
  'ships-doctor', 'carpenter', 'council', 'librarian',
]);

// Agents that aren't crew roles directly but credit a role per Bible 1.5 §4.
// Hunter is the canonical dispatch role — claude-code/chat-opus/grok dispatches all credit Hunter.
// Conductor is Captain's orchestration tool, not a separate role.
const AGENT_ALIASES: Record<string, string> = {
  'claude-code': 'hunter',
  'chat-opus': 'hunter',
  'grok': 'hunter',
  'conductor': 'captain',
  'shipsdoctor': 'ships-doctor',
  "ship's-doctor": 'ships-doctor',
  'ships_doctor': 'ships-doctor',
};

interface ParsedComplete {
  run_id?: string;
  completion_id?: string;
  crew_credit?: string;
  hunt?: string;
  clue?: string | number;
  work_commit?: string;
}

interface HookEnv {
  GITHUB_TOKEN?: string;
}

export async function fireXpGrantHook(
  env: ValidatorEnv & CrewXpEnv & HookEnv,
  parsed: ParsedComplete,
  agent: Agent,
): Promise<void> {
  try {
    const role = mapAgentToCrewRole(agent, parsed.crew_credit);
    if (!role) {
      await emitXpAudit(env, 'xp_grant_skipped', {
        reason: 'unknown_agent_or_role',
        agent,
        crew_credit: parsed.crew_credit,
      });
      return;
    }

    const completion_id =
      parsed.run_id ||
      parsed.completion_id ||
      deriveCompletionId({
        hunt: parsed.hunt ?? 'unknown',
        clue: parsed.clue ?? 0,
        verdict: 'applied',
        commit_sha: parsed.work_commit ?? 'no-sha',
      });

    const result = await grantXp(env, { role, completion_id, xp_delta: 1 });

    await emitXpAudit(env, 'xp_grant_outcome', {
      role,
      completion_id,
      outcome: outcomeOf(result),
      result,
    });
  } catch (e) {
    // SOFT-DEGRADE: emit to audit trail, NEVER throw, NEVER block verification response.
    await emitXpAudit(env, 'xp_grant_exception', {
      error: e instanceof Error ? e.message : String(e),
      agent,
      run_id: parsed.run_id,
    });
  }
}

function mapAgentToCrewRole(agent: Agent, crewCredit?: string): string | null {
  // crew_credit override wins (per CHARTER L4 + Bible 1.5 §4).
  // Invalid crew_credit falls through to agent inference rather than erroring.
  if (crewCredit) {
    const c = crewCredit.toLowerCase().trim();
    if (CREW_ROLES_SET.has(c)) return c;
  }
  if (!agent) return null;
  const a = String(agent).toLowerCase().trim();
  if (CREW_ROLES_SET.has(a)) return a;
  if (a in AGENT_ALIASES) return AGENT_ALIASES[a];
  return null;
}

/**
 * Deterministic completion_id derivation when COMPLETE.md doesn't supply run_id.
 * Replay-safe: same hunt/clue/verdict/commit always produces the same key, so
 * webhook retries dedup via crew-xp-completion-keys KV instead of granting twice.
 */
export function deriveCompletionId(parts: {
  hunt: string;
  clue: string | number;
  verdict: string;
  commit_sha: string;
}): string {
  return `derived-${parts.hunt}-clue${parts.clue}-${parts.verdict}-${String(parts.commit_sha).slice(0, 12)}`;
}

function outcomeOf(r: unknown): string {
  if (r && typeof r === 'object') {
    if ('applied' in r) return 'applied';
    if ('deduped' in r) return 'deduped';
    if ('skipped' in r) return 'skipped';
  }
  return 'unknown';
}

/**
 * Emit an xp-grant audit entry to brain/06-meta/auto-actions/<date>/.
 * Replaces the round-1 console.error swallow that hid failures from P3 Reflection.
 * Last-resort wraps the GitHub PUT in try/catch — emit must NEVER throw upward.
 */
async function emitXpAudit(
  env: HookEnv,
  kind: 'xp_grant_outcome' | 'xp_grant_skipped' | 'xp_grant_exception',
  body: Record<string, unknown>,
): Promise<void> {
  if (!env.GITHUB_TOKEN) return; // can't emit without token; logged path is dead in this case
  const now = new Date();
  const ts = now.toISOString();
  const date = ts.slice(0, 10);
  const auditId = `xp-${kind}-${ts.replace(/[:.\-]/g, '')}`.slice(0, 80);
  const path = `brain/06-meta/auto-actions/${date}/${auditId}.json`;
  const target = typeof body.role === 'string' ? body.role : 'unknown';
  const doc = {
    audit_id: auditId,
    action: kind,
    target,
    payload: body,
    ts,
    written_at: ts,
    source: 'brain-write/complete-validator/xp-grant-hook',
  };
  try {
    const content = btoa(unescape(encodeURIComponent(JSON.stringify(doc, null, 2))));
    await fetch(
      `https://api.github.com/repos/AetherCreator/SuperClaude/contents/${path}`,
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${env.GITHUB_TOKEN}`,
          Accept: 'application/vnd.github+json',
          'User-Agent': 'thechefos-workers-xp-grant-hook/1.1',
          'X-GitHub-Api-Version': '2022-11-28',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: `xp-grant audit: ${kind} (${target})`,
          content,
          committer: {
            name: 'SuperClaude Brain Ops',
            email: 'brain-ops@thechefos.app',
          },
        }),
      },
    );
  } catch {
    // Last-resort: swallow. Audit emit must NEVER throw — it's failure-mode logging.
  }
}
