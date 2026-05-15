import type { GuardLayerEvidence } from './types'

export interface EvidenceEnv {
  GITHUB_TOKEN: string
}

const REPO_OWNER = 'AetherCreator'
const REPO_NAME = 'SuperClaude'
const GITHUB_API = 'https://api.github.com'
const COMMITTER = {
  name: 'SuperClaude Brain Ops',
  email: 'brain-ops@thechefos.app',
}

export interface WriteEvidenceResult {
  ok: boolean
  path: string
  commit_sha?: string
  error?: string
}

export async function writeEvidence(
  env: EvidenceEnv,
  evidence: GuardLayerEvidence,
): Promise<WriteEvidenceResult> {
  const date = evidence.ts.slice(0, 10) // YYYY-MM-DD (UTC)
  const path = `brain/06-meta/auto-actions/${date}/${evidence.action_id}.json`
  const content = JSON.stringify(evidence, null, 2)
  const message = `audit: ${evidence.intent} ${evidence.action.target} → ${evidence.outcome}`

  const contentBase64 = btoa(unescape(encodeURIComponent(content)))
  const url = `${GITHUB_API}/repos/${REPO_OWNER}/${REPO_NAME}/contents/${path}`
  const headers: Record<string, string> = {
    Authorization: `Bearer ${env.GITHUB_TOKEN}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'SuperClaude-Guard-Layer',
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json',
  }

  try {
    // action_id timestamps are second-precision, so collisions on a per-action
    // basis are not expected. Treat the audit file as create-only; if it
    // already exists (idempotency-replay write), surface that distinctly.
    const res = await fetch(url, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ message, content: contentBase64, committer: COMMITTER }),
    })
    if (res.ok) {
      const data = (await res.json()) as { commit: { sha: string } }
      return { ok: true, path, commit_sha: data.commit.sha }
    }
    if (res.status === 422) {
      // GitHub returns 422 when the file already exists without a sha.
      return { ok: true, path, error: 'audit_file_already_exists' }
    }
    const detail = await res.text()
    return { ok: false, path, error: `github_${res.status}: ${detail.slice(0, 200)}` }
  } catch (e) {
    return { ok: false, path, error: String(e) }
  }
}
