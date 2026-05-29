import type { XpSource, XpReadResponse } from './schema';
import { effectiveXp } from './decay';

export interface BrainXpEnv {
  SUPERCLAUDE_BRAIN: D1Database;
}

export async function touchXp(
  env: BrainXpEnv,
  path: string,
  source: XpSource,
  delta = 1
): Promise<void> {
  const now = new Date().toISOString();
  await env.SUPERCLAUDE_BRAIN.prepare(
    `INSERT INTO brain_xp (path, xp, last_touched_at, touch_count, source_of_touch, created_at)
     VALUES (?, ?, ?, 1, ?, ?)
     ON CONFLICT(path) DO UPDATE SET
       xp = brain_xp.xp + ?,
       last_touched_at = ?,
       touch_count = brain_xp.touch_count + 1,
       source_of_touch = ?`
  ).bind(path, delta, now, source, now, delta, now, source).run();
}

export async function readXp(
  env: BrainXpEnv,
  path: string,
  now: Date = new Date()
): Promise<XpReadResponse> {
  const row = await env.SUPERCLAUDE_BRAIN.prepare(
    'SELECT path, xp, last_touched_at, touch_count, source_of_touch FROM brain_xp WHERE path = ?'
  ).bind(path).first<{
    path: string;
    xp: number;
    last_touched_at: string;
    touch_count: number;
    source_of_touch: string | null;
  }>();

  if (!row) {
    return { path, xp: 0, effective: 0, last_touched_at: null, touch_count: 0, source_of_touch: null };
  }

  return {
    path: row.path,
    xp: row.xp,
    effective: effectiveXp(row.xp, row.last_touched_at, now),
    last_touched_at: row.last_touched_at,
    touch_count: row.touch_count,
    source_of_touch: row.source_of_touch as XpSource | null,
  };
}
