// packages/mcp-server/src/index.ts
// Rebuilt using McpAgent (Streamable HTTP transport) — replaces Hono JSON-RPC
import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

export interface Env {
  GITHUB_TOKEN: string;
  MCP_AUTH_TOKEN: string;
  SESSION_KV: KVNamespace;
  GITHUB_OWNER: string;
  GITHUB_REPO: string;
  GITHUB_BRANCH: string;
  MCP_OBJECT: DurableObjectNamespace;
}

// ---------- GitHub helpers ----------

async function githubGetFile(env: Env, path: string): Promise<string> {
  const url = `https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/contents/${path}?ref=${env.GITHUB_BRANCH}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: "application/vnd.github.v3.raw",
      "User-Agent": "thechefos-mcp-server",
    },
  });
  if (!res.ok) throw new Error(`GitHub API error ${res.status}: ${path}`);
  return res.text();
}

interface GitHubDirEntry {
  name: string;
  type: string;
  path: string;
}

async function githubListDir(env: Env, path: string): Promise<GitHubDirEntry[]> {
  const url = `https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/contents/${path}?ref=${env.GITHUB_BRANCH}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: "application/vnd.github.v3+json",
      "User-Agent": "thechefos-mcp-server",
    },
  });
  if (!res.ok) throw new Error(`GitHub API error ${res.status}: ${path}`);
  return res.json();
}

// ---------- MCP Agent ----------

export class TheChefOSMCP extends McpAgent<Env> {
  server = new McpServer({
    name: "thechefos-mcp-server",
    version: "0.2.0",
  });

  async init() {
    this.server.tool(
      "get_active_state",
      "Returns the current ACTIVE-STATE.md session context",
      {},
      async () => {
        const content = await githubGetFile(this.env, "brain/00-session/ACTIVE-STATE.md");
        return { content: [{ type: "text" as const, text: content }] };
      }
    );

    this.server.tool(
      "get_ops_board",
      "Returns the current OPS-BOARD.md operations dashboard",
      {},
      async () => {
        const content = await githubGetFile(this.env, "brain/OPS-BOARD.md");
        return { content: [{ type: "text" as const, text: content }] };
      }
    );

    this.server.tool(
      "get_brain_node",
      "Returns any brain/ file by its path relative to brain/",
      {
        path: z
          .string()
          .describe('Path relative to brain/ directory (e.g. "04-projects/CHEFOS-STATE.md")'),
      },
      async ({ path }) => {
        if (!path || path.includes("..")) throw new Error("Invalid path");
        const content = await githubGetFile(this.env, `brain/${path}`);
        return { content: [{ type: "text" as const, text: content }] };
      }
    );

    this.server.tool(
      "list_skills",
      "Lists all user skills in skills/user/",
      {},
      async () => {
        const entries = await githubListDir(this.env, "skills/user");
        const dirs = entries.filter((e) => e.type === "dir").map((e) => e.name);
        return { content: [{ type: "text" as const, text: JSON.stringify(dirs) }] };
      }
    );

    this.server.tool(
      "get_skill",
      "Returns the SKILL.md content for a specific user skill",
      {
        skill_name: z
          .string()
          .describe('Name of the skill directory (e.g. "treasure-hunter")'),
      },
      async ({ skill_name }) => {
        if (!skill_name || skill_name.includes("..") || skill_name.includes("/")) {
          throw new Error("Invalid skill name");
        }
        const content = await githubGetFile(
          this.env,
          `skills/user/${skill_name}/SKILL.md`
        );
        return { content: [{ type: "text" as const, text: content }] };
      }
    );
  }
}

// ---------- Worker entry ----------

// Paths that McpAgent needs for discovery/negotiation — no auth required
const PUBLIC_PATHS = ["/", "/health", "/.well-known/mcp", "/sse"];

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const url = new URL(request.url);

    // Health check — always public
    if (url.pathname === "/health") {
      return new Response(
        JSON.stringify({ status: "ok", worker: "thechefos-mcp-server" }),
        { headers: { "Content-Type": "application/json" } }
      );
    }

    // OPTIONS — always allow (CORS preflight)
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization, Mcp-Session-Id",
        },
      });
    }

    // Discovery paths — allow unauthenticated so claude.ai handshake succeeds
    // McpAgent GET / and POST / (capability negotiation) must be public
    const isDiscovery = request.method === "GET" ||
      PUBLIC_PATHS.some(p => url.pathname === p || url.pathname.startsWith(p));

    if (!isDiscovery) {
      // Auth required for tool execution (POST with session established)
      const authHeader = request.headers.get("Authorization");
      const bearerToken = authHeader?.replace("Bearer ", "").trim();
      // Allow if token matches OR if Mcp-Session-Id is present (session already negotiated)
      const hasSession = request.headers.get("Mcp-Session-Id");
      if (!hasSession && (!bearerToken || bearerToken !== env.MCP_AUTH_TOKEN)) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
            "WWW-Authenticate": 'Bearer realm="thechefos-mcp-server"',
          },
        });
      }
    }

    // Route all MCP traffic to McpAgent
    // Router strips /api/mcp prefix so we serve at "/"
    // McpAgent handles Streamable HTTP (POST) + SSE (GET)
    try {
      return await TheChefOSMCP.serve("/").fetch(request, env, ctx);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.stack || err.message : String(err);
      return new Response(JSON.stringify({ error: message }), {
        status: 500,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      });
    }
  },
};
