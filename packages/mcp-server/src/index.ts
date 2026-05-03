// packages/mcp-server/src/index.ts
// Rebuilt using McpAgent (Streamable HTTP transport) — replaces Hono JSON-RPC
import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { createEnrichedProxyCall, SKIP_ENRICHMENT, searchBrain, formatBrainContext } from "./enrich";

export interface Env {
  GITHUB_TOKEN: string;
  MCP_AUTH_TOKEN: string;
  SESSION_KV: KVNamespace;
  GITHUB_OWNER: string;
  GITHUB_REPO: string;
  GITHUB_BRANCH: string;
  MCP_OBJECT: DurableObjectNamespace;
  PROXY_URL: string;  // https://thechefos-proxy.tveg-baking.workers.dev
  SHELL_BRIDGE_URL: string; // https://n8n.thechefos.app/webhook/shell
  SHELL_BRIDGE_KEY: string; // x-shell-key value
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

// ---------- Shell Bridge helper ----------

async function shellExec(env: Env, command: string, timeoutMs = 30000): Promise<{ returncode: number; stdout: string; stderr: string }> {
  const bridgeUrl = env.SHELL_BRIDGE_URL || "https://n8n.thechefos.app/webhook/shell";
  const bridgeKey = env.SHELL_BRIDGE_KEY || "SuperDuperClaude";

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(bridgeUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-shell-key": bridgeKey,
      },
      body: JSON.stringify({ command }),
      signal: controller.signal,
    });

    clearTimeout(timer);

    if (!res.ok) {
      return { returncode: 1, stdout: "", stderr: `Shell Bridge HTTP ${res.status}` };
    }

    // n8n returns either a plain object or an array — normalise both
    // Desktop n8n: [{"stdout":"...","stderr":"...","exit":0}]
    // VPS n8n:     {"returncode":0,"stdout":"...","stderr":"..."}
    const raw = await res.json() as unknown;
    const data = (Array.isArray(raw) ? raw[0] : raw) as {
      returncode?: number;
      exit?: number;
      stdout?: string;
      stderr?: string;
    };

    return {
      returncode: data.returncode ?? data.exit ?? 0,
      stdout: data.stdout ?? "",
      stderr: data.stderr ?? "",
    };
  } catch (err: unknown) {
    clearTimeout(timer);
    const msg = err instanceof Error ? err.message : String(err);
    return { returncode: 1, stdout: "", stderr: `Shell Bridge error: ${msg}` };
  }
}

// ---------- GRAPH-INDEX section parser (Wave 1 Hunt B) ----------

/**
 * Append (or idempotently update) a row in a GRAPH-INDEX.md section.
 *
 * Sections are delimited by `## <name>` markdown headers (e.g. "## 06-meta/").
 * Data rows start with `| \`` (backtick-wrapped tier marker in column 1).
 *
 * Match logic:
 *  - exact section header (`## ${domainSection}`) — also tolerates header
 *    suffixes like "## 05-knowledge/gamedesign/ ⭐ NEW 2026-04-03" where the
 *    first whitespace-separated token equals domainSection.
 *  - row uniqueness keyed on column-2 (filename stem). Existing match → replace.
 *
 * Returns { updated, mode } on success; { error: "missing_section" } if not found.
 */
