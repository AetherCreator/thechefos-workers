// packages/proxy/src/index.ts
import { Hono } from 'hono'
import { cors } from 'hono/cors'

export interface Env {
  GITHUB_OWNER: string
  GITHUB_TOKEN: string
  CF_API_TOKEN: string
  CF_ACCOUNT_ID: string
  VERCEL_TOKEN: string
  VERCEL_TEAM_ID: string
  MCP_AUTH_TOKEN: string
  GOOGLE_OAUTH_TOKENS: string
}

const app = new Hono<{ Bindings: Env }>()

app.use('*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
}))

// Auth — Bearer token required on all non-health routes
app.use('*', async (c, next) => {
  if (c.req.method === 'OPTIONS' || c.req.path === '/health') return next()
  const auth = c.req.header('Authorization') ?? ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : ''
  if (!c.env.MCP_AUTH_TOKEN || !token || token !== c.env.MCP_AUTH_TOKEN) {
    return c.json({ ok: false, error: 'Unauthorized' }, 401)
  }
  return next()
})

app.get('/health', (c) => c.json({ ok: true, worker: 'thechefos-proxy' }))

// ── GitHub ────────────────────────────────────────────────────────────────────────────
app.post('/github/:operation', async (c) => {
  const op = c.req.param('operation')
  const params = await c.req.json<Record<string, unknown>>()

  const owner = c.env.GITHUB_OWNER
  const ghHeaders: Record<string, string> = {
    Authorization: `Bearer ${c.env.GITHUB_TOKEN}`,
    Accept: 'application/vnd.github.v3+json',
    'User-Agent': 'thechefos-proxy',
    'Content-Type': 'application/json',
  }

  try {
    let data: unknown
    const repo = params.repo as string | undefined
    const path = params.path as string | undefined
    const branch = (params.branch as string | undefined)
      || (params.ref as string | undefined)
      || 'main'

    if (op === 'get_file') {
      const res = await fetch(
        `https://api.github.com/repos/${owner}/${repo}/contents/${path}?ref=${branch}`,
        { headers: { ...ghHeaders, Accept: 'application/vnd.github.v3.raw' } },
      )
      if (!res.ok) throw new Error(`GitHub ${res.status}: ${await res.text()}`)
      data = await res.text()

    } else if (op === 'put_file') {
      const content = params.content as string | undefined
      const body: Record<string, unknown> = {
        message: (params.message as string | undefined) || 'Update via proxy',
        content: Buffer.from(content ?? '', 'utf8').toString('base64'),
      }
      if (params.sha) body.sha = params.sha
      if (params.branch) body.branch = params.branch
      const res = await fetch(
        `https://api.github.com/repos/${owner}/${repo}/contents/${path}`,
        { method: 'PUT', headers: ghHeaders, body: JSON.stringify(body) },
      )
      if (!res.ok) throw new Error(`GitHub ${res.status}: ${await res.text()}`)
      data = await res.json()

    } else if (op === 'list_dir') {
      const res = await fetch(
        `https://api.github.com/repos/${owner}/${repo}/contents/${path ?? ''}?ref=${branch}`,
        { headers: ghHeaders },
      )
      if (!res.ok) throw new Error(`GitHub ${res.status}: ${await res.text()}`)
      data = await res.json()

    } else if (op === 'list_branches') {
      const perPage = (params.per_page as number | undefined) || 30
      const res = await fetch(
        `https://api.github.com/repos/${owner}/${repo}/branches?per_page=${perPage}`,
        { headers: ghHeaders },
      )
      if (!res.ok) throw new Error(`GitHub ${res.status}: ${await res.text()}`)
      data = await res.json()

    } else if (op === 'create_pr') {
      const res = await fetch(
        `https://api.github.com/repos/${owner}/${repo}/pulls`,
        {
          method: 'POST',
          headers: ghHeaders,
          body: JSON.stringify({
            title: (params.message as string | undefined) || 'PR via proxy',
            head: params.head,
            base: (params.base as string | undefined) || 'main',
            body: '',
          }),
        },
      )
      if (!res.ok) throw new Error(`GitHub ${res.status}: ${await res.text()}`)
      data = await res.json()

    } else if (op === 'merge_branch') {
      const res = await fetch(
        `https://api.github.com/repos/${owner}/${repo}/merges`,
        {
          method: 'POST',
          headers: ghHeaders,
          body: JSON.stringify({
            base: params.base,
            head: params.head,
            commit_message: params.message,
          }),
        },
      )
      if (!res.ok) throw new Error(`GitHub ${res.status}: ${await res.text()}`)
      data = await res.json()

    } else if (op === 'list_commits') {
      const perPage = (params.per_page as number | undefined) || 20
      const res = await fetch(
        `https://api.github.com/repos/${owner}/${repo}/commits?sha=${branch}&per_page=${perPage}`,
        { headers: ghHeaders },
      )
      if (!res.ok) throw new Error(`GitHub ${res.status}: ${await res.text()}`)
      data = await res.json()

    } else if (op === 'get_actions_runs') {
      const perPage = (params.per_page as number | undefined) || 10
      const res = await fetch(
        `https://api.github.com/repos/${owner}/${repo}/actions/runs?per_page=${perPage}`,
        { headers: ghHeaders },
      )
      if (!res.ok) throw new Error(`GitHub ${res.status}: ${await res.text()}`)
      data = await res.json()

    } else if (op === 'get_repo_tree') {
      const res = await fetch(
        `https://api.github.com/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`,
        { headers: ghHeaders },
      )
      if (!res.ok) throw new Error(`GitHub ${res.status}: ${await res.text()}`)
      data = await res.json()

    } else {
      return c.json({ ok: false, error: `Unknown github operation: ${op}` }, 400)
    }

    return c.json({ ok: true, data })
  } catch (err: unknown) {
    return c.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500)
  }
})

