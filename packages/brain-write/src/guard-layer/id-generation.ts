import {
  ACTOR_SHORT_MAP,
  type ActionPayload,
  type ActorId,
  type TriggerSource,
} from './types'

export function generateActionId(
  actor: ActorId,
  target: string,
  ts: Date = new Date(),
): string {
  const iso = ts.toISOString()
  // YYYY-MM-DDTHH:MM:SS.sssZ → YYYYMMDDTHHMMSSZ
  const compact =
    iso.slice(0, 4) +
    iso.slice(5, 7) +
    iso.slice(8, 10) +
    'T' +
    iso.slice(11, 13) +
    iso.slice(14, 16) +
    iso.slice(17, 19) +
    'Z'
  const actorShort = ACTOR_SHORT_MAP[actor]
  const targetShort = target
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return `auto-${compact}-${actorShort}-${targetShort}`
}

export async function deriveIdempotencyKey(
  trigger: TriggerSource,
  action: ActionPayload,
): Promise<string> {
  const canonical = canonicalize({
    trigger: { type: trigger.type, details: trigger.details },
    action: { type: action.type, target: action.target, params: action.params },
  })
  return sha256Hex(canonical)
}

// Canonical JSON: keys sorted alphabetically at every level; no whitespace;
// NFC Unicode normalization at hash time; null/undefined elided from objects.
export function canonicalize(obj: unknown): string {
  if (obj === null || obj === undefined) return 'null'
  if (typeof obj === 'number') {
    if (!Number.isFinite(obj)) return 'null'
    return JSON.stringify(obj)
  }
  if (typeof obj !== 'object') return JSON.stringify(obj)
  if (Array.isArray(obj)) return '[' + obj.map(canonicalize).join(',') + ']'
  const rec = obj as Record<string, unknown>
  const keys = Object.keys(rec)
    .filter((k) => rec[k] !== undefined && rec[k] !== null)
    .sort()
  const pairs = keys.map((k) => JSON.stringify(k) + ':' + canonicalize(rec[k]))
  return '{' + pairs.join(',') + '}'
}

export async function sha256Hex(input: string): Promise<string> {
  const buf = new TextEncoder().encode(input.normalize('NFC'))
  const hash = await crypto.subtle.digest('SHA-256', buf)
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}
