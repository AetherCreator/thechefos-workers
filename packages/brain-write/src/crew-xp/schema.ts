import { z } from 'zod';

export const CREW_ROLES = [
  'captain',
  'mapmaker',
  'quartermaster',
  'hunter',
  'ships-doctor',
  'carpenter',
  'council',
  'librarian',
] as const;

export type CrewRole = typeof CREW_ROLES[number];

export const CrewXpStateSchema = z.object({
  role: z.enum(CREW_ROLES),
  level: z.number().int().min(1).max(5),
  xp: z.number().int().min(0),
  thresholds: z.tuple([z.number().int(), z.number().int(), z.number().int(), z.number().int()]),
  last_grant_at: z.string().datetime().nullable(),
  last_completion_id: z.string().nullable(),
  total_grants: z.number().int().min(0),
  total_grant_failures: z.number().int().min(0),
  deployed: z.boolean(),
});

export type CrewXpState = z.infer<typeof CrewXpStateSchema>;

export const GrantPayloadSchema = z.object({
  role: z.enum(CREW_ROLES),
  completion_id: z.string().min(1),
  xp_delta: z.number().int().positive().optional().default(1),
});

export type GrantPayload = z.infer<typeof GrantPayloadSchema>;

export const DEFAULT_THRESHOLDS: [number, number, number, number] = [10, 40, 100, 200];

export const initialState = (role: CrewRole): CrewXpState => ({
  role,
  level: 1,
  xp: 0,
  thresholds: DEFAULT_THRESHOLDS,
  last_grant_at: null,
  last_completion_id: null,
  total_grants: 0,
  total_grant_failures: 0,
  deployed: role !== 'librarian', // librarian undeployed until OPS-LIBRARIAN-DEPLOY
});