export function appendOrUpdateIndexRow(
  current: string,
  domainSection: string,
  filename: string,
  newRow: string
): { updated: string; mode: "insert" | "update" } | { error: "missing_section" } {
  const lines = current.split("\n");
  const sectionTrim = domainSection.trim();

  // Find section header
  let sectionStart = -1;
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].startsWith("## ")) continue;
    const headerName = lines[i].slice(3).trim();
    if (headerName === sectionTrim) {
      sectionStart = i;
      break;
    }
    // Tolerate decorated headers: first whitespace-separated token must match
    const firstToken = headerName.split(/\s+/)[0];
    if (firstToken === sectionTrim) {
      sectionStart = i;
      break;
    }
  }
  if (sectionStart < 0) return { error: "missing_section" };

  // Walk forward past optional blank lines + table header + separator
  // until first data row OR next section OR EOF
  let i = sectionStart + 1;
  while (i < lines.length && !lines[i].startsWith("| `") && !lines[i].startsWith("## ")) {
    i++;
  }

  if (i >= lines.length || lines[i].startsWith("## ")) {
    // Empty section (no existing data rows) — insert at this position
    lines.splice(i, 0, newRow);
    return { updated: lines.join("\n"), mode: "insert" };
  }

  // Walk through all contiguous data rows
  const dataStart = i;
  while (i < lines.length && lines[i].startsWith("| `")) {
    i++;
  }
  const dataEnd = i;

  // Check for existing row matching filename in column 2.
  // Row format: `| \`TIER\` | filename | domain | type | conns | summary |`
  const escFilename = filename.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const rowRegex = new RegExp(`^\\|\\s*\`[^\`]+\`\\s*\\|\\s*${escFilename}\\s*\\|`);
  for (let j = dataStart; j < dataEnd; j++) {
    if (rowRegex.test(lines[j])) {
      lines[j] = newRow;
      return { updated: lines.join("\n"), mode: "update" };
    }
  }

  // No existing row in this section — append after last data row
  lines.splice(dataEnd, 0, newRow);
  return { updated: lines.join("\n"), mode: "insert" };
}

// ---------- MCP Agent ----------

export class TheChefOSMCP extends McpAgent<Env> {
  server = new McpServer({
    name: "thechefos-mcp-server",
    version: "0.5.0",
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

    this.server.tool(
      "preload_context",
      "Proactively load relevant brain context before starting a task. Call this at the start of every session with your current task description to surface Tyler's prior thinking on the topic.",
      {
        query: z
          .string()
          .describe("The current task, question, or topic to search brain context for"),
      },
      async ({ query }) => {
        const results = await searchBrain(query, 3);
        if (results.length === 0) {
          return { content: [{ type: "text" as const, text: "No relevant brain context found for this query." }] };
        }
        return { content: [{ type: "text" as const, text: formatBrainContext(results) }] };
      }
    );

    // ── Brain Write Tools (Wave 1 Hunt B) ─────────────────────────────────
    // Expose the existing /api/brain/push Worker as MCP tools for OpenClaw
    // agents (and Chat-Claude). Three tools: create, update, append-index.
    // Contract locked in hunts/agent-archivist-brain-write/clue-1/COMPLETE.md.

    const BRAIN_WRITE_URL = "https://api.thechefos.app/api/brain/push";
    const BRAIN_WRITE_SECRET = "SuperDuperClaude"; // matches brain-write Worker; rotate via OPS-001

    this.server.tool(
      "brain_write_create",
      "Create a new brain/ node. Auto-prepends standard frontmatter header (Date, Domain, Tags). Returns commit SHA + URL.",
      {
        domain: z.enum([
          "00-session", "01-daily", "02-personal", "03-professional",
          "04-projects", "05-knowledge", "06-meta", "07-meta",
        ]).describe("Top-level brain/ domain folder"),
        slug: z.string().regex(/^[a-z0-9][a-z0-9-]{2,80}$/).describe("kebab-case file slug, no extension"),
        subpath: z.string().optional().describe("Optional sub-folder under domain (e.g. 'chef', 'patterns')"),
        title: z.string().min(4).max(200).describe("Human title, becomes h1 of node"),
        body: z.string().min(1).max(45000).describe("Markdown body (excluding frontmatter — tool prepends)"),
        tags: z.array(z.string()).optional().describe("Optional list of tags (joined as space-separated `Tags:` line)"),
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("ISO yyyy-mm-dd, defaults to today"),
        commit_message: z.string().min(4).max(200).describe("Git commit message"),
      },
      async ({ domain, slug, subpath, title, body, tags, date, commit_message }) => {
        const today = new Date().toISOString().slice(0, 10);
        const path = `brain/${domain}${subpath ? `/${subpath}` : ""}/${slug}.md`;
        const headerLines = [
          `# ${title}`,
          ``,
          `Date: ${date || today}`,
          `Domain: ${domain.replace(/^\d+-/, "")}`,
        ];
        if (tags && tags.length) {
          headerLines.push(`Tags: ${tags.map(t => t.startsWith("#") ? t : `#${t}`).join(" ")}`);
        }
        headerLines.push("");
        const content = headerLines.join("\n") + "\n" + body;

        const res = await fetch(BRAIN_WRITE_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-webhook-secret": BRAIN_WRITE_SECRET,
          },
          body: JSON.stringify({ path, content, message: commit_message }),
        });
        if (!res.ok) {
          const detail = await res.text();
          return { content: [{ type: "text" as const, text: JSON.stringify({ ok: false, error: `worker_${res.status}`, detail }) }] };
        }
        const data = await res.json() as { sha?: string; commit_url?: string };
        return { content: [{ type: "text" as const, text: JSON.stringify({ ok: true, path, sha: data.sha, commit_url: data.commit_url }) }] };
      }
    );

    this.server.tool(
      "brain_write_update",
      "Replace the body of an existing brain/ node. Caller responsible for preserving frontmatter if desired.",
      {
        path: z.string().describe('Full path under brain/ (e.g. "06-meta/some-node.md")'),
        body: z.string().min(1).max(45000).describe("New full content (replaces existing)"),
        commit_message: z.string().min(4).max(200),
      },
      async ({ path, body, commit_message }) => {
        let normalized = path;
        if (!normalized.startsWith("brain/")) normalized = `brain/${normalized}`;
        if (normalized.includes("..")) {
          return { content: [{ type: "text" as const, text: JSON.stringify({ ok: false, error: "validation", detail: "Path traversal not allowed" }) }] };
        }

        const res = await fetch(BRAIN_WRITE_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-webhook-secret": BRAIN_WRITE_SECRET },
          body: JSON.stringify({ path: normalized, content: body, message: commit_message }),
        });
        if (!res.ok) {
          const detail = await res.text();
          return { content: [{ type: "text" as const, text: JSON.stringify({ ok: false, error: `worker_${res.status}`, detail }) }] };
        }
        const data = await res.json() as { sha?: string; commit_url?: string };
        return { content: [{ type: "text" as const, text: JSON.stringify({ ok: true, path: normalized, sha: data.sha, commit_url: data.commit_url }) }] };
      }
    );

