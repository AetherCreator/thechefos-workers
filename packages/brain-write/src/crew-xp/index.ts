import type { CrewRole, CrewXpState, GrantPayload } from './schema';
import { CREW_ROLES, initialState, GrantPayloadSchema } from './schema';
import { computeLevel } from './helpers';

export interface CrewXpEnv {
  CREW_XP_KV: KVNamespace;
  CREW_XP_DEDUP_KV: KVNamespace;
}

export type GrantResult =
  | { applied: true; role: CrewRole; prior_level: number; new_level: number; prior_xp: number; new_xp: number }
  | { deduped: true; role: CrewRole; current: CrewXpState }
  | { skipped: true; reason: 'role_undeployed' | 'role_unknown'; role: string };

const DEDUP_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

export async function grantXp(env: CrewXpEnv, payload: unknown): Promise<GrantResult> {
  const parsed = GrantPayloadSchema.safeParse(payload);
  if (!parsed.success) {
    throw new Error(`grant_payload_invalid: ${parsed.error.message}`);
  }
  const { role, completion_id, xp_delta } = parsed.data;

  // Dedup check
  const dedupKey = completion_id;
  const existing = await env.CREW_XP_DEDUP_KV.get(dedupKey);
  if (existing) {
    const current = await readRole(env, role);
    return { deduped: true, role, current };
  }

  // Load role state (create if missing)
  let state = await readRole(env, role);
  if (!state) {
    state = initialState(role);
  }

  if (!state.deployed) {
    // Still write dedup so we don't re-process; but skip XP grant
    await env.CREW_XP_DEDUP_KV.put(
      dedupKey,
      JSON.stringify({ role, granted_xp: 0, timestamp: new Date().toISOString(), skipped: 'role_undeployed' }),
      { expirationTtl: DEDUP_TTL_SECONDS }
    );
    return { skipped: true, reason: 'role_undeployed', role };
  }

  // Apply grant
  const prior_level = state.level;
  const prior_xp = state.xp;
  const new_xp = state.xp + xp_delta;
  const new_level = computeLevel(new_xp, state.thresholds);

  const updated: CrewXpState = {
    ...state,
    xp: new_xp,
    level: new_level,
    last_grant_at: new Date().toISOString(),
    last_completion_id: completion_id,
    total_grants: state.total_grants + 1,
  };

  // Write state + dedup (order matters: state first so dedup-replay returns fresh state)
  await env.CREW_XP_KV.put(role, JSON.stringify(updated));
  await env.CREW_XP_DEDUP_KV.put(
    dedupKey,
    JSON.stringify({ role, granted_xp: xp_delta, timestamp: updated.last_grant_at, prior_level, new_level }),
    { expirationTtl: DEDUP_TTL_SECONDS }
  );

  return { applied: true, role, prior_level, new_level, prior_xp, new_xp };
}

export async function readRole(env: CrewXpEnv, role: CrewRole): Promise<CrewXpState | null> {
  const raw = await env.CREW_XP_KV.get(role);
  if (!raw) return null;
  return JSON.parse(raw) as CrewXpState;
}

export async function readAll(env: CrewXpEnv): Promise<Record<CrewRole, CrewXpState>> {
  const result = {} as Record<CrewRole, CrewXpState>;
  for (const role of CREW_ROLES) {
    const state = await readRole(env, role);
    result[role] = state ?? initialState(role);
  }
  return result;
}

// Helper for C4 seeding
export async function seedInitialState(env: CrewXpEnv): Promise<{ created: CrewRole[]; existing: CrewRole[] }> {
  const created: CrewRole[] = [];
  const existing: CrewRole[] = [];
  for (const role of CREW_ROLES) {
    const current = await readRole(env, role);
    if (current) {
      existing.push(role);
    } else {
      await env.CREW_XP_KV.put(role, JSON.stringify(initialState(role)));
      created.push(role);
    }
  }
  return { created, existing };
}
