// Agent inference — explicit > heuristic > unknown.

import type { CompleteSchemaType } from './schema'
import type { Agent } from './types'

const CARPENTER_HINT = 'workspace-carpenter'
const HUNTER_HINTS = ['auto-exec.sh', 'claude-exec.sh']

export function inferAgent(parsed: CompleteSchemaType): Agent {
  // Priority 1: explicit field on COMPLETE.md
  if (parsed.agent) return parsed.agent

  // Priority 2: heuristic over verify_log content (handles both string and object entries)
  const blob = parsed.verify_log
    .map(e => (typeof e === 'string' ? e : e.cmd))
    .join('\n')
    .toLowerCase()
  if (blob.includes(CARPENTER_HINT)) return 'carpenter'
  if (HUNTER_HINTS.some(h => blob.includes(h))) return 'hunter'

  // Priority 3: default
  return 'unknown'
}
