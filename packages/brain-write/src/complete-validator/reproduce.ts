// C2 reproduction engine — re-executes verify_log[].cmd against origin@work_commit
// and compares actual output to expect. Any mismatch => verdict: REJECTED.
//
// Execution model: hermetic GitHub-API-backed simulation.
//   - Supported cmds: test -f, test -d, grep -c, wc -l
//   - Unsimulatable cmds (godot, bash, etc.) => exit=127 (error posture: reject, not pass)
//   - All paths must be repo-root-relative (absolute paths rejected)
//   - No network calls beyond GitHub contents API at the claimed commit
//
// Per §2.4 of the C2 spec: rejection is the DEFAULT on any ambiguity.
// A cmd that errors unexpectedly is a reject, not a pass.

import type { VerifyLogObjectEntry } from './schema'

const GITHUB_API = 'https://api.github.com'
const PER_CMD_TIMEOUT_MS = 15_000
const TOTAL_TIMEOUT_MS = 90_000

export interface ReproduceEnv {
  GITHUB_TOKEN: string
  // C2.2 (flag-gated, default off): when 'true', unsimulatable verify_log entries are
  // DEFERRED to the decoupled runtime tier instead of being 127-rejected structurally.
  RUNTIME_DEFER?: string
}

export interface EntryResult {
  cmd: string
  expect: string
  claim: string
  pass: boolean
  actual_exit: number
  actual_stdout: string
  detail: string
  deferred?: boolean
}

export interface ReproduceResult {
  verdict: 'APPLIED' | 'REJECTED'
  failing_entry?: EntryResult
  entries: EntryResult[]
  wall_ms: number
  deferred_count?: number
}

// ─── Hermeticity guard ───────────────────────────────────────────────────────

// Reject cmds that reference absolute paths or common network tools.
const ABSOLUTE_PATH_RE = /(?:^|\s)(\/[a-z])/i
const NETWORK_CMD_RE = /\b(curl|wget|fetch|nc|ncat|netcat)\b/

function hermeticityViolation(cmd: string): string | null {
  if (ABSOLUTE_PATH_RE.test(cmd)) return 'cmd references absolute path (forbidden by hermeticity rules)'
  if (NETWORK_CMD_RE.test(cmd)) return 'cmd references network tool (forbidden by hermeticity rules)'
  return null
}

// ─── Command parser ──────────────────────────────────────────────────────────

type ParsedCmd =
  | { type: 'file_exists'; path: string }
  | { type: 'dir_exists'; path: string }
  | { type: 'grep_count'; pattern: string; file: string }
  | { type: 'wc_l'; file: string }
  | { type: 'unsimulatable'; reason: string }

function parseCmd(cmd: string): ParsedCmd {
  const s = cmd.trim()

  // test -f <path>
  const testF = s.match(/^test\s+-f\s+(\S+)$/)
  if (testF) return { type: 'file_exists', path: testF[1] }

  // test -d <path>
  const testD = s.match(/^test\s+-d\s+(\S+)$/)
  if (testD) return { type: 'dir_exists', path: testD[1] }

  // grep -c '<PATTERN>' <FILE>  (single or double quotes)
  const grepSingle = s.match(/^grep\s+-c\s+'([^']*)'\s+(\S+)$/)
  if (grepSingle) return { type: 'grep_count', pattern: grepSingle[1], file: grepSingle[2] }
  const grepDouble = s.match(/^grep\s+-c\s+"([^"]*)"\s+(\S+)$/)
  if (grepDouble) return { type: 'grep_count', pattern: grepDouble[1], file: grepDouble[2] }

  // wc -l < <FILE>
  const wcl = s.match(/^wc\s+-l\s+<\s+(\S+)$/)
  if (wcl) return { type: 'wc_l', file: wcl[1] }

  return { type: 'unsimulatable', reason: `no simulation rule for: ${s.split(' ')[0]}` }
}

// ─── Expect evaluator ────────────────────────────────────────────────────────

interface CmdActual {
  exit: number
  stdout: string
}

