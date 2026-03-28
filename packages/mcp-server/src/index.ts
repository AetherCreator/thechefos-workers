// packages/mcp-server/src/index.ts
import { McpAgent } from 'agents/mcp'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

export interface Env {
  GITHUB_TOKEN: string
  MCP_AUTH_TOKEN: string
  GITHUB_OWNER: string
  GITHUB_REPO: string
  GITHUB_BRANCH: string
  MCP_SERVER: DurableObjectNamespace
}

// ---------- GitHub helpers ----------

async function githubGetFile(env: Env, path: string): Promise<string> {
  const url = `https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/contents/${path}?ref=${env.GITHUB_BRANCH}`
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: 'application/vnd.github.v3.raw',
      'User-Agent': 'thechefos-mcp-server',
    },
  })
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

// ---------- McpAgent ----------

export class ChefOSMCP extends McpAgent<Env> {
  server = new McpServer({
    name: 'thechefos-mcp-server',
    version: '0.2.0',
  })

  async init() {
    this.server.tool(
      'get_active_state',
      'Returns the current ACTIVE-STATE.md session context',
      {},
      async () => {
        const text = await githubGetFile(this.env, 'brain/00-session/ACTIVE-STATE.md')
        return { content: [{ type: 'text' as const, text }] }
      },
    )

    this.server.tool(
      'get_ops_board',
      'Returns the current OPS-BOARD.md operations dashboard',
      {},
      async () => {
        const text = await githubGetFile(this.env, 'brain/OPS-BOARD.md')
        return { content: [{ type: 'text' as const, text }] }
      },
    )

    this.server.tool(
      'get_brain_node',
      'Returns any brain/ file by its path relative to brain/',
      {
        path: z
          .string()
          .describe('Path relative to brain/ directory (e.g. "04-projects/CHEFOS-STATE.md")'),
      },
      async ({ path }) => {
        if (!path || path.includes('..')) {
          throw new Error('Invalid path')
        }
        const text = await githubGetFile(this.env, `brain/${path}`)
        return { content: [{ type: 'text' as const, text }] }
      },
    )

    this.server.tool(
      'list_skills',
      'Lists all user skills in skills/user/',
      {},
      async () => {
        const entries = await githubListDir(this.env, 'skills/user')
        const dirs = entries.filter((e) => e.type === 'dir').map((e) => e.name)
        return { content: [{ type: 'text' as const, text: JSON.stringify(dirs) }] }
      },
    )

    this.server.tool(
      'get_skill',
      'Returns the SKILL.md content for a specific user skill',
      {
        skill_name: z
          .string()
          .describe('Name of the skill directory (e.g. "treasure-hunter")'),
      },
      async ({ skill_name }) => {
        if (!skill_name || skill_name.includes('..') || skill_name.includes('/')) {
          throw new Error('Invalid skill name')
        }
        const text = await githubGetFile(this.env, `skills/user/${skill_name}/SKILL.md`)
        return { content: [{ type: 'text' as const, text }] }
      },
    )
  }
}

// ---------- Export ----------

export default ChefOSMCP.serve('/mcp', {
  binding: 'MCP_SERVER',
})
