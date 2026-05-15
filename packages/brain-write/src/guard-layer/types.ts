// Guard Layer Evidence Schema v1 — TypeScript form
// Canonical source: brain/05-knowledge/guard-layer-schema-v1.md

export type SchemaVersion = '1.0'

export type ActorId =
  | 'ops-board-agent'
  | 'locke-changelog-watcher'
  | 'voyage-worker'
  | 'reflection-worker'
  | 'quest-log-worker'
  | 'xp-middleware'
  | 'spirit-level-updater'
  | 'brain-graph-xp'
  | 'manual'

export type ActionIntent =
  | 'ops_board_promote'
  | 'ops_board_file'
  | 'ops_board_reopen'
  | 'brain_write'
  | 'hunt_skeleton_create'
  | 'voyage_state_advance'
  | 'voyage_abort'
  | 'xp_award'
  | 'xp_decrement'
  | 'spirit_level_adjust'
  | 'node_xp_increment'
  | 'node_archive_flag'
  | 'reflection_digest_write'
  | 'telegram_notify'

export interface TriggerSource {
  type:
    | 'github_webhook'
    | 'atom_feed'
    | 'cron'
    | 'council_verdict'
    | 'voyage_handoff'
    | 'manual'
  details: Record<string, unknown>
}

export interface ActionPayload {
  type: ActionIntent
  target: string
  params: Record<string, unknown>
  evidence_url?: string
}

export type VerifierCheck =
  | 'health_probe'
  | 'byte_equal_source'
  | 'ci_run_check'
  | 'kv_state_check'
  | 'counter_increment_valid'

export interface VerifierResult {
  check: VerifierCheck
  expected: string | number | Record<string, unknown>
  actual: string | number | Record<string, unknown>
  passed: boolean
  ts: string
  detail?: string
}

export interface ReverseCommand {
  command: string
  params: Record<string, unknown>
  estimated_difficulty: 'trivial' | 'moderate' | 'destructive'
  requires_confirmation: boolean
}

export interface NotificationLog {
  channel: 'telegram_ship_doctor' | 'telegram_tyler_direct' | 'audit_only'
  recipient?: string
  message_id?: string
  ts: string
  reason:
    | 'success_default'
    | 'failure'
    | 'anomaly'
    | 'verifier_blocked'
    | 'first_time_unknown_pattern'
}

export type Outcome =
  | 'applied'
  | 'noop_duplicate'
  | 'blocked_verifier'
  | 'blocked_idempotency'
  | 'deferred_confirmation'
  | 'failed_error'

export interface GuardLayerEvidence {
  schema_version: SchemaVersion
  action_id: string
  ts: string
  actor: ActorId
  intent: ActionIntent
  trigger: TriggerSource
  action: ActionPayload
  verification: VerifierResult[]
  verifier_outcome: 'passed' | 'failed' | 'skipped' | 'n/a'
  idempotency_key: string
  first_seen_ts: string
  fire_count: number
  reversible: boolean
  reversible_via: ReverseCommand | null
  outcome: Outcome
  outcome_detail: string
  notified: NotificationLog[]
}

export const ACTOR_SHORT_MAP: Record<ActorId, string> = {
  'ops-board-agent': 'ops',
  'locke-changelog-watcher': 'lcw',
  'voyage-worker': 'voy',
  'reflection-worker': 'ref',
  'quest-log-worker': 'qlw',
  'xp-middleware': 'xpm',
  'spirit-level-updater': 'slu',
  'brain-graph-xp': 'bgx',
  manual: 'man',
}

// REQUIRED_VERIFIERS lists the verifiers that MUST pass for a given intent.
// For ops_board_promote, the requirement only applies on transitions to COMPLETED;
// callers gate this themselves by setting/omitting verifierParams.
export const REQUIRED_VERIFIERS: Record<ActionIntent, VerifierCheck[]> = {
  ops_board_promote: ['health_probe', 'ci_run_check'],
  ops_board_file: [],
  ops_board_reopen: [],
  brain_write: [],
  hunt_skeleton_create: [],
  voyage_state_advance: ['kv_state_check'],
  voyage_abort: [],
  xp_award: ['counter_increment_valid'],
  xp_decrement: ['counter_increment_valid'],
  spirit_level_adjust: ['counter_increment_valid'],
  node_xp_increment: ['kv_state_check'],
  node_archive_flag: ['kv_state_check'],
  reflection_digest_write: [],
  telegram_notify: [],
}
