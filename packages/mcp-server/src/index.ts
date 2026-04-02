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
  PROXY_URL: string;  // https://thechefos-proxy.tveg-baking.workers.dev
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

    // ---------- Proxy tools ----------

    const proxyCall = async (
      service: string,
      operation: string,
      params: Record<string, unknown>,
    ) => {
      const res = await fetch(`${this.env.PROXY_URL}/${service}/${operation}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${this.env.MCP_AUTH_TOKEN}`,
        },
        body: JSON.stringify(params),
      });
      const data = await res.json();
      return { content: [{ type: "text" as const, text: JSON.stringify(data) }] };
    };

    // ── GitHub Tools ──────────────────────────────────────────────────────

    this.server.tool(
      "github_get_file",
      "Read a file from any AetherCreator GitHub repo",
      {
        repo: z.string().describe('Repository name (e.g. "SuperClaude", "chefos")'),
        path: z.string().describe('File path (e.g. "brain/GRAPH-INDEX.md")'),
        branch: z.string().default("main").describe("Branch name"),
      },
      async ({ repo, path, branch }) =>
        proxyCall("github", "get_file", { repo, path, branch })
    );

    this.server.tool(
      "github_put_file",
      "Create or update a file in any AetherCreator GitHub repo. For updates, provide sha of current file.",
      {
        repo: z.string().describe('Repository name (e.g. "SuperClaude", "chefos")'),
        path: z.string().describe('File path (e.g. "skills/user/reflexion/SKILL.md")'),
        content: z.string().describe("Full file content (plain text — proxy handles base64)"),
        message: z.string().describe("Commit message"),
        sha: z.string().optional().describe("Current file SHA (required for updates, omit for new files)"),
        branch: z.string().default("main").describe("Target branch"),
      },
      async ({ repo, path, content, message, sha, branch }) =>
        proxyCall("github", "put_file", { repo, path, content, message, sha, branch })
    );

    this.server.tool(
      "github_list_dir",
      "List files in a directory of any AetherCreator GitHub repo",
      {
        repo: z.string().describe('Repository name (e.g. "SuperClaude")'),
        path: z.string().default("").describe('Directory path (e.g. "brain/01-chef")'),
        branch: z.string().default("main").describe("Branch name"),
      },
      async ({ repo, path, branch }) =>
        proxyCall("github", "list_dir", { repo, path, branch })
    );

    this.server.tool(
      "github_repo_tree",
      "Get full recursive file tree for a repo (useful for finding files)",
      {
        repo: z.string().describe('Repository name'),
        branch: z.string().default("main").describe("Branch name"),
      },
      async ({ repo, branch }) =>
        proxyCall("github", "get_repo_tree", { repo, branch })
    );

    this.server.tool(
      "github_list_branches",
      "List branches for a repo",
      {
        repo: z.string().describe('Repository name'),
      },
      async ({ repo }) =>
        proxyCall("github", "list_branches", { repo })
    );

    this.server.tool(
      "github_create_pr",
      "Create a pull request",
      {
        repo: z.string().describe('Repository name'),
        head: z.string().describe("Source branch"),
        base: z.string().default("main").describe("Target branch"),
        message: z.string().describe("PR title"),
      },
      async ({ repo, head, base, message }) =>
        proxyCall("github", "create_pr", { repo, head, base, message })
    );

    this.server.tool(
      "github_merge_branch",
      "Merge one branch into another",
      {
        repo: z.string().describe('Repository name'),
        head: z.string().describe("Branch to merge from"),
        base: z.string().describe("Branch to merge into"),
        message: z.string().describe("Merge commit message"),
      },
      async ({ repo, head, base, message }) =>
        proxyCall("github", "merge_branch", { repo, head, base, message })
    );

    this.server.tool(
      "github_list_commits",
      "List recent commits on a branch",
      {
        repo: z.string().describe('Repository name'),
        branch: z.string().default("main").describe("Branch name"),
        per_page: z.number().default(20).describe("Number of commits to return"),
      },
      async ({ repo, branch, per_page }) =>
        proxyCall("github", "list_commits", { repo, branch, per_page })
    );

    this.server.tool(
      "github_actions_runs",
      "Get recent GitHub Actions workflow runs",
      {
        repo: z.string().describe('Repository name'),
        per_page: z.number().default(10).describe("Number of runs to return"),
      },
      async ({ repo, per_page }) =>
        proxyCall("github", "get_actions_runs", { repo, per_page })
    );

    // ── Cloudflare Tools ──────────────────────────────────────────────────

    this.server.tool(
      "cf_workers_list",
      "List all deployed Cloudflare Workers",
      {},
      async () => proxyCall("cloudflare", "workers_list", {})
    );

    this.server.tool(
      "cf_d1_query",
      "Run a SQL query against a D1 database",
      {
        database_id: z.string().describe("D1 database UUID"),
        sql: z.string().describe("SQL query to execute"),
        params: z.array(z.unknown()).default([]).describe("Query parameters"),
      },
      async ({ database_id, sql, params }) =>
        proxyCall("cloudflare", "d1_query", { database_id, sql, params })
    );

    this.server.tool(
      "cf_kv_get",
      "Read a value from a KV namespace",
      {
        namespace_id: z.string().describe("KV namespace ID"),
        key: z.string().describe("Key to read"),
      },
      async ({ namespace_id, key }) =>
        proxyCall("cloudflare", "kv_get", { namespace_id, key })
    );

    this.server.tool(
      "cf_kv_set",
      "Write a value to a KV namespace",
      {
        namespace_id: z.string().describe("KV namespace ID"),
        key: z.string().describe("Key to write"),
        value: z.string().describe("Value to store"),
      },
      async ({ namespace_id, key, value }) =>
        proxyCall("cloudflare", "kv_set", { namespace_id, key, value })
    );

    this.server.tool(
      "cf_kv_list",
      "List all keys in a KV namespace",
      {
        namespace_id: z.string().describe("KV namespace ID"),
      },
      async ({ namespace_id }) =>
        proxyCall("cloudflare", "kv_list", { namespace_id })
    );

    // ── Vercel Tools ──────────────────────────────────────────────────────

    this.server.tool(
      "vercel_list_projects",
      "List all Vercel projects",
      {
        team_id: z.string().default("team_N1DyKcTkZcNw6KwBzbffimTZ").describe("Vercel team ID"),
      },
      async ({ team_id }) =>
        proxyCall("vercel", "list_projects", { team_id })
    );

    this.server.tool(
      "vercel_list_deployments",
      "List recent deployments for a project",
      {
        team_id: z.string().default("team_N1DyKcTkZcNw6KwBzbffimTZ").describe("Vercel team ID"),
        project_id: z.string().optional().describe("Filter to specific project ID"),
      },
      async ({ team_id, project_id }) =>
        proxyCall("vercel", "list_deployments", { team_id, project_id })
    );

    this.server.tool(
      "vercel_get_deployment",
      "Get details of a specific deployment",
      {
        team_id: z.string().default("team_N1DyKcTkZcNw6KwBzbffimTZ").describe("Vercel team ID"),
        deployment_id: z.string().describe("Deployment ID"),
      },
      async ({ team_id, deployment_id }) =>
        proxyCall("vercel", "get_deployment", { team_id, deployment_id })
    );

    this.server.tool(
      "vercel_runtime_logs",
      "Get runtime logs for a deployment",
      {
        team_id: z.string().default("team_N1DyKcTkZcNw6KwBzbffimTZ").describe("Vercel team ID"),
        deployment_id: z.string().describe("Deployment ID"),
        since: z.number().optional().describe("Unix timestamp — defaults to last hour"),
      },
      async ({ team_id, deployment_id, since }) =>
        proxyCall("vercel", "get_runtime_logs", { team_id, deployment_id, since })
    );

    // ── Calendar Tools ────────────────────────────────────────────────────

    this.server.tool(
      "calendar_list",
      "List all available Google Calendars",
      {},
      async () => proxyCall("calendar", "list_calendars", {})
    );

    this.server.tool(
      "calendar_events",
      "List upcoming calendar events",
      {
        calendar_id: z.string().default("primary").describe("Calendar ID"),
        time_min: z.string().optional().describe("Start time (ISO 8601) — defaults to now"),
        time_max: z.string().optional().describe("End time (ISO 8601) — defaults to 7 days from now"),
        query: z.string().optional().describe("Search query to filter events"),
      },
      async ({ calendar_id, time_min, time_max, query }) =>
        proxyCall("calendar", "list_events", { calendar_id, time_min, time_max, query })
    );

    this.server.tool(
      "calendar_create_event",
      "Create a new calendar event",
      {
        calendar_id: z.string().default("primary").describe("Calendar ID"),
        summary: z.string().describe("Event title"),
        start: z.string().describe("Start time (ISO 8601)"),
        end: z.string().describe("End time (ISO 8601)"),
        description: z.string().optional().describe("Event description"),
        location: z.string().optional().describe("Event location"),
      },
      async ({ calendar_id, summary, start, end, description, location }) =>
        proxyCall("calendar", "create_event", {
          calendar_id,
          event: {
            summary,
            start: { dateTime: start },
            end: { dateTime: end },
            description,
            location,
          },
        })
    );

    this.server.tool(
      "calendar_free_time",
      "Find free/busy time slots",
      {
        calendar_id: z.string().default("primary").describe("Calendar ID"),
        time_min: z.string().describe("Start of range (ISO 8601)"),
        time_max: z.string().describe("End of range (ISO 8601)"),
      },
      async ({ calendar_id, time_min, time_max }) =>
        proxyCall("calendar", "find_free_time", { calendar_id, time_min, time_max })
    );

    // ── Gmail Tools ───────────────────────────────────────────────────────

    this.server.tool(
      "gmail_search",
      "Search Gmail messages",
      {
        q: z.string().describe('Gmail search query (e.g. "from:boss subject:review")'),
        max_results: z.number().default(10).describe("Number of results"),
      },
      async ({ q, max_results }) =>
        proxyCall("gmail", "search_messages", { q, max_results })
    );

    this.server.tool(
      "gmail_read_message",
      "Read a specific Gmail message by ID",
      {
        message_id: z.string().describe("Gmail message ID"),
      },
      async ({ message_id }) =>
        proxyCall("gmail", "get_message", { message_id })
    );

    this.server.tool(
      "gmail_read_thread",
      "Read a full Gmail thread by ID",
      {
        thread_id: z.string().describe("Gmail thread ID"),
      },
      async ({ thread_id }) =>
        proxyCall("gmail", "get_thread", { thread_id })
    );

    this.server.tool(
      "gmail_profile",
      "Get Gmail profile info (email address, messages total)",
      {},
      async () => proxyCall("gmail", "get_profile", {})
    );

    // ── Val Town Tools ───────────────────────────────────────────────────────

    this.server.tool(
      "valtown_me",
      "Get Val Town profile info",
      {},
      async () => proxyCall("valtown", "me", {})
    );

    this.server.tool(
      "valtown_list_vals",
      "List all Val Town vals",
      {
        limit: z.number().default(20).describe("Number of vals to return"),
        offset: z.number().default(0).describe("Pagination offset"),
      },
      async ({ limit, offset }) =>
        proxyCall("valtown", "list_vals", { limit, offset })
    );

    this.server.tool(
      "valtown_create_val",
      "Create a new Val Town val (serverless function)",
      {
        name: z.string().describe("Val name (e.g. 'brainHealthPulse')"),
        code: z.string().describe("Full TypeScript code for the val"),
        type: z.enum(["http", "cron", "email"]).default("http").describe("Trigger type"),
        privacy: z.enum(["public", "private", "unlisted"]).default("private").describe("Privacy setting"),
        readme: z.string().optional().describe("Optional README/description"),
      },
      async ({ name, code, type, privacy, readme }) =>
        proxyCall("valtown", "create_val", { name, code, type, privacy, readme })
    );

    this.server.tool(
      "valtown_get_val",
      "Get details of a specific val",
      {
        val_id: z.string().describe("Val UUID"),
      },
      async ({ val_id }) =>
        proxyCall("valtown", "get_val", { val_id })
    );

    this.server.tool(
      "valtown_update_val",
      "Update a val's code (creates new version)",
      {
        val_id: z.string().describe("Val UUID"),
        code: z.string().describe("Updated TypeScript code"),
        type: z.enum(["http", "cron", "email"]).optional().describe("Change trigger type"),
      },
      async ({ val_id, code, type }) =>
        proxyCall("valtown", "update_val", { val_id, code, type })
    );

    this.server.tool(
      "valtown_delete_val",
      "Delete a val",
      {
        val_id: z.string().describe("Val UUID"),
      },
      async ({ val_id }) =>
        proxyCall("valtown", "delete_val", { val_id })
    );

    this.server.tool(
      "valtown_sqlite",
      "Execute SQL against Val Town's built-in SQLite database",
      {
        sql: z.string().describe("SQL statement to execute"),
        args: z.array(z.unknown()).default([]).describe("Query parameters"),
      },
      async ({ sql, args }) =>
        proxyCall("valtown", "sqlite_execute", { sql, args })
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
    const isDiscovery = request.method === "GET" ||
      PUBLIC_PATHS.some(p => url.pathname === p || url.pathname.startsWith(p));

    if (!isDiscovery) {
      const authHeader = request.headers.get("Authorization");
      const bearerToken = authHeader?.replace("Bearer ", "").trim();
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
