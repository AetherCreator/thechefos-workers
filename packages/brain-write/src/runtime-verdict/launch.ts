// runtime-verdict/launch.ts — C2.1 Phase 1 (ADVISORY): decoupled runtime-verify launcher.
//
// Fires a fast, fire-and-forget launch of /opt/scripts/runtime-verifier.sh on InfiniVeg
// via the Shell Bridge. The verifier shell-reproduces non-hermetic (godot/bash) verify_log
// entries against origin@work_commit and POSTs the verdict back to /api/runtime-verdict.
//
// This NEVER blocks or alters COMPLETE.md promotion: callers invoke it inside
// c.executionCtx.waitUntil(...).catch(()=>{}) and it self-skips when unconfigured.
// The background launch (`... &`) returns immediately, so waitUntil only covers the
// sub-second Shell-Bridge POST — never the ~10s godot run.

const CALLBACK_URL = 'https://thechefos-brain-write.tveg-baking.workers.dev/api/runtime-verdict'

// Hermetic tools the structural validator can already simulate (see reproduce.ts).
// Anything else (godot, bash, ./*.sh, ...) is "unsimulatable" => the runtime tier's job.
const HERMETIC_TOOLS = new Set(['test', '[', 'grep', 'wc', 'cat', 'ls', 'head', 'tail', 'find'])

type VerifyLogEntry = string | { cmd: string; expect: string; claim?: string }
export interface RuntimeEntry {
  cmd: string
  expect: string
}

export function selectUnsimulatable(verifyLog: VerifyLogEntry[]): RuntimeEntry[] {
  const out: RuntimeEntry[] = []
  for (const e of verifyLog || []) {
    if (typeof e !== 'object' || e === null) continue
    const cmd = String(e.cmd || '').trim()
    const expect = String(e.expect || '').trim()
    if (!cmd || !expect) continue
    const firstToken = cmd.split(/\s+/)[0]
    if (!HERMETIC_TOOLS.has(firstToken)) out.push({ cmd, expect })
  }
  return out
}

interface LaunchEnv {
  SHELL_BRIDGE_URL?: string
  SHELL_BRIDGE_KEY?: string
}
export interface LaunchParams {
  work_repo: string
  work_commit: string
  hunt: string
  clue: string
  branch?: string
  entries: RuntimeEntry[]
}

const SHA_RE = /^[a-f0-9]{40}$/
const REPO_RE = /^[\w.-]+\/[\w.-]+$/
const SAFE_RE = /^[\w./-]+$/

export async function launchRuntimeVerify(
  env: LaunchEnv,
  p: LaunchParams,
): Promise<{ ok: boolean; skipped?: string; error?: string; entries?: number }> {
  if (!env.SHELL_BRIDGE_URL || !env.SHELL_BRIDGE_KEY) return { ok: false, skipped: 'shell_bridge_unconfigured' }
  if (!p.entries || p.entries.length === 0) return { ok: false, skipped: 'no_unsimulatable_entries' }

  // Injection guard: every value interpolated into the shell command is strictly validated.
  if (!SHA_RE.test(p.work_commit)) return { ok: false, error: 'bad work_commit' }
  if (!REPO_RE.test(p.work_repo)) return { ok: false, error: 'bad work_repo' }
  if (!SAFE_RE.test(p.hunt) || !SAFE_RE.test(p.clue)) return { ok: false, error: 'bad hunt/clue' }
  if (p.branch && !SAFE_RE.test(p.branch)) return { ok: false, error: 'bad branch' }

  const entriesJson = JSON.stringify(p.entries)
  const b64 = btoa(unescape(encodeURIComponent(entriesJson)))
  const file = `/tmp/rv-${p.work_commit}.json`
  const branchArg = p.branch ? ` --branch ${p.branch}` : ''
  // Note: the verifier reads its callback key from /opt/secrets on InfiniVeg — no secret
  // is ever placed in this command (keeps secrets out of Shell-Bridge logs).
  const command =
    `F=${file}; echo '${b64}' | base64 -d > "$F"; ` +
    `nohup bash /opt/scripts/runtime-verifier.sh ` +
    `--work-repo ${p.work_repo} --work-commit ${p.work_commit} ` +
    `--hunt ${p.hunt} --clue ${p.clue}${branchArg} ` +
    `--entries "$F" --callback-url ${CALLBACK_URL} ` +
    `> /tmp/rv-${p.work_commit}.log 2>&1 &`

  try {
    const res = await fetch(env.SHELL_BRIDGE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-shell-key': env.SHELL_BRIDGE_KEY },
      body: JSON.stringify({ command }),
    })
    if (!res.ok) return { ok: false, error: `shell_bridge_http_${res.status}` }
    return { ok: true, entries: p.entries.length }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}