// ── Cloudflare ───────────────────────────────────────────────────────────────────────
app.post('/cloudflare/:operation', async (c) => {
  const op = c.req.param('operation')
  const params = await c.req.json<Record<string, unknown>>()

  const accountId = c.env.CF_ACCOUNT_ID
  const cfHeaders: Record<string, string> = {
    Authorization: `Bearer ${c.env.CF_API_TOKEN}`,
    'Content-Type': 'application/json',
  }
  const base = `https://api.cloudflare.com/client/v4/accounts/${accountId}`

  try {
    let data: unknown

    if (op === 'workers_list') {
      const res = await fetch(`${base}/workers/scripts`, { headers: cfHeaders })
      if (!res.ok) throw new Error(`CF ${res.status}: ${await res.text()}`)
      data = await res.json()

    } else if (op === 'd1_query') {
      const res = await fetch(`${base}/d1/database/${params.database_id}/query`, {
        method: 'POST',
        headers: cfHeaders,
        body: JSON.stringify({ sql: params.sql, params: (params.params as unknown[]) || [] }),
      })
      if (!res.ok) throw new Error(`CF ${res.status}: ${await res.text()}`)
      data = await res.json()

    } else if (op === 'kv_get') {
      const res = await fetch(
        `${base}/storage/kv/namespaces/${params.namespace_id}/values/${params.key}`,
        { headers: cfHeaders },
      )
      if (!res.ok) throw new Error(`CF ${res.status}: ${await res.text()}`)
      data = await res.text()

    } else if (op === 'kv_set') {
      const res = await fetch(
        `${base}/storage/kv/namespaces/${params.namespace_id}/values/${params.key}`,
        {
          method: 'PUT',
          headers: { ...cfHeaders, 'Content-Type': 'text/plain' },
          body: params.value as string,
        },
      )
      if (!res.ok) throw new Error(`CF ${res.status}: ${await res.text()}`)
      data = await res.json()

    } else if (op === 'kv_list') {
      const res = await fetch(
        `${base}/storage/kv/namespaces/${params.namespace_id}/keys`,
        { headers: cfHeaders },
      )
      if (!res.ok) throw new Error(`CF ${res.status}: ${await res.text()}`)
      data = await res.json()

    } else if (op === 'deploy_check') {
      const res = await fetch(`${base}/workers/scripts`, { headers: cfHeaders })
      if (!res.ok) throw new Error(`CF ${res.status}: ${await res.text()}`)
      data = await res.json()

    } else if (op === 'get_account') {
      const res = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${accountId}`,
        { headers: cfHeaders },
      )
      if (!res.ok) throw new Error(`CF ${res.status}: ${await res.text()}`)
      data = await res.json()

    } else {
      return c.json({ ok: false, error: `Unknown cloudflare operation: ${op}` }, 400)
    }

    return c.json({ ok: true, data })
  } catch (err: unknown) {
    return c.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500)
  }
})

// ── Vercel ─────────────────────────────────────────────────────────────────────────────
app.post('/vercel/:operation', async (c) => {
  const op = c.req.param('operation')
  const params = await c.req.json<Record<string, unknown>>()

  const teamId = (params.team_id as string | undefined) || c.env.VERCEL_TEAM_ID
  const vHeaders: Record<string, string> = {
    Authorization: `Bearer ${c.env.VERCEL_TOKEN}`,
    'Content-Type': 'application/json',
  }

  try {
    let data: unknown

    if (op === 'list_projects') {
      const res = await fetch(
        `https://api.vercel.com/v9/projects?teamId=${teamId}&limit=20`,
        { headers: vHeaders },
      )
      if (!res.ok) throw new Error(`Vercel ${res.status}: ${await res.text()}`)
      data = await res.json()

    } else if (op === 'list_deployments') {
      const qs = `teamId=${teamId}${params.project_id ? `&projectId=${params.project_id}` : ''}&limit=10`
      const res = await fetch(`https://api.vercel.com/v6/deployments?${qs}`, { headers: vHeaders })
      if (!res.ok) throw new Error(`Vercel ${res.status}: ${await res.text()}`)
      data = await res.json()

    } else if (op === 'get_deployment') {
      const res = await fetch(
        `https://api.vercel.com/v13/deployments/${params.deployment_id}?teamId=${teamId}`,
        { headers: vHeaders },
      )
      if (!res.ok) throw new Error(`Vercel ${res.status}: ${await res.text()}`)
      data = await res.json()

    } else if (op === 'get_runtime_logs') {
      const since = (params.since as number | undefined) || Date.now() - 3_600_000
      const res = await fetch(
        `https://api.vercel.com/v2/deployments/${params.deployment_id}/events?teamId=${teamId}&since=${since}&limit=100`,
        { headers: vHeaders },
      )
      if (!res.ok) throw new Error(`Vercel ${res.status}: ${await res.text()}`)
      data = await res.text()

    } else if (op === 'check_domain') {
      const res = await fetch(
        `https://api.vercel.com/v5/domains/${params.domain}?teamId=${teamId}`,
        { headers: vHeaders },
      )
      if (!res.ok) throw new Error(`Vercel ${res.status}: ${await res.text()}`)
      data = await res.json()

    } else {
      return c.json({ ok: false, error: `Unknown vercel operation: ${op}` }, 400)
    }

    return c.json({ ok: true, data })
  } catch (err: unknown) {
    return c.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500)
  }
})

