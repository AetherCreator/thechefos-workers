import {
  REQUIRED_VERIFIERS,
  type ActionIntent,
  type VerifierCheck,
  type VerifierResult,
} from './types'

export interface VerifierEnv {
  GITHUB_TOKEN?: string
  IDEMPOTENCY_KEYS?: KVNamespace
  // Optional extra KV namespaces for kv_state_check by name; v1 only routes to IDEMPOTENCY_KEYS.
}

export interface VerifierRunResult {
  results: VerifierResult[]
  outcome: 'passed' | 'failed' | 'skipped' | 'n/a'
}

export async function runVerifiers(
  env: VerifierEnv,
  intent: ActionIntent,
  verifierParams: Record<string, unknown>,
): Promise<VerifierRunResult> {
  const required = REQUIRED_VERIFIERS[intent]
  if (!required || required.length === 0) {
    return { results: [], outcome: 'n/a' }
  }

  // Caller can opt out of verifier requirement per-call (e.g., ops_board_promote
  // → ACTIVE/BACKLOG transitions don't require health_probe/ci_run_check).
  if (verifierParams.__skip_verifiers === true) {
    return { results: [], outcome: 'n/a' }
  }

  const results: VerifierResult[] = []
  for (const check of required) {
    const r = await runSingleVerifier(env, check, verifierParams)
    results.push(r)
    if (!r.passed) return { results, outcome: 'failed' }
  }
  return { results, outcome: 'passed' }
}

async function runSingleVerifier(
  env: VerifierEnv,
  check: VerifierCheck,
  params: Record<string, unknown>,
): Promise<VerifierResult> {
  switch (check) {
    case 'health_probe':
      return healthProbe(params)
    case 'byte_equal_source':
      return byteEqualSource(env, params)
    case 'ci_run_check':
      return ciRunCheck(env, params)
    case 'kv_state_check':
      return kvStateCheck(env, params)
    case 'counter_increment_valid':
      return counterIncrementValid(params)
  }
}

// ─── health_probe ────────────────────────────────────────────────

export async function healthProbe(
  params: Record<string, unknown>,
): Promise<VerifierResult> {
  const ts = new Date().toISOString()
  const url = params.url as string | undefined
  const expected_status = (params.expected_status as number) ?? 200
  const expected_fields = (params.expected_fields as string[]) ?? []

  if (!url) {
    return {
      check: 'health_probe',
      expected: { status: expected_status },
      actual: { error: 'missing url param' },
      passed: false,
      ts,
      detail: 'health_probe: url param required',
    }
  }

  const t0 = Date.now()
  try {
    const r = await fetch(url, {
      method: 'GET',
      signal: AbortSignal.timeout(10_000),
    })
    const elapsed = Date.now() - t0
    let body: Record<string, unknown> = {}
    if (expected_fields.length > 0) {
      try {
        body = (await r.json()) as Record<string, unknown>
      } catch {
        body = {}
      }
    }
    const status_ok = r.status === expected_status
    const fields_present = expected_fields.filter((f) => f in body)
    const fields_ok = fields_present.length === expected_fields.length
    return {
      check: 'health_probe',
      expected: { status: expected_status, fields: expected_fields },
      actual: { status: r.status, fields_present },
      passed: status_ok && fields_ok,
      ts,
      detail: `GET ${url} → ${r.status} in ${elapsed}ms`,
    }
  } catch (e) {
    return {
      check: 'health_probe',
      expected: { status: expected_status },
      actual: { error: String(e) },
      passed: false,
      ts,
      detail: `health probe failed: ${String(e)}`,
    }
  }
}

// ─── byte_equal_source ───────────────────────────────────────────

