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

// TODO C2: add CaptainHandoffSchema, MapmakerHandoffSchema, QuartermasterHandoffSchema, HunterHandoffSchema
