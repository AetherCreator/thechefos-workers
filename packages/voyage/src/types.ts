export type VoyageRole = 'captain' | 'mapmaker' | 'quartermaster' | 'hunter' | 'closed';

export type VoyageStatus = 'active' | 'blocked' | 'failed' | 'aborted' | 'complete';

export interface VoyageHistoryEntry {
  role: VoyageRole;
  started_at: string;
  completed_at: string;
  output_ref: string;
}

export interface VoyageRecord {
  voyage_id: string;
  hunt: string;
  hunt_intent: string;
  started_at: string;
  current_role: VoyageRole;
  next_role: VoyageRole | null;
  status: VoyageStatus;
  history: VoyageHistoryEntry[];
  expected_completion_by: string | null;
  last_stall_ping_at: string | null;
  block_reason: string | null;
  anomaly_log: Array<{ ts: string; reason: string }>;
  scope_constraints?: string;
}

export interface Env {
  VOYAGE_STATE: KVNamespace;
  VOYAGE_IDEMPOTENCY: KVNamespace;
  BRAIN_WRITE_BASE_URL: string;
  BRAIN_WRITE_API_SECRET: string;
  SHIPS_DOCTOR_BOT_TOKEN: string;
  TYLER_CHAT_ID: string;
  VOYAGE_ABORT_SECRET: string;
}
