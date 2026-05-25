import type { VoyageRecord, VoyageRole, VoyageStatus } from './types';
import type { HandoffPayload, HunterClosureHandoff } from './schemas';

export const ROLE_TRANSITIONS: Record<VoyageRole, VoyageRole | null> = {
  captain: 'mapmaker',
  mapmaker: 'quartermaster',
  quartermaster: 'hunter',
  hunter: 'closed',
  closed: null,
};

export class IllegalTransitionError extends Error {
  constructor(public expected: VoyageRole, public got: VoyageRole) {
    super(`illegal_transition: expected ${expected}, got ${got}`);
  }
}

export function advanceRole(
  record: VoyageRecord,
  payload: HandoffPayload,
  now: () => string = () => new Date().toISOString()
): VoyageRecord {
  if (payload.current_role !== record.current_role) {
    throw new IllegalTransitionError(record.current_role, payload.current_role);
  }

  const nextRole = ROLE_TRANSITIONS[payload.current_role];

  let newStatus: VoyageStatus = 'active';
  if (nextRole === 'closed') {
    const hunterPayload = payload as HunterClosureHandoff;
    if (hunterPayload.outcome === 'complete') newStatus = 'complete';
    else if (hunterPayload.outcome === 'failed') newStatus = 'failed';
  }

  const lastEntry = record.history[record.history.length - 1];
  const roleStartedAt = lastEntry ? lastEntry.completed_at : record.started_at;
  const completedAt = now();

  const historyEntry = {
    role: payload.current_role,
    started_at: roleStartedAt,
    completed_at: completedAt,
    output_ref: payload.output_ref,
  };

  const newCurrentRole: VoyageRole = nextRole ?? 'closed';
  const newNextRole: VoyageRole | null = nextRole !== null ? ROLE_TRANSITIONS[nextRole] : null;

  return {
    ...record,
    current_role: newCurrentRole,
    next_role: newNextRole,
    status: newStatus,
    history: [...record.history, historyEntry],
  };
}
