// COMPLETE.md Validator — type definitions
// C1 establishes core types; C2 wires evidence layer; C3 wires webhook.

import type { CompleteSchemaType } from './schema'

export type BlockedCode =
  | 'blocked_schema'
  | 'blocked_fictional_field'
  | 'blocked_verify_log_malformed'
  | 'blocked_placeholder'
  | 'blocked_blocked_empty_flags'
  | 'blocked_status_evidence_mismatch'   // C2
  | 'blocked_push_unverified'            // C2
  | 'blocked_d1_sha_mismatch'            // C2
  | 'blocked_rate_limit'                 // C2

export type Agent = 'carpenter' | 'hunter' | 'unknown'

export type ValidatorVerdict =
  | { verdict: 'applied'; parsed: CompleteSchemaType; agent: Agent }
  | { verdict: 'partial_pending_evidence'; parsed: CompleteSchemaType; agent: Agent }
  | { verdict: BlockedCode; code: BlockedCode; message: string; diagnosis: Record<string, unknown> }

export interface ValidatorEnv {
  GITHUB_TOKEN: string
  // C2 may add D1 binding fields if needed
  CF_API_TOKEN?: string
  CF_ACCOUNT_ID?: string
}
