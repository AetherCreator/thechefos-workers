import { z } from 'zod';

export const VoyageStartRequestSchema = z.object({
  hunt: z.string().min(1),
  hunt_intent: z.string().min(1),
  captain_notes: z.string().optional(),
  evidence_links: z.array(z.string().url()).optional(),
  scope_constraints: z.string().optional(),
  expected_completion_by: z.string().datetime().optional(),
});

export type VoyageStartRequest = z.infer<typeof VoyageStartRequestSchema>;

export const VoyageRecordSchema = z.object({
  voyage_id: z.string(),
  hunt: z.string(),
  hunt_intent: z.string(),
  started_at: z.string(),
  current_role: z.enum(['captain', 'mapmaker', 'quartermaster', 'hunter', 'closed']),
  next_role: z.enum(['captain', 'mapmaker', 'quartermaster', 'hunter', 'closed']).nullable(),
  status: z.enum(['active', 'blocked', 'failed', 'aborted', 'complete']),
  history: z.array(z.object({
    role: z.enum(['captain', 'mapmaker', 'quartermaster', 'hunter', 'closed']),
    started_at: z.string(),
    completed_at: z.string(),
    output_ref: z.string(),
  })),
  expected_completion_by: z.string().nullable(),
  last_stall_ping_at: z.string().nullable(),
  block_reason: z.string().nullable(),
  anomaly_log: z.array(z.object({ ts: z.string(), reason: z.string() })),
  scope_constraints: z.string().optional(),
});

export const CaptainToMapMakerHandoffSchema = z.object({
  voyage_id: z.string(),
  current_role: z.literal('captain'),
  output_ref: z.string().min(1),
  hunt_intent: z.string(),
  captain_notes: z.string().optional(),
  evidence_links: z.array(z.string().url()).optional(),
  scope_constraints: z.string().optional(),
  expected_completion_by_next: z.string().datetime().optional(),
});

export const MapMakerToQuartermasterHandoffSchema = z.object({
  voyage_id: z.string(),
  current_role: z.literal('mapmaker'),
  output_ref: z.string().min(1),
  charter_ref: z.string(),
  map_ref: z.string(),
  clue_count: z.number().int().min(1),
  exec_tags: z.array(z.string()),
  tree_stumps: z.array(z.string()).optional(),
  expected_completion_by_next: z.string().datetime().optional(),
});

export const QuartermasterToHunterHandoffSchema = z.object({
  voyage_id: z.string(),
  current_role: z.literal('quartermaster'),
  output_ref: z.string().min(1),
  preflight_passed: z.boolean(),
  preflight_report_ref: z.string(),
  warnings: z.array(z.string()),
  first_clue: z.string(),
  expected_completion_by_next: z.string().datetime().optional(),
});

export const HunterClosureHandoffSchema = z.object({
  voyage_id: z.string(),
  current_role: z.literal('hunter'),
  output_ref: z.string().min(1),
  outcome: z.enum(['complete', 'partial', 'failed']),
  commits: z.array(z.string()),
  complete_md_refs: z.array(z.string()),
});

export const HandoffPayloadSchema = z.discriminatedUnion('current_role', [
  CaptainToMapMakerHandoffSchema,
  MapMakerToQuartermasterHandoffSchema,
  QuartermasterToHunterHandoffSchema,
  HunterClosureHandoffSchema,
]);

export type HandoffPayload = z.infer<typeof HandoffPayloadSchema>;
export type HunterClosureHandoff = z.infer<typeof HunterClosureHandoffSchema>;