    this.server.tool(
      "brain_write_append_index",
      "Append (or idempotently update) a row in brain/GRAPH-INDEX.md for a node. Updates in place if a row with the same filename exists in the named section; otherwise appends after the section's last data row.",
      {
        domain_section: z.string().describe('Section heading in GRAPH-INDEX (e.g. "06-meta/")'),
        node_path: z.string().describe('Path under brain/ (e.g. "06-meta/some-node.md")'),
        title: z.string().describe("Node title (currently informational; not rendered into the row)"),
        summary: z.string().max(80).describe("Short summary, 1 line"),
        tier: z.enum(["HOT", "WARM", "COLD"]).default("HOT"),
        domain: z.string().describe('Domain tag (e.g. "meta")'),
        type: z.string().default("note").describe('Type tag (e.g. "note", "decision", "insight")'),
        commit_message: z.string().min(4).max(200),
      },
      async ({ domain_section, node_path, summary, tier, domain, type, commit_message }) => {
        let current = "";
        try {
          current = await githubGetFile(this.env, "brain/GRAPH-INDEX.md");
        } catch {
          return { content: [{ type: "text" as const, text: JSON.stringify({ ok: false, error: "graph_index_not_found" }) }] };
        }

        const filename = (node_path.split("/").pop() || "").replace(/\.md$/, "");
        if (!filename) {
          return { content: [{ type: "text" as const, text: JSON.stringify({ ok: false, error: "validation", detail: "Could not derive filename from node_path" }) }] };
        }

        const newRow = `| \`${tier}\` | ${filename} | ${domain} | ${type} | 0 | ${summary} |`;
        const result = appendOrUpdateIndexRow(current, domain_section, filename, newRow);
        if ("error" in result) {
          return { content: [{ type: "text" as const, text: JSON.stringify({ ok: false, error: result.error, detail: `Section "## ${domain_section}" not found in GRAPH-INDEX.md` }) }] };
        }

        const res = await fetch(BRAIN_WRITE_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-webhook-secret": BRAIN_WRITE_SECRET },
          body: JSON.stringify({ path: "brain/GRAPH-INDEX.md", content: result.updated, message: commit_message }),
        });
        if (!res.ok) {
          const detail = await res.text();
          return { content: [{ type: "text" as const, text: JSON.stringify({ ok: false, error: `worker_${res.status}`, detail }) }] };
        }
        const data = await res.json() as { sha?: string; commit_url?: string };
        return { content: [{ type: "text" as const, text: JSON.stringify({ ok: true, mode: result.mode, sha: data.sha, commit_url: data.commit_url }) }] };
      }
    );

    // ── Shell Bridge Tool ─────────────────────────────────────────────────
    // Proxies commands to the desktop WSL via n8n Shell Bridge.
    // Bypasses Claude's bash_tool sandbox — Worker calls n8n directly from
    // Cloudflare's network. Always prefix git/cat/grep/etc with `rtk`.

    this.server.tool(
      "shell_execute",
      "Execute a shell command on the desktop WSL via Shell Bridge. Always prefix commands with `rtk` for git/cat/grep/test/build/cargo/docker/kubectl/aws/wrangler/vercel ops. Skip rtk only for echo, mkdir, and custom scripts.",
      {
        command: z
          .string()
          .describe('Shell command to run (e.g. "rtk git status", "whoami && hostname")'),
        timeout_ms: z
          .number()
          .default(30000)
          .describe("Timeout in milliseconds (default 30s, max 120s for long builds)"),
      },
      async ({ command, timeout_ms }) => {
        const clamped = Math.min(timeout_ms ?? 30000, 120000);
        const result = await shellExec(this.env, command, clamped);

        const lines = [
          `exit: ${result.returncode}`,
          result.stdout ? `stdout:\n${result.stdout}` : "",
          result.stderr ? `stderr:\n${result.stderr}` : "",
        ].filter(Boolean).join("\n\n");

        return { content: [{ type: "text" as const, text: lines }] };
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

    // Brain-enriched proxy call — wraps proxyCall with Vectorize context
    const enriched = createEnrichedProxyCall(proxyCall);

    // Helper: use enriched or raw proxyCall based on tool name
    const callFor = (toolName: string) =>
      SKIP_ENRICHMENT.has(toolName)
        ? (service: string, op: string, params: Record<string, unknown>) =>
            proxyCall(service, op, params)
        : (service: string, op: string, params: Record<string, unknown>) =>
            enriched(toolName, service, op, params);

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
        callFor("github_get_file")("github", "get_file", { repo, path, branch })
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
        callFor("github_put_file")("github", "put_file", { repo, path, content, message, sha, branch })
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
        callFor("github_list_dir")("github", "list_dir", { repo, path, branch })
    );

    this.server.tool(
      "github_repo_tree",
      "Get full recursive file tree for a repo (useful for finding files)",
      {
        repo: z.string().describe('Repository name'),
        branch: z.string().default("main").describe("Branch name"),
      },
      async ({ repo, branch }) =>
        callFor("github_repo_tree")("github", "get_repo_tree", { repo, branch })
    );

    this.server.tool(
      "github_list_branches",
      "List branches for a repo",
      {
        repo: z.string().describe('Repository name'),
      },
      async ({ repo }) =>
        callFor("github_list_branches")("github", "list_branches", { repo })
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
        callFor("github_create_pr")("github", "create_pr", { repo, head, base, message })
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
        callFor("github_merge_branch")("github", "merge_branch", { repo, head, base, message })
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
        callFor("github_list_commits")("github", "list_commits", { repo, branch, per_page })
    );

    this.server.tool(
      "github_actions_runs",
      "Get recent GitHub Actions workflow runs",
      {
        repo: z.string().describe('Repository name'),
        per_page: z.number().default(10).describe("Number of runs to return"),
      },
      async ({ repo, per_page }) =>
        callFor("github_actions_runs")("github", "get_actions_runs", { repo, per_page })
    );

    // ── Cloudflare Tools ──────────────────────────────────────────────────

    this.server.tool(
      "cf_workers_list",
      "List all deployed Cloudflare Workers",
      {},
      async () => callFor("cf_workers_list")("cloudflare", "workers_list", {})
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
        callFor("cf_d1_query")("cloudflare", "d1_query", { database_id, sql, params })
    );

    this.server.tool(
      "cf_kv_get",
      "Read a value from a KV namespace",
      {
        namespace_id: z.string().describe("KV namespace ID"),
        key: z.string().describe("Key to read"),
      },
      async ({ namespace_id, key }) =>
        callFor("cf_kv_get")("cloudflare", "kv_get", { namespace_id, key })
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
        callFor("cf_kv_set")("cloudflare", "kv_set", { namespace_id, key, value })
    );

    this.server.tool(
      "cf_kv_list",
      "List all keys in a KV namespace",
      {
        namespace_id: z.string().describe("KV namespace ID"),
      },
      async ({ namespace_id }) =>
        callFor("cf_kv_list")("cloudflare", "kv_list", { namespace_id })
    );

    this.server.tool(
      "cf_secret_set",
      "Set or rotate a secret on any deployed Cloudflare Worker.",
      {
        script_name: z.string().describe("Worker script name"),
        secret_name: z.string().describe("Secret variable name"),
        secret_value: z.string().describe("The new secret value"),
      },
      async ({ script_name, secret_name, secret_value }) =>
        callFor("cf_secret_set")("cloudflare", "secret_set", { script_name, secret_name, secret_value })
    );

    // ── Vercel Tools ──────────────────────────────────────────────────────

    this.server.tool(
      "vercel_list_projects",
      "List all Vercel projects",
      {
        team_id: z.string().default("team_N1DyKcTkZcNw6KwBzbffimTZ").describe("Vercel team ID"),
      },
      async ({ team_id }) =>
        callFor("vercel_list_projects")("vercel", "list_projects", { team_id })
    );

    this.server.tool(
      "vercel_list_deployments",
      "List recent deployments for a project",
      {
        team_id: z.string().default("team_N1DyKcTkZcNw6KwBzbffimTZ").describe("Vercel team ID"),
        project_id: z.string().optional().describe("Filter to specific project ID"),
      },
      async ({ team_id, project_id }) =>
        callFor("vercel_list_deployments")("vercel", "list_deployments", { team_id, project_id })
    );

    this.server.tool(
      "vercel_get_deployment",
      "Get details of a specific deployment",
      {
        team_id: z.string().default("team_N1DyKcTkZcNw6KwBzbffimTZ").describe("Vercel team ID"),
        deployment_id: z.string().describe("Deployment ID"),
      },
      async ({ team_id, deployment_id }) =>
        callFor("vercel_get_deployment")("vercel", "get_deployment", { team_id, deployment_id })
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
        callFor("vercel_runtime_logs")("vercel", "get_runtime_logs", { team_id, deployment_id, since })
    );

    this.server.tool(
      "vercel_env_upsert",
      "Create or update an environment variable on a Vercel project.",
      {
        project_id: z.string().describe("Vercel project ID or slug"),
        key: z.string().describe("Environment variable name"),
        value: z.string().describe("New value"),
        target: z.array(z.enum(["production", "preview", "development"])).default(["production", "preview", "development"]),
        type: z.enum(["plain", "secret", "encrypted"]).default("plain"),
        team_id: z.string().default("team_N1DyKcTkZcNw6KwBzbffimTZ"),
      },
      async ({ project_id, key, value, target, type, team_id }) =>
        callFor("vercel_env_upsert")("vercel", "env_upsert", { project_id, key, value, target, type, team_id })
    );

    this.server.tool(
      "vercel_redeploy",
      "Trigger a production redeploy of a Vercel project from its latest deployment.",
      {
        project_id: z.string().describe("Vercel project ID or slug"),
        team_id: z.string().default("team_N1DyKcTkZcNw6KwBzbffimTZ"),
      },
      async ({ project_id, team_id }) =>
        callFor("vercel_redeploy")("vercel", "redeploy", { project_id, team_id })
    );

    // ── Calendar Tools ────────────────────────────────────────────────────

    this.server.tool(
      "calendar_list",
      "List all available Google Calendars",
      {},
      async () => callFor("calendar_list")("calendar", "list_calendars", {})
    );

    this.server.tool(
      "calendar_events",
      "List upcoming calendar events",
      {
        calendar_id: z.string().default("primary"),
        time_min: z.string().optional(),
        time_max: z.string().optional(),
        query: z.string().optional(),
      },
      async ({ calendar_id, time_min, time_max, query }) =>
        callFor("calendar_events")("calendar", "list_events", { calendar_id, time_min, time_max, query })
    );

    this.server.tool(
      "calendar_create_event",
      "Create a new calendar event",
      {
        calendar_id: z.string().default("primary"),
        summary: z.string(),
        start: z.string(),
        end: z.string(),
        description: z.string().optional(),
        location: z.string().optional(),
      },
      async ({ calendar_id, summary, start, end, description, location }) =>
        callFor("calendar_create_event")("calendar", "create_event", {
          calendar_id,
          event: { summary, start: { dateTime: start }, end: { dateTime: end }, description, location },
        })
    );

    this.server.tool(
      "calendar_free_time",
      "Find free/busy time slots",
      {
        calendar_id: z.string().default("primary"),
        time_min: z.string(),
        time_max: z.string(),
      },
      async ({ calendar_id, time_min, time_max }) =>
        callFor("calendar_free_time")("calendar", "find_free_time", { calendar_id, time_min, time_max })
    );

    // ── Gmail Tools ───────────────────────────────────────────────────────

    this.server.tool(
      "gmail_search",
      "Search Gmail messages",
      {
        q: z.string(),
        max_results: z.number().default(10),
      },
      async ({ q, max_results }) =>
        callFor("gmail_search")("gmail", "search_messages", { q, max_results })
    );

    this.server.tool(
      "gmail_read_message",
      "Read a specific Gmail message by ID",
      { message_id: z.string() },
      async ({ message_id }) =>
        callFor("gmail_read_message")("gmail", "get_message", { message_id })
    );

    this.server.tool(
      "gmail_read_thread",
      "Read a full Gmail thread by ID",
      { thread_id: z.string() },
      async ({ thread_id }) =>
        callFor("gmail_read_thread")("gmail", "get_thread", { thread_id })
    );

    this.server.tool(
      "gmail_profile",
      "Get Gmail profile info",
      {},
      async () => callFor("gmail_profile")("gmail", "get_profile", {})
    );

    // ── Val Town Tools ───────────────────────────────────────────────────────

    this.server.tool("valtown_me", "Get Val Town profile info", {}, async () => callFor("valtown_me")("valtown", "me", {}));
    this.server.tool("valtown_list_vals", "List all Val Town vals", { limit: z.number().default(20), offset: z.number().default(0) }, async ({ limit, offset }) => callFor("valtown_list_vals")("valtown", "list_vals", { limit, offset }));
    this.server.tool("valtown_create_val", "Create a new Val Town val", { name: z.string(), code: z.string(), type: z.enum(["http", "cron", "email"]).default("http"), privacy: z.enum(["public", "private", "unlisted"]).default("private"), readme: z.string().optional() }, async ({ name, code, type, privacy, readme }) => callFor("valtown_create_val")("valtown", "create_val", { name, code, type, privacy, readme }));
    this.server.tool("valtown_get_val", "Get details of a specific val", { val_id: z.string() }, async ({ val_id }) => callFor("valtown_get_val")("valtown", "get_val", { val_id }));
    this.server.tool("valtown_update_val", "Update a val's code", { val_id: z.string(), code: z.string(), type: z.enum(["http", "cron", "email"]).optional() }, async ({ val_id, code, type }) => callFor("valtown_update_val")("valtown", "update_val", { val_id, code, type }));
    this.server.tool("valtown_delete_val", "Delete a val", { val_id: z.string() }, async ({ val_id }) => callFor("valtown_delete_val")("valtown", "delete_val", { val_id }));
    this.server.tool("valtown_sqlite", "Execute SQL against Val Town SQLite", { sql: z.string(), args: z.array(z.unknown()).default([]) }, async ({ sql, args }) => callFor("valtown_sqlite")("valtown", "sqlite_execute", { sql, args }));
  }
}

// ---------- Worker entry ----------

const PUBLIC_PATHS = ["/", "/health", "/.well-known/mcp", "/sse"];

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return new Response(
        JSON.stringify({ status: "ok", worker: "thechefos-mcp-server", version: "0.5.0" }),
        { headers: { "Content-Type": "application/json" } }
      );
    }

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