function evaluateExpect(expect: string, actual: CmdActual): { pass: boolean; detail: string } {
  const e = expect.trim()

  if (e === 'exit==0') {
    const pass = actual.exit === 0
    return { pass, detail: `exit==0: got exit=${actual.exit}` }
  }
  if (e === 'exit!=0') {
    const pass = actual.exit !== 0
    return { pass, detail: `exit!=0: got exit=${actual.exit}` }
  }
  if (e === 'file_exists') {
    const pass = actual.exit === 0
    return { pass, detail: `file_exists: got exit=${actual.exit}` }
  }
  if (e === 'dir_exists') {
    const pass = actual.exit === 0
    return { pass, detail: `dir_exists: got exit=${actual.exit}` }
  }
  if (e.startsWith('grep_count>=')) {
    const n = parseInt(e.slice('grep_count>='.length), 10)
    const count = parseInt(actual.stdout.trim(), 10)
    if (isNaN(count)) return { pass: false, detail: `grep_count>=${n}: stdout not numeric: "${actual.stdout.trim()}"` }
    const pass = count >= n
    return { pass, detail: `grep_count>=${n}: got ${count}` }
  }
  if (e === 'grep_count==0') {
    const count = parseInt(actual.stdout.trim(), 10)
    if (isNaN(count)) return { pass: false, detail: `grep_count==0: stdout not numeric: "${actual.stdout.trim()}"` }
    const pass = count === 0
    return { pass, detail: `grep_count==0: got ${count}` }
  }
  if (e.startsWith('stdout_contains:')) {
    const token = e.slice('stdout_contains:'.length)
    const pass = actual.stdout.includes(token)
    return { pass, detail: `stdout_contains:${token}: ${pass ? 'found' : 'absent'} in stdout` }
  }

  return { pass: false, detail: `unknown expect predicate: ${e}` }
}

// ─── GitHub file fetcher ─────────────────────────────────────────────────────

interface GithubFetchResult {
  ok: boolean
  isDir: boolean
  content: string
  status: number
}

async function fetchGithubPath(
  repo: string,
  path: string,
  ref: string,
  token: string,
  timeoutMs: number,
): Promise<GithubFetchResult> {
  const [owner, repoName] = repo.split('/')
  const url = `${GITHUB_API}/repos/${owner}/${repoName}/contents/${path}?ref=${encodeURIComponent(ref)}`
  try {
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'thechefos-workers-reproduce/1.0',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!res.ok) return { ok: false, isDir: false, content: '', status: res.status }

    const body = await res.json() as unknown
    // Directory: GitHub returns an array
    if (Array.isArray(body)) {
      return { ok: true, isDir: true, content: '', status: 200 }
    }
    const file = body as { content?: string; encoding?: string; type?: string }
    if (file.type === 'dir') return { ok: true, isDir: true, content: '', status: 200 }
    if (!file.content || file.encoding !== 'base64') {
      return { ok: false, isDir: false, content: '', status: 200 }
    }
    const decoded = decodeURIComponent(escape(atob(file.content.replace(/\n/g, ''))))
    return { ok: true, isDir: false, content: decoded, status: 200 }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { ok: false, isDir: false, content: '', status: -1 }
  }
}

// ─── Single cmd executor ─────────────────────────────────────────────────────

async function executeCmd(
  parsed: ParsedCmd,
  work_repo: string,
  work_commit: string,
  env: ReproduceEnv,
): Promise<CmdActual> {
  if (parsed.type === 'unsimulatable') {
    // Error posture: unsimulatable = reject, not pass
    return { exit: 127, stdout: '' }
  }

  if (parsed.type === 'file_exists') {
    const r = await fetchGithubPath(work_repo, parsed.path, work_commit, env.GITHUB_TOKEN, PER_CMD_TIMEOUT_MS)
    if (!r.ok || r.isDir) return { exit: 1, stdout: '' }
    return { exit: 0, stdout: '' }
  }

  if (parsed.type === 'dir_exists') {
    const r = await fetchGithubPath(work_repo, parsed.path, work_commit, env.GITHUB_TOKEN, PER_CMD_TIMEOUT_MS)
    if (!r.ok || !r.isDir) return { exit: 1, stdout: '' }
    return { exit: 0, stdout: '' }
  }

  if (parsed.type === 'grep_count') {
    const r = await fetchGithubPath(work_repo, parsed.file, work_commit, env.GITHUB_TOKEN, PER_CMD_TIMEOUT_MS)
    if (!r.ok) return { exit: 2, stdout: '' } // grep exits 2 on error
    const lines = r.content.split('\n')
    const count = lines.filter(l => l.includes(parsed.pattern)).length
    return { exit: 0, stdout: String(count) }
  }

  if (parsed.type === 'wc_l') {
    const r = await fetchGithubPath(work_repo, parsed.file, work_commit, env.GITHUB_TOKEN, PER_CMD_TIMEOUT_MS)
    if (!r.ok) return { exit: 1, stdout: '' }
    const lines = r.content.split('\n').length
    return { exit: 0, stdout: String(lines) }
  }

  // Should never reach here
  return { exit: 127, stdout: '' }
}

