import type { ValidatorEnv } from './types';
import { grantXp } from '../crew-xp/index';
import type { CrewXpEnv } from '../crew-xp/index';
import type { Agent } from './types';

/**
 * C2 Guard Layer hook — fires AFTER audit emit, BEFORE verification response.
 * Soft-degrade: any failure is logged to audit trail but NEVER blocks the COMPLETE.md verdict.
 * Role inference: agent field + crew_credit override (per Bible 1.5 §4).
 */

export async function fireXpGrantHook(
  env: ValidatorEnv & CrewXpEnv,
  parsed: { run_id?: string; crew_credit?: string },
  agent: Agent,
): Promise<void> {
  try {
    const role = mapAgentToCrewRole(agent, parsed.crew_credit);
    if (!role) return; // unknown role or librarian undeployed — skip silently

    const completion_id = parsed.run_id || `c2-hook-${Date.now()}`;

    const result = await grantXp(env, {
      role,
      completion_id,
      xp_delta: 1,
    });

    if ('applied' in result) {
      // success — XP granted, level may have promoted
      return;
    }
    if ('deduped' in result) {
      // idempotent replay — already granted this completion_id
      return;
    }
    if ('skipped' in result && result.reason === 'role_undeployed') {
      // librarian or future undeployed role — expected, no error
      return;
    }
  } catch (e) {
    // SOFT-DEGRADE: log but do not throw — verification response must still return
    // In production this would emit to /api/auto-actions/write with kind: 'xp_grant_exception'
    console.error('xp_grant_hook_soft_degrade', {
      error: e instanceof Error ? e.message : String(e),
      agent,
      run_id: parsed.run_id,
    });
  }
}

function mapAgentToCrewRole(agent: Agent, crewCredit?: string): string | null {
  // crew_credit override wins (per CHARTER L4 + Bible 1.5 §4)
  if (crewCredit && ['captain','mapmaker','quartermaster','hunter','ships-doctor','carpenter','council','librarian'].includes(crewCredit)) {
    return crewCredit;
  }

  const agentLower = (agent || '').toLowerCase();
  if (agentLower.includes('captain')) return 'captain';
  if (agentLower.includes('mapmaker')) return 'mapmaker';
  if (agentLower.includes('quartermaster')) return 'quartermaster';
  if (agentLower.includes('hunter') || agentLower.includes('claude-code') || agentLower.includes('chat-opus')) return 'hunter';
  if (agentLower.includes('ships-doctor') || agentLower.includes('shipsdoctor')) return 'ships-doctor';
  if (agentLower.includes('carpenter')) return 'carpenter';
  if (agentLower.includes('council')) return 'council';
  if (agentLower.includes('librarian')) return 'librarian';
  return null;
}
