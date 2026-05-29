import { z } from 'zod';

export const XP_SOURCES = ['write', 'preload_ref', 'reflection', 'backfill'] as const;
export type XpSource = typeof XP_SOURCES[number];

export const XpTouchBodySchema = z.object({
  path: z.string().min(1),
  source: z.enum(XP_SOURCES),
  delta: z.number().optional(),
});
export type XpTouchBody = z.infer<typeof XpTouchBodySchema>;

export type XpReadResponse = {
  path: string;
  xp: number;
  effective: number;
  last_touched_at: string | null;
  touch_count: number;
  source_of_touch: XpSource | null;
};