// ─── Main reproduction pass ───────────────────────────────────────────────────

export async function reproduceEntries(
  entries: VerifyLogObjectEntry[],
  work_repo: string,
  work_commit: string,
  env: ReproduceEnv,
): Promise<ReproduceResult> {
  const wallStart = Date.now()
  const results: EntryResult[] = []
  const deferUnsim = env.RUNTIME_DEFER === 'true'
  let deferredCount = 0

  for (const entry of entries) {
    if (Date.now() - wallStart > TOTAL_TIMEOUT_MS) {
      const timeoutResult: EntryResult = {
        cmd: entry.cmd,
        expect: entry.expect,
        claim: entry.claim,
        pass: false,
        actual_exit: -1,
        actual_stdout: '',
        detail: 'total reproduction wall time exceeded',
      }
      results.push(timeoutResult)
      return {
        verdict: 'REJECTED',
        failing_entry: timeoutResult,
        entries: results,
        wall_ms: Date.now() - wallStart,
      }
    }

    // Hermeticity check
    const hermViolation = hermeticityViolation(entry.cmd)
    if (hermViolation) {
      const r: EntryResult = {
        cmd: entry.cmd,
        expect: entry.expect,
        claim: entry.claim,
        pass: false,
        actual_exit: -1,
        actual_stdout: '',
        detail: hermViolation,
      }
      results.push(r)
      return { verdict: 'REJECTED', failing_entry: r, entries: results, wall_ms: Date.now() - wallStart }
    }

    const parsedCmd = parseCmd(entry.cmd)

    // C2.2 (flag-gated): defer unsimulatable entries to the runtime tier. A deferred
    // entry neither passes nor fails the STRUCTURAL verdict — the decoupled
    // runtime-verifier re-runs it on the real toolchain (see runtime-verdict/launch.ts).
    // Default OFF: when deferUnsim is false, the legacy 127-reject path below runs unchanged.
    if (deferUnsim && parsedCmd.type === 'unsimulatable') {
      results.push({
        cmd: entry.cmd,
        expect: entry.expect,
        claim: entry.claim,
        pass: false,
        deferred: true,
        actual_exit: 0,
        actual_stdout: '',
        detail: `deferred to runtime tier: ${parsedCmd.reason}`,
      })
      deferredCount++
      continue
    }

    let actual: CmdActual

    try {
      actual = await executeCmd(parsedCmd, work_repo, work_commit, env)
    } catch (e) {
      // Unexpected error = reject (error posture)
      actual = { exit: -1, stdout: '' }
    }

    const { pass, detail } = evaluateExpect(entry.expect, actual)

    const r: EntryResult = {
      cmd: entry.cmd,
      expect: entry.expect,
      claim: entry.claim,
      pass,
      actual_exit: actual.exit,
      actual_stdout: actual.stdout,
      detail,
    }
    results.push(r)

    if (!pass) {
      return {
        verdict: 'REJECTED',
        failing_entry: r,
        entries: results,
        wall_ms: Date.now() - wallStart,
      }
    }
  }

  // C2.2 all-deferred guardrail: a COMPLETE whose entries are ALL deferred has zero
  // structurally-verified evidence — refuse to apply (would promote unverified work).
  if (deferUnsim && deferredCount > 0 && results.length - deferredCount === 0) {
    const last = results[results.length - 1]
    return {
      verdict: 'REJECTED',
      failing_entry: {
        ...last,
        pass: false,
        detail: 'all verify_log entries deferred to runtime tier — no structurally-verified evidence; refusing to apply',
      },
      entries: results,
      deferred_count: deferredCount,
      wall_ms: Date.now() - wallStart,
    }
  }

  return { verdict: 'APPLIED', entries: results, deferred_count: deferredCount, wall_ms: Date.now() - wallStart }
}
