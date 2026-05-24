// 5-min KV read-through cache layer. C2 consumes getCachedState for dashboard
// rendering — reads are served from KV (edge-cached); writes set a 5-min expiry.
import type { SessionState } from "./schema";

const CURRENT_KEY = "current";
const CACHE_TTL_SECONDS = 300;

export async function getCachedState(kv: KVNamespace): Promise<SessionState | null> {
  const raw = await kv.get(CURRENT_KEY, "text");
  if (!raw) return null;
  try {
    return JSON.parse(raw) as SessionState;
  } catch {
    return null;
  }
}

export async function putCachedState(kv: KVNamespace, state: SessionState): Promise<void> {
  await kv.put(CURRENT_KEY, JSON.stringify(state), {
    expirationTtl: CACHE_TTL_SECONDS,
  });
}

export async function getCachedOrFetch<T>(
  kv: KVNamespace,
  key: string,
  ttlSeconds: number,
  fetcher: () => Promise<T>
): Promise<T> {
  const cached = await kv.get(key, "json");
  if (cached !== null) return cached as T;
  const fresh = await fetcher();
  await kv.put(key, JSON.stringify(fresh), { expirationTtl: ttlSeconds });
  return fresh;
}
