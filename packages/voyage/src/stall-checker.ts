import type { Env, VoyageRecord } from './types';

export const STALL_GRACE_MS = 15 * 60 * 1000;

export async function findStalledVoyages(env: Env, now: Date = new Date()): Promise<VoyageRecord[]> {
  const stalled: VoyageRecord[] = [];
  let cursor: string | undefined;

  while (true) {
    const result = await env.VOYAGE_STATE.list({ limit: 1000, cursor });

    for (const key of result.keys) {
      const raw = await env.VOYAGE_STATE.get(key.name);
      if (!raw) continue;

      const record: VoyageRecord = JSON.parse(raw);

      if (record.status !== 'active') continue;
      if (!record.expected_completion_by) continue;

      const etaMs = new Date(record.expected_completion_by).getTime();
      if ((now.getTime() - etaMs) <= STALL_GRACE_MS) continue;

      // Dedup: skip if already pinged for this stall episode (ping was after the ETA)
      if (
        record.last_stall_ping_at !== null &&
        new Date(record.last_stall_ping_at).getTime() >= etaMs
      ) continue;

      stalled.push(record);
    }

    if (result.list_complete) break;
    cursor = result.cursor;
  }

  return stalled;
}

export async function pingShipsDoctor(env: Env, voyage: VoyageRecord): Promise<void> {
  const message = [
    `🚨 Voyage stalled: ${voyage.voyage_id}`,
    `Hunt: ${voyage.hunt}`,
    `Stuck at role: ${voyage.current_role}`,
    `ETA was: ${voyage.expected_completion_by}`,
    `Now: ${new Date().toISOString()}`,
    `Link: https://voyage.tveg-baking.workers.dev/voyage/${voyage.voyage_id}`,
  ].join('\n');

  const r = await fetch(
    `https://api.telegram.org/bot${env.SHIPS_DOCTOR_BOT_TOKEN}/sendMessage`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: env.TYLER_CHAT_ID, text: message, parse_mode: 'Markdown' }),
    }
  );

  if (!r.ok) {
    throw new Error(`Telegram API returned ${r.status}`);
  }
}