export async function byteEqualSource(
  env: VerifierEnv,
  params: Record<string, unknown>,
): Promise<VerifierResult> {
  const ts = new Date().toISOString()
  const path = params.path as string | undefined
  const expected_sha256 = params.expected_sha256 as string | undefined
  const repo = (params.repo as string) ?? 'AetherCreator/SuperClaude'
  const ref = (params.ref as string) ?? 'main'

  if (!path || !expected_sha256) {
    return {
      check: 'byte_equal_source',
      expected: { path, expected_sha256 },
      actual: { error: 'missing required params' },
      passed: false,
      ts,
    }
  }

  try {
    const url = `https://api.github.com/repos/${repo}/contents/${path}?ref=${ref}`
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'SuperClaude-Guard-Layer',
    }
    if (env.GITHUB_TOKEN) headers.Authorization = `Bearer ${env.GITHUB_TOKEN}`
    const r = await fetch(url, { headers })
    if (!r.ok) {
      return {
        check: 'byte_equal_source',
        expected: { sha256: expected_sha256 },
        actual: { http_status: r.status },
        passed: false,
        ts,
        detail: `GitHub contents API → ${r.status}`,
      }
    }
    const data = (await r.json()) as { content?: string; encoding?: string }
    if (!data.content || data.encoding !== 'base64') {
      return {
        check: 'byte_equal_source',
        expected: { sha256: expected_sha256 },
        actual: { error: 'no base64 content' },
        passed: false,
        ts,
      }
    }
    const raw = atob(data.content.replace(/\n/g, ''))
    const bytes = new Uint8Array(raw.length)
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i)
    const hash = await crypto.subtle.digest('SHA-256', bytes)
    const hex = Array.from(new Uint8Array(hash))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
    return {
      check: 'byte_equal_source',
      expected: { sha256: expected_sha256 },
      actual: { sha256: hex },
      passed: hex === expected_sha256.toLowerCase(),
      ts,
    }
  } catch (e) {
    return {
      check: 'byte_equal_source',
      expected: { sha256: expected_sha256 },
      actual: { error: String(e) },
      passed: false,
      ts,
    }
  }
}

// ─── ci_run_check ────────────────────────────────────────────────

export async function ciRunCheck(
  env: VerifierEnv,
  params: Record<string, unknown>,
): Promise<VerifierResult> {
  const ts = new Date().toISOString()
  const repo = params.repo as string | undefined
  const commit_sha = params.commit_sha as string | undefined
  const workflow_name = params.workflow_name as string | undefined

  if (!repo || !commit_sha) {
    return {
      check: 'ci_run_check',
      expected: 'success',
      actual: { error: 'missing repo or commit_sha' },
      passed: false,
      ts,
    }
  }

  try {
    const url = `https://api.github.com/repos/${repo}/actions/runs?head_sha=${commit_sha}&per_page=100`
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'SuperClaude-Guard-Layer',
    }
    if (env.GITHUB_TOKEN) headers.Authorization = `Bearer ${env.GITHUB_TOKEN}`
    const r = await fetch(url, { headers })
    if (!r.ok) {
      return {
        check: 'ci_run_check',
        expected: 'success',
        actual: { http_status: r.status },
        passed: false,
        ts,
      }
    }
    const data = (await r.json()) as {
      workflow_runs?: Array<{
        name?: string
        status?: string
        conclusion?: string | null
      }>
    }
    const runs = (data.workflow_runs ?? []).filter((w) =>
      workflow_name ? w.name === workflow_name : true,
    )
    if (runs.length === 0) {
      return {
        check: 'ci_run_check',
        expected: 'success',
        actual: { workflow_runs: 0 },
        passed: true, // n/a — no workflows match this commit, treat as non-blocking
        ts,
        detail: 'no matching workflow runs (n/a)',
      }
    }
    const incomplete = runs.filter((w) => w.status !== 'completed')
    const failed = runs.filter(
      (w) => w.status === 'completed' && w.conclusion !== 'success',
    )
    const passed = incomplete.length === 0 && failed.length === 0
    return {
      check: 'ci_run_check',
      expected: 'success',
      actual: {
        total: runs.length,
        incomplete: incomplete.length,
        failed: failed.length,
      },
      passed,
      ts,
      detail: `${runs.length} runs, ${incomplete.length} incomplete, ${failed.length} failed`,
    }
  } catch (e) {
    return {
      check: 'ci_run_check',
      expected: 'success',
      actual: { error: String(e) },
      passed: false,
      ts,
    }
  }
}

