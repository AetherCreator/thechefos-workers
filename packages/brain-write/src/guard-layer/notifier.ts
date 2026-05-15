import type { GuardLayerEvidence, NotificationLog } from './types'

export interface NotifierEnv {
  TYLER_CHAT_ID?: string
  SHIPS_DOCTOR_BOT_TOKEN?: string
  MASTRO_BOT_TOKEN?: string // fallback if SHIPS_DOCTOR not provisioned
}

const TYLER_CHAT_ID_DEFAULT = '6091970994'

export async function dispatchNotifications(
  env: NotifierEnv,
  evidence: GuardLayerEvidence,
): Promise<NotificationLog[]> {
  const reason = determineReason(evidence)
  const ts = new Date().toISOString()

  if (reason === 'success_default') {
    return [{ channel: 'audit_only', ts, reason }]
  }

  const token = env.SHIPS_DOCTOR_BOT_TOKEN ?? env.MASTRO_BOT_TOKEN
  const chat_id = env.TYLER_CHAT_ID ?? TYLER_CHAT_ID_DEFAULT
  if (!token) {
    return [
      {
        channel: 'audit_only',
        ts,
        reason,
      },
    ]
  }

  const text = formatDoctorMessage(evidence, reason)
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id,
        text: `🩺 ${text}`,
        parse_mode: 'Markdown',
      }),
      signal: AbortSignal.timeout(10_000),
    })
    let message_id: string | undefined
    try {
      const json = (await r.json()) as { result?: { message_id?: number } }
      if (json?.result?.message_id !== undefined) {
        message_id = String(json.result.message_id)
      }
    } catch {
      // non-JSON response; still record channel attempt
    }
    return [
      {
        channel: 'telegram_ship_doctor',
        recipient: chat_id,
        message_id,
        ts,
        reason,
      },
    ]
  } catch (e) {
    return [
      {
        channel: 'audit_only',
        ts,
        reason,
      },
    ]
  }
}

function determineReason(e: GuardLayerEvidence): NotificationLog['reason'] {
  if (e.outcome === 'blocked_verifier') return 'verifier_blocked'
  if (e.outcome === 'failed_error') return 'failure'
  if (
    e.actor === 'locke-changelog-watcher' &&
    e.intent === 'ops_board_file'
  ) {
    return 'first_time_unknown_pattern'
  }
  return 'success_default'
}

function formatDoctorMessage(
  e: GuardLayerEvidence,
  reason: NotificationLog['reason'],
): string {
  const head =
    reason === 'verifier_blocked'
      ? `⚠️ *Guard Layer BLOCKED*`
      : reason === 'failure'
        ? `🚨 *Guard Layer FAILURE*`
        : `📥 *Guard Layer notice*`
  const failed = e.verification.find((v) => !v.passed)
  const verifierLine = failed
    ? `Verifier *${failed.check}* failed: ${failed.detail ?? '(no detail)'}`
    : null
  const lines = [
    head,
    `\`${e.action_id}\``,
    `Actor: \`${e.actor}\` → Intent: \`${e.intent}\``,
    `Target: \`${e.action.target}\``,
    verifierLine,
    `Outcome: \`${e.outcome}\``,
    e.outcome_detail ? `Detail: ${e.outcome_detail}` : null,
  ].filter(Boolean)
  return lines.join('\n')
}
