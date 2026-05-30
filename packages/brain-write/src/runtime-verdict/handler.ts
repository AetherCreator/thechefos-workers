// runtime-verdict/handler.ts — C2.1 Phase 1 (ADVISORY) verdict sink.
//
// Receives runtime verdicts POSTed by /opt/scripts/runtime-verifier.sh (InfiniVeg),
// which shell-reproduces non-hermetic (godot/bash) verify_log entries against
// origin@work_commit, then persists them to D1 `runtime_verdicts`.
//
// Decoupled from the structural gate: this is a SEPARATE, additive verdict tier.
// It never blocks or alters COMPLETE.md promotion. Phase 1 = record only.
//
// Auth: shared key via header X-Runtime-Verify-Key, compared to GITHUB_WEBHOOK_SECRET.
// TODO(C2.2): mint a dedicated RUNTIME_VERIFY_KEY secret rather than reusing the
//             webhook HMAC secret as a bearer token.
import type { Context } from 'hono'

interface RuntimeVerdictEnv {
  GITHUB_WEBHOOK_SECRET: string
  SUPERCLAUDE_BRAIN?: D1Database
}

interface RuntimeVerdictBody {
  hunt?: string
  clue?: string | number
  work_repo?: string
  work_commit?: string
  total?: number
  passed?: number
  failed?: number
  all_pass?: boolean
  ran_at?: string
  entries?: unknown
}

export async function handleRuntimeVerdict(c: Context): Promise<Response> {
  const env = c.env as RuntimeVerdictEnv

  // Auth
  const key = c.req.header('X-Runtime-Verify-Key')
  if (!key || key !== env.GITHUB_WEBHOOK_SECRET) {
    return c.json({ ok: false, error: 'unauthorized' }, 401)
  }

  const db = env.SUPERCLAUDE_BRAIN
  if (!db) {
    return c.json({ ok: false, error: 'D1 unbound (SUPERCLAUDE_BRAIN)' }, 503)
  }

  let body: RuntimeVerdictBody
  try {
    body = (await c.req.json()) as RuntimeVerdictBody
  } catch {
    return c.json({ ok: false, error: 'invalid JSON body' }, 400)
  }

  const hunt = String(body.hunt ?? '').trim()
  const clue = String(body.clue ?? '').trim()
  const workCommit = String(body.work_commit ?? '').trim()
  if (!hunt || !clue || !workCommit) {
    return c.json({ ok: false, error: 'missing hunt/clue/work_commit' }, 400)
  }

  const workRepo = body.work_repo ? String(body.work_repo) : null
  const total = Number.isFinite(body.total) ? Number(body.total) : 0
  const passed = Number.isFinite(body.passed) ? Number(body.passed) : 0
  const failed = Number.isFinite(body.failed) ? Number(body.failed) : 0
  const allPass = body.all_pass === true ? 1 : 0
  const createdAt =
    body.ran_at && String(body.ran_at).trim() ? String(body.ran_at).trim() : new Date().toISOString()
  const verdictJson = JSON.stringify(body)

  try {
    await db
      .prepare(
        `INSERT INTO runtime_verdicts
           (hunt, clue, work_repo, work_commit, all_pass, total, passed, failed, verdict_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(hunt, clue, work_commit) DO UPDATE SET
           all_pass=excluded.all_pass, total=excluded.total, passed=excluded.passed,
           failed=excluded.failed, verdict_json=excluded.verdict_json, created_at=excluded.created_at`,
      )
      .bind(hunt, clue, workRepo, workCommit, allPass, total, passed, failed, verdictJson, createdAt)
      .run()
  } catch (e) {
    return c.json({ ok: false, error: `d1_write_failed: ${(e as Error).message}` }, 500)
  }

  return c.json({
    ok: true,
    stored: { hunt, clue, work_commit: workCommit, all_pass: allPass === 1, total, passed, failed },
  })
}