// ─── kv_state_check ──────────────────────────────────────────────

export async function kvStateCheck(
  env: VerifierEnv,
  params: Record<string, unknown>,
): Promise<VerifierResult> {
  const ts = new Date().toISOString()
  const namespace = (params.namespace as string) ?? 'IDEMPOTENCY_KEYS'
  const key = params.key as string | undefined
  const predicate = (params.predicate as string) ?? 'exists'

  if (!key) {
    return {
      check: 'kv_state_check',
      expected: predicate,
      actual: { error: 'missing key' },
      passed: false,
      ts,
    }
  }

  // v1: only IDEMPOTENCY_KEYS routes through env directly. Future namespaces
  // can extend env shape.
  const kv = (env as unknown as Record<string, KVNamespace | undefined>)[
    namespace
  ]
  if (!kv) {
    return {
      check: 'kv_state_check',
      expected: predicate,
      actual: { error: `kv namespace not bound: ${namespace}` },
      passed: false,
      ts,
    }
  }

  try {
    const raw = await kv.get(key)
    let passed = false
    let detail = ''
    if (predicate === 'exists') {
      passed = raw !== null
      detail = `${key} ${passed ? 'exists' : 'missing'}`
    } else if (predicate.startsWith('equals:')) {
      const want = predicate.slice('equals:'.length)
      passed = raw === want
      detail = `${key} equals '${want}'? ${passed}`
    } else if (predicate.startsWith('is_object_with_field:')) {
      const field = predicate.slice('is_object_with_field:'.length)
      try {
        const obj = raw ? (JSON.parse(raw) as Record<string, unknown>) : null
        passed = obj !== null && typeof obj === 'object' && field in obj
        detail = `${key} has field '${field}'? ${passed}`
      } catch {
        passed = false
        detail = `${key} not JSON`
      }
    } else {
      return {
        check: 'kv_state_check',
        expected: predicate,
        actual: { error: 'unknown predicate' },
        passed: false,
        ts,
      }
    }
    return {
      check: 'kv_state_check',
      expected: predicate,
      actual: { value_present: raw !== null },
      passed,
      ts,
      detail,
    }
  } catch (e) {
    return {
      check: 'kv_state_check',
      expected: predicate,
      actual: { error: String(e) },
      passed: false,
      ts,
    }
  }
}

// ─── counter_increment_valid ─────────────────────────────────────

export async function counterIncrementValid(
  params: Record<string, unknown>,
): Promise<VerifierResult> {
  const ts = new Date().toISOString()
  const prior = params.expected_prior as number | undefined
  const delta = params.delta as number | undefined
  const expected_new = params.expected_new as number | undefined
  const actual_new = params.actual_new as number | undefined

  if (
    typeof prior !== 'number' ||
    typeof delta !== 'number' ||
    typeof expected_new !== 'number'
  ) {
    return {
      check: 'counter_increment_valid',
      expected: { prior, delta, new: expected_new },
      actual: { error: 'missing or non-numeric params' },
      passed: false,
      ts,
    }
  }

  const arithmetic_ok = prior + delta === expected_new
  const actual_matches =
    actual_new === undefined ? true : actual_new === expected_new
  const passed = arithmetic_ok && actual_matches
  return {
    check: 'counter_increment_valid',
    expected: { prior, delta, new: expected_new },
    actual: { prior, new: actual_new ?? expected_new },
    passed,
    ts,
    detail: `${prior} + ${delta} = ${expected_new}; arithmetic_ok=${arithmetic_ok}, actual_matches=${actual_matches}`,
  }
}
