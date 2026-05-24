import { z } from "zod";

export const SessionStateSchema = z.object({
  session_id: z.string().uuid(),
  started_at: z.string().datetime(),
  surface: z.enum(["chat", "shell-bridge", "claude-code"]),
  last_updated_at: z.string().datetime(),
  active_hunt: z.string().optional(),
  active_clue: z.string().optional(),
  active_ops_id: z.string().optional(),
  notes: z.string().max(2000).optional(),
});

export type SessionState = z.infer<typeof SessionStateSchema>;
