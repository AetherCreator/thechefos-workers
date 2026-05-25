import type { Env } from '../../types';

export interface SeenValue {
  first_seen_ts: string;
  severity: string;
  lead_url: string;
}

function sanitizeKey(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 200);
}

export function buildSeenKey(depName: string, entryId: string): string {
  return sanitizeKey(`${depName}:${entryId}`);
}

export async function isSeen(env: Env, key: string): Promise<boolean> {
  const val = await env.CHANGELOG_SEEN.get(sanitizeKey(key));
  return val !== null;
}

export async function markSeen(env: Env, key: string, value: SeenValue): Promise<void> {
  await env.CHANGELOG_SEEN.put(sanitizeKey(key), JSON.stringify(value));
}
