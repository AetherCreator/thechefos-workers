import type { GuardLayerEvidence } from './types'

export interface StoredIdempotency {
  action_id: string
  evidence: GuardLayerEvidence
  fire_count: number
}

export interface IdempotencyEnv {
  IDEMPOTENCY_KEYS: KVNamespace
}

const TTL_SECONDS = 30 * 86400

export async function checkIdempotency(
  env: IdempotencyEnv,
  key: string,
): Promise<
  | { first_fire: true }
  | { first_fire: false; cached: StoredIdempotency }
> {
  const existing = (await env.IDEMPOTENCY_KEYS.get(
    key,
    'json',
  )) as StoredIdempotency | null
  if (existing) return { first_fire: false, cached: existing }
  return { first_fire: true }
}

export async function recordIdempotencyResult(
  env: IdempotencyEnv,
  key: string,
  evidence: GuardLayerEvidence,
): Promise<void> {
  const stored: StoredIdempotency = {
    action_id: evidence.action_id,
    evidence,
    fire_count: 1,
  }
  await env.IDEMPOTENCY_KEYS.put(key, JSON.stringify(stored), {
    expirationTtl: TTL_SECONDS,
  })
}

export async function incrementFireCount(
  env: IdempotencyEnv,
  key: string,
  prior: StoredIdempotency,
): Promise<StoredIdempotency> {
  const updated: StoredIdempotency = {
    ...prior,
    fire_count: prior.fire_count + 1,
  }
  await env.IDEMPOTENCY_KEYS.put(key, JSON.stringify(updated), {
    expirationTtl: TTL_SECONDS,
  })
  return updated
}
