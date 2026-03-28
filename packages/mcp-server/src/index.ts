// packages/mcp-server/src/index.ts
import { Hono } from 'hono'

export interface Env {
  GITHUB_TOKEN: string
  MCP_AUTH_TOKEN: string
  GITHUB_OWNER: string
  GITHUB_REPO: string
  GITHUB_BRANCH: string
}

const app = new Hono<{ Bindings: Env }>()

// ---------- GitHub helpers ----------

async function githubFetch(env: Env, path: string): Promise<Response> {
  const url = `https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/contents/${path}?ref=${env.GITHUB_BRANCH}`
  return fetch(url, {
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: 'application/vnd.github.v3.raw',
      'User-Agent': 'thechefos-mcp-server',
    },
  })
}

async function githubGetFile(env: Env, path: string): Promise<string> {
  const res = await githubFetch(env, path)
  if (!res.ok) {
    throw new Error(`GitHub API error ${res.status}: ${path}`)
  }
  return res.text()
}

interface GitHubDirEntry {
  name: string
  type: string
  path: string
}

async function githubListDir(env: Env, path: string): Promise<GitHubDirEntry[]> {
  const url = `https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/contents/${path}?ref=${env.GITHUB_BRANCH}`
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: 'application/vnd.github.v3+json',
      'User-Agent': 'thechefos-mcp-server',
    },
  })
  if (!res.ok) {
    throw new Error(`GitHub API error ${res.status}: ${path}`)
  }
  return res.json()
}

// ---------- MCP Tool definitions ----------

const MCP_TOOLS = [
  {
    name: 'get_active_state',
    description: 'Returns the current ACTIVE-STATE.md session context',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'get_ops_board',
    description: 'Returns the current OPS-BOARD.md operations dashboard',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'get_brain_node',
    description: 'Returns any brain/ file by its path relative to brain/',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Path relative to brain/ directory (e.g. "04-projects/CHEFOS-STATE.md")',
        },
      },
      required: ['path'],
    },
  },
  {
    name: 'list_skills',
    description: 'Lists all user skills in skills/user/',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'get_skill',
    description: 'Returns the SKILL.md content for a specific user skill',
    inputSchema: {
      type: 'object',
      properties: {
        skill_name: {
          type: 'string',
          description: 'Name of the skill directory (e.g. "treasure-hunter")',
        },
      },
      required: ['skill_name'],
    },
  },
]

// ---------- MCP Tool execution ----------

async function executeTool(env: Env, name: string, args: Record<string, unknown>): Promise<string> {
  switch (name) {
    case 'get_active_state':
      return githubGetFile(env, 'brain/00-session/ACTIVE-STATE.md')

    case 'get_ops_board':
      return githubGetFile(env, 'brain/OPS-BOARD.md')

    case 'get_brain_node': {
      const path = args.path as string
      if (!path || path.includes('..')) {
        throw new Error('Invalid path')
      }
      return githubGetFile(env, `brain/${path}`)
    }

    case 'list_skills': {
      const entries = await githubListDir(env, 'skills/user')
      const dirs = entries.filter((e) => e.type === 'dir').map((e) => e.name)
      return JSON.stringify(dirs)
    }

    case 'get_skill': {
      const skillName = args.skill_name as string
      if (!skillName || skillName.includes('..') || skillName.includes('/')) {
        throw new Error('Invalid skill name')
      }
      return githubGetFile(env, `skills/user/${skillName}/SKILL.md`)
    }

    default:
      throw new Error(`Unknown tool: ${name}`)
  }
}

// ---------- JSON-RPC 2.0 handler ----------

interface JsonRpcRequest {
  jsonrpc: string
  id?: string | number | null
  method: string
  params?: Record<string, unknown>
}

function jsonRpcResponse(id: string | number | null | undefined, result: unknown) {
  return { jsonrpc: '2.0', id: id ?? null, result }
}

function jsonRpcError(id: string | number | null | undefined, code: number, message: string) {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message } }
}

async function handleRpc(env: Env, req: JsonRpcRequest) {
  switch (req.method) {
    case 'initialize':
      return jsonRpcResponse(req.id, {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: {
          name: 'thechefos-mcp-server',
          version: '0.1.0',
        },
      })

    case 'tools/list':
      return jsonRpcResponse(req.id, { tools: MCP_TOOLS })

    case 'tools/call': {
      const params = req.params ?? {}
      const toolName = params.name as string
      const toolArgs = (params.arguments ?? {}) as Record<string, unknown>

      try {
        const content = await executeTool(env, toolName, toolArgs)
        return jsonRpcResponse(req.id, {
          content: [{ type: 'text', text: content }],
        })
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error'
        return jsonRpcResponse(req.id, {
          content: [{ type: 'text', text: `Error: ${message}` }],
          isError: true,
        })
      }
    }

    case 'notifications/initialized':
      // Client notification — no response needed
      return null

    default:
      return jsonRpcError(req.id, -32601, `Method not found: ${req.method}`)
  }
}

// ---------- Auth middleware ----------

app.use('*', async (c, next) => {
  // Allow health check without auth
  if (c.req.path === '/health') return next()

  const authHeader = c.req.header('Authorization')
  const token = authHeader?.replace('Bearer ', '')

  if (!token || token !== c.env.MCP_AUTH_TOKEN) {
    return c.json({ error: 'Unauthorized' }, 401)
  }

  await next()
})

// ---------- Routes ----------

app.get('/health', (c) => c.json({ status: 'ok', worker: 'thechefos-mcp-server' }))

// MCP JSON-RPC endpoint
app.post('/', async (c) => {
  const body = await c.req.json<JsonRpcRequest>()

  if (body.jsonrpc !== '2.0' || !body.method) {
    return c.json(jsonRpcError(body.id, -32600, 'Invalid JSON-RPC request'), 400)
  }

  const result = await handleRpc(c.env, body)

  // Notifications don't get responses
  if (result === null) {
    return c.json({}, 204)
  }

  return c.json(result)
})

// MCP also responds on /mcp for clarity
app.post('/mcp', async (c) => {
  const body = await c.req.json<JsonRpcRequest>()

  if (body.jsonrpc !== '2.0' || !body.method) {
    return c.json(jsonRpcError(body.id, -32600, 'Invalid JSON-RPC request'), 400)
  }

  const result = await handleRpc(c.env, body)

  if (result === null) {
    return c.json({}, 204)
  }

  return c.json(result)
})

export default app
