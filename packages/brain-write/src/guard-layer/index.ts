import { generateActionId, deriveIdempotencyKey } from './id-generation'
import {
  checkIdempotency,
  incrementFireCount,
  recordIdempotencyResult,
  type IdempotencyEnv,
} from './idempotency'
import { runVerifiers, type VerifierEnv } from './verifier'
import { writeEvidence, type EvidenceEnv } from './evidence'
import { dispatchNotifications, type NotifierEnv } from './notifier'
import type {
  ActionPayload,
  ActorId,
  ActionIntent,
  GuardLayerEvidence,
  Outcome,
  ReverseCommand,
  TriggerSource,
  VerifierResult,
} from './types'

export type GuardLayerEnv = IdempotencyEnv & VerifierEnv & EvidenceEnv & NotifierEnv

export interface GuardLayerRequest {
  actor: ActorId
  intent: ActionIntent
  trigger: TriggerSource
  action: ActionPayload
  // Per-call verifier inputs (url for health_probe, repo/commit_sha for ci_run_check, etc.).
  // Set __skip_verifiers=true to skip the required verifier list (e.g. ops_board_promote
  // → ACTIVE/BACKLOG transitions don't need health/CI checks).
  verifierParams?: Record<string, unknown>
  // Callback that performs the actual side effect. Only invoked when verifiers
  // pass (or are n/a) and the action is not a duplicate fire.
  executeAction: () => Promise<{
    detail: string
    reversible_via: ReverseCommand | null
  }>
}

export interface GuardLayerResponse {
  outcome: Outcome
  evidence: GuardLayerEvidence
}

export async function guardLayer(
  env: GuardLayerEnv,
  req: GuardLayerRequest,
): Promise<GuardLayerResponse> {
  const ts = new Date().toISOString()
  const action_id = generateActionId(req.actor, req.action.target)
  const idempotency_key = await deriveIdempotencyKey(req.trigger, req.action)

  // 1. Idempotency BEFORE verifiers — no double work, no double fetches.
  const idem = await checkIdempotency(env, idempotency_key)
  if (!idem.first_fire) {
    const updated = await incrementFireCount(env, idempotency_key, idem.cached)
    const duplicate_evidence: GuardLayerEvidence = {
      ...idem.cached.evidence,
      action_id,
      ts,
      outcome: 'noop_duplicate',
      outcome_detail: `Idempotency match. Returned cached result from first fire at ${idem.cached.evidence.first_seen_ts}.`,
      fire_count: updated.fire_count,
      notified: [],
      verification: [],
      verifier_outcome: 'skipped',
    }
    return { outcome: 'noop_duplicate', evidence: duplicate_evidence }
  }

  // 2. Run verifiers.
  const { results, outcome: verifier_outcome } = await runVerifiers(
    env,
    req.intent,
    req.verifierParams ?? {},
  )

  let outcome: Outcome
  let outcome_detail: string
  let reversible_via: ReverseCommand | null = null

  if (verifier_outcome === 'failed') {
    outcome = 'blocked_verifier'
    outcome_detail = formatBlockedMessage(req, results)
  } else {
    try {
      const ar = await req.executeAction()
      outcome = 'applied'
      outcome_detail = ar.detail
      reversible_via = ar.reversible_via
    } catch (e) {
      outcome = 'failed_error'
      outcome_detail = `Action execution failed: ${String(e)}`
    }
  }

  const evidence: GuardLayerEvidence = {
    schema_version: '1.0',
    action_id,
    ts,
    actor: req.actor,
    intent: req.intent,
    trigger: req.trigger,
    action: req.action,
    verification: results,
    verifier_outcome,
    idempotency_key,
    first_seen_ts: ts,
    fire_count: 1,
    reversible: reversible_via !== null,
    reversible_via,
    outcome,
    outcome_detail,
    notified: [],
  }

  evidence.notified = await dispatchNotifications(env, evidence)

  // 6. Audit-first: write evidence BEFORE returning to caller.
  await writeEvidence(env, evidence)

  // 7. Cache final result under idempotency key so a retry returns this evidence.
  await recordIdempotencyResult(env, idempotency_key, evidence)

  return { outcome, evidence }
}

function formatBlockedMessage(
  req: GuardLayerRequest,
  results: VerifierResult[],
): string {
  const failed = results.find((r) => !r.passed)
  const head = `Guard Layer BLOCKED ${req.intent} for ${req.action.target}.`
  if (!failed) return head
  return `${head} Verifier ${failed.check} failed: ${failed.detail ?? JSON.stringify(failed.actual)}`
}

export type { GuardLayerEvidence, ReverseCommand } from './types'
