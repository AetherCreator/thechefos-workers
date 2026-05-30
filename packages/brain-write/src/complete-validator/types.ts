// COMPLETE.md Validator — type definitions
// C1: core types + parse-layer verdicts
// C2: extended ValidatorEnv (CF_API_TOKEN/CF_ACCOUNT_ID for D1 cross-source) + reproduction codes
// C3: webhook integration adds run_id + dry_run flags

import type { CompleteSchemaType } from './schema'

export type BlockedCode =
  | 'blocked_schema'
  | 'blocked_fictional_field'
  | 'blocked_verify_log_malformed'
  | 'blocked_placeholder'
  | 'blocked_blocked_empty_flags'
  | 'blocked_status_evidence_mismatch'
  | 'blocked_push_unverified'
  | 'blocked_d1_sha_mismatch'
  | 'blocked_rate_limit'
  | 'blocked_verify_log_reproduction_failed'

export type Agent = 'carpenter' | 'hunter' | 'claude-code' | 'chat-opus' | 'conductor' | 'grok' | 'unknown'

export type ValidatorVerdict =
  | { verdict: 'applied'; parsed: CompleteSchemaType; agent: Agent }
  | {
      verdict: BlockedCode
      code: BlockedCode
      message: string
      diagnosis: Record<string, unknown>
    }

export interface ValidatorEnv {
  GITHUB_TOKEN: string
  // D1 cross-source SHA verification (carpenter agent + run_id). Soft-skip when absent.
  CF_API_TOKEN?: string
  CF_ACCOUNT_ID?: string
  // Idempotency KV for grok-verify-failed OPS row dedup. Soft-skip when absent.
  IDEMPOTENCY_KEYS?: KVNamespace
}