// ── Calendar ───────────────────────────────────────────────────────────────────────────
app.post('/calendar/:operation', async (c) => {
  const op = c.req.param('operation')
  const params = await c.req.json<Record<string, unknown>>()

  try {
    if (!c.env.GOOGLE_OAUTH_TOKENS) throw new Error('GOOGLE_OAUTH_TOKENS not configured')
    const { access_token } = JSON.parse(c.env.GOOGLE_OAUTH_TOKENS) as { access_token: string }
    const gHeaders: Record<string, string> = {
      Authorization: `Bearer ${access_token}`,
      'Content-Type': 'application/json',
    }
    const calId = encodeURIComponent((params.calendar_id as string | undefined) || 'primary')

    let data: unknown

    if (op === 'list_calendars') {
      const res = await fetch(
        'https://www.googleapis.com/calendar/v3/users/me/calendarList',
        { headers: gHeaders },
      )
      if (!res.ok) throw new Error(`Calendar ${res.status}: ${await res.text()}`)
      data = await res.json()

    } else if (op === 'list_events') {
      const qs = new URLSearchParams({
        timeMin: (params.time_min as string | undefined) || new Date().toISOString(),
        timeMax: (params.time_max as string | undefined) || new Date(Date.now() + 7 * 86_400_000).toISOString(),
        singleEvents: 'true',
        orderBy: 'startTime',
        maxResults: '20',
      })
      if (params.query) qs.set('q', params.query as string)
      const res = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/${calId}/events?${qs}`,
        { headers: gHeaders },
      )
      if (!res.ok) throw new Error(`Calendar ${res.status}: ${await res.text()}`)
      data = await res.json()

    } else if (op === 'create_event') {
      const res = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/${calId}/events`,
        { method: 'POST', headers: gHeaders, body: JSON.stringify(params.event) },
      )
      if (!res.ok) throw new Error(`Calendar ${res.status}: ${await res.text()}`)
      data = await res.json()

    } else if (op === 'find_free_time') {
      const res = await fetch('https://www.googleapis.com/calendar/v3/freeBusy', {
        method: 'POST',
        headers: gHeaders,
        body: JSON.stringify({
          timeMin: params.time_min,
          timeMax: params.time_max,
          items: [{ id: (params.calendar_id as string | undefined) || 'primary' }],
        }),
      })
      if (!res.ok) throw new Error(`Calendar ${res.status}: ${await res.text()}`)
      data = await res.json()

    } else {
      return c.json({ ok: false, error: `Unknown calendar operation: ${op}` }, 400)
    }

    return c.json({ ok: true, data })
  } catch (err: unknown) {
    return c.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500)
  }
})

