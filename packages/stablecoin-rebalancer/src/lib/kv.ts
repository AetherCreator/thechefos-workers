import type { Env } from "./assert-read-only";

export async function cacheGet(env: Env, key: string): Promise<string | null> {
  return env.CACHE.get(key);
}

export async function cachePut(env: Env, key: string, value: string, ttlSec: number): Promise<void> {
  await env.CACHE.put(key, value, { expirationTtl: ttlSec });
}
