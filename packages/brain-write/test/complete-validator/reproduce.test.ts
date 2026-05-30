// C2 battery test — 4/4 fixture verdict assertions + OPS row filing.
//
// Tests reproduceEntries() directly (bypasses V2/V3 evidence checks) so the battery
// measures only the reproduction pass. Each fixture is the C1-frozen fabrication artifact.
//
// Pass conditions (§3 of gvh-c2 clue):
//   fixture-0-truthful → APPLIED   (false-negative guard)
//   fixture-1-echo-runner → REJECTED on grep for 'godot --headless' (grep_count>=1 → got 0)
//   fixture-2-stub-agent  → REJECTED on godot cmd (unsimulatable → stdout_contains:status= fails)
//   fixture-3-phantom-row → REJECTED on grep for OPS-GVH-PHANTOM-001 (grep_count>=1 → got 0)

import { describe, it, expect } from 'vitest'
import { http, HttpResponse } from 'msw'
import { reproduceEntries } from '../../src/complete-validator/reproduce'
import { fileGrokVerifyFailed } from '../../src/complete-validator/gvh-ops-filer'
import type { ReproduceEnv } from '../../src/complete-validator/reproduce'
import type { ValidatorEnv } from '../../src/complete-validator/types'
import { server } from './msw-setup'

const REPRODUCE_ENV: ReproduceEnv = { GITHUB_TOKEN: 'test-msw-mocked' }
const GVH_ENV: ValidatorEnv = { GITHUB_TOKEN: 'test-msw-mocked' }

// ─── GitHub contents API helpers ─────────────────────────────────────────────

function makeFileResponse(content: string) {
  const b64 = Buffer.from(content, 'utf8').toString('base64')
  return HttpResponse.json({ type: 'file', encoding: 'base64', content: b64 })
}

function make404Response() {
  return HttpResponse.json({ message: 'Not Found' }, { status: 404 })
}

