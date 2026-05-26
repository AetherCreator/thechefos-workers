import {
  SpiritLevelStateSchema,
  LevelSetPayloadSchema,
  defaultState,
  HISTORY_MAX,
  type SpiritLevelState,
  type LevelSetPayload,
} from "./schema";
import { levelToTier, clampLevel } from "./helpers";

const KV_KEY = "current";

export async function readLevel(env: { SPIRIT_LEVEL_KV: KVNamespace }): Promise<SpiritLevelState> {
  try {
    const raw = await env.SPIRIT_LEVEL_KV.get(KV_KEY, "json");
    if (!raw) return defaultState();
    const parsed = SpiritLevelStateSchema.safeParse(raw);
    if (!parsed.success) {
      console.warn("spirit_level_kv_parse_failed", { error: parsed.error.message });
      return defaultState();
    }
    return parsed.data;
  } catch (e) {
    console.warn("spirit_level_kv_read_failed", { error: String(e) });
    return defaultState();
  }
}

export async function setLevel(
  env: { SPIRIT_LEVEL_KV: KVNamespace },
  payload: LevelSetPayload
): Promise<{ previous: SpiritLevelState; current: SpiritLevelState }> {
  const previous = await readLevel(env);
  const newLevel = clampLevel(payload.level);
  const newTier = levelToTier(newLevel);
  const now = new Date().toISOString();
  const newHistoryEntry = { level: newLevel, tier: newTier, source: payload.source, at: now };
  const newHistory = [...previous.history, newHistoryEntry].slice(-HISTORY_MAX);
  const current: SpiritLevelState = {
    level: newLevel,
    tier: newTier,
    last_updated_at: now,
    last_source: payload.source,
    history: newHistory,
  };
  await env.SPIRIT_LEVEL_KV.put(KV_KEY, JSON.stringify(current));
  return { previous, current };
}
