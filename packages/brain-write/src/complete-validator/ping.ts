// Ship's Doctor (Crazy I. Joe) Telegram ping for validator rejections.
//
// Posts to the spec-conformant /api/telegram relay used by /api/ops/escalate
// (see src/index.ts:808+). Relay is currently a black hole per OPS-041, but
// the contract is correct; when OPS-041 ships, pings start delivering with
// no validator change.
//
// Only fires when enforce + blocked. Dry-run is silent (audit trail only).

import type { AuditTrailEntry } from './audit'

const TELEGRAM_RELAY_URL = 'https://api.thechefos.app/api/telegram'

export interface PingResult {
  ok: boolean
  relay_status?: number
  relay_body?: string
  error?: string
  note: string
}

export async function pingShipsDoctor(entry: AuditTrailEntry): Promise<PingResult> {
  const diag = entry.diagnosis as { message?: string }
  const text = [
    `🚨 *COMPLETE.md REJECTED — ${entry.verdict}*`,
    `Hunt: \`${entry.hunt}\` Clue: \`${entry.clue}\``,
    `Agent: \`${entry.agent}\``,
    `Run: \`${entry.run_id}\``,
    `Why: ${diag?.message ?? '(see audit trail)'}`,
    `File: \`${entry.file}\``,
    `Push: \`${entry.push_repo}@${entry.push_sha.slice(0, 7)}\``,
    `Audit: \`brain/06-meta/auto-actions/${entry.timestamp.slice(0, 10)}/${entry.run_id}.json\``,
  ].join('\n')

  const payload = {
    text,
    severity: 'critical' as const,
    source: 'complete_validator',
    hunt: entry.hunt,
    clue: entry.clue,
    verdict: entry.verdict,
    file: entry.file,
    run_id: entry.run_id,
  }

  try {
    const r = await fetch(TELEGRAM_RELAY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const body = await r.text()
    return {
      ok: r.ok,
      relay_status: r.status,
      relay_body: body,
      note: 'OPS-041: /api/telegram does not currently relay to Telegram. relay_status=200 does NOT prove delivery.',
    }
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
      note: 'telegram relay unreachable',
    }
  }
}