// ── Gmail ─────────────────────────────────────────────────────────────────────────────
app.post('/gmail/:operation', async (c) => {
  const op = c.req.param('operation')
  const params = await c.req.json<Record<string, unknown>>()

  try {
    if (!c.env.GOOGLE_OAUTH_TOKENS) throw new Error('GOOGLE_OAUTH_TOKENS not configured')
    const { access_token } = JSON.parse(c.env.GOOGLE_OAUTH_TOKENS) as { access_token: string }
    const gHeaders: Record<string, string> = {
      Authorization: `Bearer ${access_token}`,
      'Content-Type': 'application/json',
    }

    let data: unknown

    if (op === 'search_messages') {
      const qs = new URLSearchParams({
        q: (params.q as string | undefined) || '',
        maxResults: String((params.max_results as number | undefined) || 10),
      })
      const res = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages?${qs}`,
        { headers: gHeaders },
      )
      if (!res.ok) throw new Error(`Gmail ${res.status}: ${await res.text()}`)
      data = await res.json()

    } else if (op === 'get_message') {
      const res = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${params.message_id}?format=full`,
        { headers: gHeaders },
      )
      if (!res.ok) throw new Error(`Gmail ${res.status}: ${await res.text()}`)
      data = await res.json()

    } else if (op === 'get_profile') {
      const res = await fetch(
        'https://gmail.googleapis.com/gmail/v1/users/me/profile',
        { headers: gHeaders },
      )
      if (!res.ok) throw new Error(`Gmail ${res.status}: ${await res.text()}`)
      data = await res.json()

    } else if (op === 'get_thread') {
      const res = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/threads/${params.thread_id}?format=full`,
        { headers: gHeaders },
      )
      if (!res.ok) throw new Error(`Gmail ${res.status}: ${await res.text()}`)
      data = await res.json()

    } else {
      return c.json({ ok: false, error: `Unknown gmail operation: ${op}` }, 400)
    }

    return c.json({ ok: true, data })
  } catch (err: unknown) {
    return c.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500)
  }
})

export default app