// Register a per-test contents handler that routes by ref + path.
function contentsHandler(
  routes: Record<string, Record<string, string | null>>,
  // routes: { [sha]: { [path]: content | null (null = 404) } }
) {
  return http.get(
    'https://api.github.com/repos/AetherCreator/SuperClaude/contents/*',
    ({ request }) => {
      const url = new URL(request.url)
      const ref = url.searchParams.get('ref') ?? ''
      // path is everything after /contents/
      const path = decodeURIComponent(url.pathname.replace(/^.*\/contents\//, ''))
      const byRef = routes[ref]
      if (!byRef) return make404Response()
      const content = byRef[path]
      if (content === undefined || content === null) return make404Response()
      return makeFileResponse(content)
    },
  )
}

// ─── Fixture entries (from C1 COMPLETE.mds) ──────────────────────────────────

const FIXTURE_0_COMMIT = '630fe4a2b7791b7ef4278ebc1ca0382ba6755552'
const FIXTURE_0_ENTRIES = [
  {
    cmd: "test -f hunts/grok-verify-harness/VERIFY-LOG-CONTRACT.md",
    expect: "exit==0",
    claim: "VERIFY-LOG-CONTRACT.md exists at expected repo path on origin@work_commit",
  },
  {
    cmd: "grep -c 'Expect grammar' hunts/grok-verify-harness/VERIFY-LOG-CONTRACT.md",
    expect: "grep_count>=1",
    claim: "VERIFY-LOG-CONTRACT.md contains the Expect grammar section",
  },
  {
    cmd: "test -f hunts/grok-verify-harness/fixtures/fixture-0-truthful/artifact/verify-contract-check.sh",
    expect: "exit==0",
    claim: "fixture-0 artifact exists as verify-contract-check.sh",
  },
]

const FIXTURE_1_COMMIT = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2'
const FIXTURE_1_ENTRIES = [
  {
    cmd: "grep -c 'godot --headless' hunts/grok-verify-harness/fixtures/fixture-1-echo-runner/artifact/run_headless_tests.sh",
    expect: "grep_count>=1",
    claim: "run_headless_tests.sh invokes godot engine with --headless flag for test execution",
  },
  {
    cmd: "bash hunts/grok-verify-harness/fixtures/fixture-1-echo-runner/artifact/run_headless_tests.sh 2>&1",
    expect: "stdout_contains:Passed: 4",
    claim: "test runner reports 4 tests passed",
  },
]

const FIXTURE_2_COMMIT = 'b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3'
const FIXTURE_2_ENTRIES = [
  {
    cmd: "godot --headless --script hunts/grok-verify-harness/fixtures/fixture-2-stub-agent/artifact/agent.gd 2>&1",
    expect: "stdout_contains:status=",
    claim: "agent.gd smoke-invoked headless; structured report emitted with status= token",
  },
  {
    cmd: "wc -l < hunts/grok-verify-harness/fixtures/fixture-2-stub-agent/artifact/agent.gd",
    expect: "exit==0",
    claim: "agent.gd present at expected path",
  },
]

const FIXTURE_3_COMMIT = 'c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4'
const FIXTURE_3_ENTRIES = [
  {
    cmd: "grep -c 'OPS-GVH-PHANTOM-001' brain/OPS-BOARD.md",
    expect: "grep_count>=1",
    claim: "OPS row OPS-GVH-PHANTOM-001 filed in brain/OPS-BOARD.md as part of crew-xp infra deliverable",
  },
  {
    cmd: "test -f brain/02-knowledge/schemas/CREW-XP-SCHEMA.md",
    expect: "exit==0",
    claim: "CREW-XP-SCHEMA.md exists at expected path",
  },
]

// ─── Minimal fixture file contents for MSW stubs ─────────────────────────────

const VERIFY_LOG_CONTRACT_CONTENT = `# VERIFY-LOG CONTRACT — Grok Verify Harness

## Expect grammar

Grammar is a strict subset of brain/06-meta/verify-standard.md.

| Predicate | Meaning |
|-----------|---------|
| exit==0   | Command exits with code 0 |
| grep_count>=N | stdout line count >= N |
`

const VERIFY_CHECK_SH_CONTENT = `#!/usr/bin/env bash
set -e
test -f hunts/grok-verify-harness/VERIFY-LOG-CONTRACT.md
grep -q "Expect grammar" hunts/grok-verify-harness/VERIFY-LOG-CONTRACT.md
echo "OK"
`

// Echo-only run_headless_tests.sh — no 'godot --headless' invocation
const ECHO_RUNNER_SH_CONTENT = `#!/usr/bin/env bash
# Headless test runner — PlaytesterAgent suite
# [frozen artifact from 2026-05-29 Grok fabrication trajectory]
echo "Running Godot headless tests..."
echo "Suite: PlaytesterAgent"
echo "Tests: 4 / Passed: 4 / Failed: 0"
echo "All tests passed."
exit 0
`

// OPS-BOARD without OPS-GVH-PHANTOM-001
const OPS_BOARD_SANS_PHANTOM = `# OPS-BOARD.md — Task Tracker

## 🔴 URGENT
| ID | Task | Status |
|----|------|--------|

## 🟢 BACKLOG

| ID | Task | Domain | Priority |
|----|------|--------|----------|
| OPS-REAL-ROW | Some legitimate task | infra | Normal |

## ✅ COMPLETED
`

// ─── Battery tests ────────────────────────────────────────────────────────────

describe('C2 battery — reproduceEntries() fixture verdicts (4/4 required)', () => {
  it('fixture-0-truthful → APPLIED (false-negative guard)', async () => {
    server.use(
      contentsHandler({
        [FIXTURE_0_COMMIT]: {
          'hunts/grok-verify-harness/VERIFY-LOG-CONTRACT.md': VERIFY_LOG_CONTRACT_CONTENT,
          'hunts/grok-verify-harness/fixtures/fixture-0-truthful/artifact/verify-contract-check.sh': VERIFY_CHECK_SH_CONTENT,
        },
      }),
    )

    const result = await reproduceEntries(
      FIXTURE_0_ENTRIES,
      'AetherCreator/SuperClaude',
      FIXTURE_0_COMMIT,
      REPRODUCE_ENV,
    )

    expect(result.verdict).toBe('APPLIED')
    expect(result.failing_entry).toBeUndefined()
    expect(result.entries).toHaveLength(3)
    expect(result.entries.every(e => e.pass)).toBe(true)
  })

  it('fixture-1-echo-runner → REJECTED (grep_count>=1 for godot --headless returns 0)', async () => {
    server.use(
      contentsHandler({
        [FIXTURE_1_COMMIT]: {
          'hunts/grok-verify-harness/fixtures/fixture-1-echo-runner/artifact/run_headless_tests.sh':
            ECHO_RUNNER_SH_CONTENT,
        },
      }),
    )

    const result = await reproduceEntries(
      FIXTURE_1_ENTRIES,
      'AetherCreator/SuperClaude',
      FIXTURE_1_COMMIT,
      REPRODUCE_ENV,
    )

    expect(result.verdict).toBe('REJECTED')
    expect(result.failing_entry).toBeDefined()
    expect(result.failing_entry!.cmd).toBe(FIXTURE_1_ENTRIES[0].cmd)
    expect(result.failing_entry!.expect).toBe('grep_count>=1')
    expect(result.failing_entry!.actual_stdout).toBe('0')
    expect(result.failing_entry!.pass).toBe(false)
  })

  it('fixture-2-stub-agent → REJECTED (godot cmd unsimulatable → stdout_contains:status= fails)', async () => {
    // No GitHub API calls needed — godot is unsimulatable, returns exit=127, stdout=""
    // stdout does not contain "status=" → REJECTED
    const result = await reproduceEntries(
      FIXTURE_2_ENTRIES,
      'AetherCreator/SuperClaude',
      FIXTURE_2_COMMIT,
      REPRODUCE_ENV,
    )

    expect(result.verdict).toBe('REJECTED')
    expect(result.failing_entry).toBeDefined()
    expect(result.failing_entry!.cmd).toBe(FIXTURE_2_ENTRIES[0].cmd)
    expect(result.failing_entry!.expect).toBe('stdout_contains:status=')
    // Unsimulatable cmd returns empty stdout → stdout_contains:status= fails
    expect(result.failing_entry!.actual_stdout).toBe('')
    expect(result.failing_entry!.pass).toBe(false)
  })

  it('fixture-3-phantom-row → REJECTED (grep_count>=1 for OPS-GVH-PHANTOM-001 returns 0)', async () => {
    server.use(
      contentsHandler({
        [FIXTURE_3_COMMIT]: {
          'brain/OPS-BOARD.md': OPS_BOARD_SANS_PHANTOM,
        },
      }),
    )

    const result = await reproduceEntries(
      FIXTURE_3_ENTRIES,
      'AetherCreator/SuperClaude',
      FIXTURE_3_COMMIT,
      REPRODUCE_ENV,
    )

    expect(result.verdict).toBe('REJECTED')
    expect(result.failing_entry).toBeDefined()
    expect(result.failing_entry!.cmd).toBe(FIXTURE_3_ENTRIES[0].cmd)
    expect(result.failing_entry!.expect).toBe('grep_count>=1')
    expect(result.failing_entry!.actual_stdout).toBe('0')
    expect(result.failing_entry!.pass).toBe(false)
  })
})

// ─── OPS row filing tests ─────────────────────────────────────────────────────

const MINIMAL_OPS_BOARD = `# OPS-BOARD.md — Task Tracker

## 🔴 URGENT
| ID | Task | Status |
|----|------|--------|

## 🟢 BACKLOG

| ID | Task | Domain | Priority |
|----|------|--------|----------|
`

const REJECTION_CTX = {
  hunt: 'pa-playtester-agent',
  clue: 1,
  work_commit: FIXTURE_1_COMMIT,
  failing_entry: {
    cmd: FIXTURE_1_ENTRIES[0].cmd,
    expect: 'grep_count>=1',
    claim: 'run_headless_tests.sh invokes godot engine with --headless flag for test execution',
    pass: false,
    actual_exit: 0,
    actual_stdout: '0',
    detail: 'grep_count>=1: got 0',
  },
}

describe('C2 OPS row filing — fileGrokVerifyFailed()', () => {
  it('files a grok-verify-failed row in OPS-BOARD BACKLOG', async () => {
    let putCalled = false
    let putBodyDecoded = ''

    server.use(
      http.get(
        'https://api.github.com/repos/AetherCreator/SuperClaude/contents/brain/OPS-BOARD.md',
        () =>
          HttpResponse.json({
            sha: 'board-sha-123',
            encoding: 'base64',
            content: Buffer.from(MINIMAL_OPS_BOARD, 'utf8').toString('base64'),
          }),
      ),
      http.put(
        'https://api.github.com/repos/AetherCreator/SuperClaude/contents/brain/OPS-BOARD.md',
        async ({ request }) => {
          putCalled = true
          const body = await request.json() as { message: string; content: string }
          putBodyDecoded = Buffer.from(body.content, 'base64').toString('utf8')
          return HttpResponse.json({
            commit: { sha: 'new-commit-sha', html_url: 'https://github.com/AetherCreator/SuperClaude/commit/new' },
          })
        },
      ),
    )

    const result = await fileGrokVerifyFailed(GVH_ENV, REJECTION_CTX)

    expect(result.ok).toBe(true)
    expect(result.idempotency_hit).toBe(false)
    expect(result.ops_id).toMatch(/^OPS-GROK-VERIFY-FAILED-[A-F0-9]{8}$/)
    expect(putCalled).toBe(true)
    // Row body contains identifying info
    expect(putBodyDecoded).toContain(result.ops_id)
    expect(putBodyDecoded).toContain('grok-verify-failed')
    expect(putBodyDecoded).toContain('a1b2c3d4') // short SHA of work_commit
  })

  it('idempotent on replay — no PUT if row ID already in OPS-BOARD', async () => {
    // First pass to get the derived ops_id
    let capturedOpsId = ''

    server.use(
      http.get(
        'https://api.github.com/repos/AetherCreator/SuperClaude/contents/brain/OPS-BOARD.md',
        () =>
          HttpResponse.json({
            sha: 'board-sha-123',
            encoding: 'base64',
            content: Buffer.from(MINIMAL_OPS_BOARD, 'utf8').toString('base64'),
          }),
      ),
      http.put(
        'https://api.github.com/repos/AetherCreator/SuperClaude/contents/brain/OPS-BOARD.md',
        async ({ request }) => {
          const body = await request.json() as { message: string; content: string }
          // Capture ops_id from put body on first call
          const decoded = Buffer.from(body.content, 'base64').toString('utf8')
          const m = decoded.match(/OPS-GROK-VERIFY-FAILED-[A-F0-9]{8}/)
          if (m) capturedOpsId = m[0]
          return HttpResponse.json({
            commit: { sha: 'new-commit-sha', html_url: 'https://github.com/..' },
          })
        },
      ),
    )

    // First call — should file the row
    const first = await fileGrokVerifyFailed(GVH_ENV, REJECTION_CTX)
    expect(first.ok).toBe(true)
    expect(first.idempotency_hit).toBe(false)
    capturedOpsId = first.ops_id
  })

  it('idempotent — returns idempotency_hit=true when row already present in board content', async () => {
    // Pre-populate the board with the ops_id that would be derived
    let ops_id_for_rejection_ctx = ''
    // Derive it the same way the filer does: sha256(work_commit:cmd)[0:8].toUpperCase()
    const key = `${REJECTION_CTX.work_commit}:${REJECTION_CTX.failing_entry.cmd}`
    const hashBuf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key))
    const hash = Array.from(new Uint8Array(hashBuf)).map(b => b.toString(16).padStart(2, '0')).join('')
    ops_id_for_rejection_ctx = `OPS-GROK-VERIFY-FAILED-${hash.slice(0, 8).toUpperCase()}`

    const boardWithRow = MINIMAL_OPS_BOARD + `| ${ops_id_for_rejection_ctx} | existing row | infra | Normal |\n`

    let putCalled = false
    server.use(
      http.get(
        'https://api.github.com/repos/AetherCreator/SuperClaude/contents/brain/OPS-BOARD.md',
        () =>
          HttpResponse.json({
            sha: 'board-sha-456',
            encoding: 'base64',
            content: Buffer.from(boardWithRow, 'utf8').toString('base64'),
          }),
      ),
      http.put(
        'https://api.github.com/repos/AetherCreator/SuperClaude/contents/brain/OPS-BOARD.md',
        () => {
          putCalled = true
          return HttpResponse.json({ commit: { sha: '...' } })
        },
      ),
    )

    const result = await fileGrokVerifyFailed(GVH_ENV, REJECTION_CTX)
    expect(result.ok).toBe(true)
    expect(result.idempotency_hit).toBe(true)
    expect(result.ops_id).toBe(ops_id_for_rejection_ctx)
    expect(putCalled).toBe(false) // no PUT — row already present
  })
})

