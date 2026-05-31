// runtime-verdict/handler.ts — C2.1 Phase 1 (ADVISORY) verdict sink.
//
// Receives runtime verdicts POSTed by /opt/scripts/runtime-verifier.sh (InfiniVeg),
// which shell-reproduces non-hermetic (godot/bash) verify_log entries against
// origin@work_commit, then persists them to D1 `runtime_verdicts`.
//
// Decoupled from the structural gate: this is a SEPARATE, additive verdict tier.
// It never blocks or alters COMPLETE.md promotion. Phase 1 = record only.
//
// Auth: header X-Runtime-Verify-Key, compared to RUNTIME_VERIFY_KEY (C2.2 dedicated
// secret), falling back to GITHUB_WEBHOOK_SECRET until the on-box script is rotated.
import type { Context } from 'hono'

interface RuntimeVerdictEnv {
  GITHUB_WEBHOOK_SECRET: string
  RUNTIME_VERIFY_KEY?: string
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

  // Auth — dedicated RUNTIME_VERIFY_KEY (C2.2), fallback to webhook secret pre-rotation
  const expected = env.RUNTIME_VERIFY_KEY || env.GITHUB_WEBHOOK_SECRET
  const key = c.req.header('X-Runtime-Verify-Key')
  if (!key || key !== expected) {
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

// C2.2 required-mode: read a prior runtime verdict for (hunt, clue, work_commit).
// Returns null when D1 is unbound, no row exists, or on any error (absence never blocks —
// design A is replay-driven: a fail row blocks; an absent row means first delivery, advisory).
export async function getRuntimeVerdict(
  env: { SUPERCLAUDE_BRAIN?: D1Database },
  hunt: string,
  clue: string,
  workCommit: string,
): Promise<{ all_pass: number; total: number; passed: number; failed: number } | null> {
  const db = env.SUPERCLAUDE_BRAIN
  if (!db) return null
  try {
    const row = await db
      .prepare(
        `SELECT all_pass, total, passed, failed FROM runtime_verdicts
         WHERE hunt = ? AND clue = ? AND work_commit = ? LIMIT 1`,
      )
      .bind(hunt, clue, workCommit)
      .first<{ all_pass: number; total: number; passed: number; failed: number }>()
    return row ?? null
  } catch {
    return null
  }
}