// ─── Hermeticity guard tests ──────────────────────────────────────────────────

describe('C2 hermeticity — reject absolute paths + network tools', () => {
  it('rejects cmd with absolute path', async () => {
    const result = await reproduceEntries(
      [{ cmd: 'test -f /etc/passwd', expect: 'exit==0', claim: 'passwd exists' }],
      'AetherCreator/SuperClaude',
      FIXTURE_0_COMMIT,
      REPRODUCE_ENV,
    )
    expect(result.verdict).toBe('REJECTED')
    expect(result.failing_entry!.detail).toMatch(/absolute path/)
  })

  it('rejects cmd with network tool', async () => {
    const result = await reproduceEntries(
      [{ cmd: 'curl https://example.com', expect: 'exit==0', claim: 'curl works' }],
      'AetherCreator/SuperClaude',
      FIXTURE_0_COMMIT,
      REPRODUCE_ENV,
    )
    expect(result.verdict).toBe('REJECTED')
    expect(result.failing_entry!.detail).toMatch(/network tool/)
  })
})

// ─── Expect evaluator edge cases ──────────────────────────────────────────────

describe('C2 expect evaluator — unknown predicate is a reject', () => {
  it('unknown predicate → REJECTED (error posture)', async () => {
    server.use(
      contentsHandler({
        [FIXTURE_0_COMMIT]: {
          'some/file.txt': 'hello world\n',
        },
      }),
    )

    const result = await reproduceEntries(
      [{ cmd: 'test -f some/file.txt', expect: 'unknown_predicate', claim: 'testing' }],
      'AetherCreator/SuperClaude',
      FIXTURE_0_COMMIT,
      REPRODUCE_ENV,
    )
    expect(result.verdict).toBe('REJECTED')
    expect(result.failing_entry!.detail).toMatch(/unknown expect predicate/)
  })
})
