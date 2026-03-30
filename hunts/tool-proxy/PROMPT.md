# Hunt: tool-proxy
## Objective
Build a universal tool proxy into the Brain API so any project with only
ClaudeFare connected can access ALL external services on demand.
Zero dead schema weight. Tools load when called, not at session start.

## The Problem (confirmed with data today)
- 10 MCP connectors × their full schemas = loaded on EVERY message
- A session that only needed Cloudflare D1 paid for Gmail, Vercel, Calendar,
  Learning Commons, Linear, Stripe, Supabase, TurboTax schemas the whole time
- 36% burn in 75 minutes doing real infra work in Chat
- Solution: one connector (ClaudeFare), everything else proxied through Brain API

## Architecture

ClaudeFare currently exposes 5 tools:
  get_active_state, get_ops_board, get_brain_node, list_skills, get_skill

Add these proxy tools to ClaudeFare (packages/mcp-server/src/index.ts):
  proxy_github    — GitHub API operations (replaces raw token in Chat)
  proxy_cloudflare — Cloudflare Workers/D1/KV operations  
  proxy_vercel    — Vercel deployments/logs
  proxy_calendar  — Google Calendar read/write
  proxy_gmail     — Gmail search/read

Each tool takes an `operation` string and `params` object.
The Brain API routes it to the right service using stored secrets.

## Tool Registry (brain/06-meta/TOOLS-REGISTRY.md)
A new file in SuperClaude that Brain Ops reads at session start.
Lists every available tool, what it does, and its trigger phrases.
Brain Ops uses this to know what's available WITHOUT loading schemas.

## New Worker: thechefos-proxy

### packages/proxy/wrangler.toml
```toml
name = "thechefos-proxy"
main = "src/index.ts"
compatibility_date = "2026-03-01"
compatibility_flags = ["nodejs_compat"]

[vars]
GITHUB_OWNER = "AetherCreator"

# Secrets (wrangler secret put):
# GITHUB_TOKEN     — personal access token
# CF_API_TOKEN     — Cloudflare API token
# CF_ACCOUNT_ID    — Cloudflare account ID
# VERCEL_TOKEN     — Vercel API token
# VERCEL_TEAM_ID   — team_N1DyKcTkZcNw6KwBzbffimTZ
# GOOGLE_OAUTH_TOKENS — JSON blob with access/refresh tokens
```

### packages/proxy/src/index.ts
Hono Worker with these routes:

#### POST /github/:operation
Operations: get_file, put_file, list_dir, list_branches, create_pr,
            merge_branch, list_commits, get_actions_runs, get_repo_tree
Params: { repo, path, content, sha, message, branch, base, head }

#### POST /cloudflare/:operation  
Operations: workers_list, d1_query, kv_get, kv_set, kv_list,
            deploy_check, get_account
Params: { database_id, sql, namespace_id, key, value }

#### POST /vercel/:operation
Operations: list_projects, list_deployments, get_runtime_logs,
            get_deployment, check_domain
Params: { project_id, team_id, deployment_id, since, level }

#### POST /calendar/:operation
Operations: list_events, create_event, find_free_time, list_calendars
Params: { calendar_id, time_min, time_max, query, event }

#### POST /gmail/:operation
Operations: search_messages, get_message, get_profile, get_thread
Params: { q, max_results, message_id, thread_id }

All routes return { ok: true, data: <result> } or { ok: false, error: string }

### Auth
Every request to /proxy/* requires the MCP_AUTH_TOKEN header (same as MCP server).
The proxy Worker holds all external service credentials as secrets.
Never exposed in Chat context again.

## ClaudeFare Tool Additions (packages/mcp-server/src/index.ts)

Add 5 new tools that call the proxy Worker via service binding:

```ts
this.server.tool(
  "proxy_github",
  "Perform GitHub API operations — get/put files, list branches, check CI",
  {
    operation: z.string().describe(
      "Operation: get_file | put_file | list_dir | list_branches | " +
      "create_pr | merge_branch | list_commits | get_actions_runs | get_repo_tree"
    ),
    params: z.object({}).passthrough().describe(
      "Operation params: repo, path, content, sha, message, branch, base, head"
    ),
  },
  async ({ operation, params }) => {
    const res = await fetch(`${this.env.PROXY_URL}/github/${operation}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${this.env.MCP_AUTH_TOKEN}`,
      },
      body: JSON.stringify(params),
    });
    const data = await res.json();
    return { content: [{ type: "text" as const, text: JSON.stringify(data) }] };
  }
);
// Repeat pattern for proxy_cloudflare, proxy_vercel, proxy_calendar, proxy_gmail
```

### New Env fields for mcp-server:
```ts
PROXY_URL: string;      // https://thechefos-proxy.tveg-baking.workers.dev
// OR use service binding:
PROXY: Fetcher;         // service binding preferred — faster, no egress cost
```

### wrangler.toml addition for mcp-server:
```toml
[[services]]
binding = "PROXY"
service = "thechefos-proxy"
```

## Router Addition (packages/router/src/index.ts)
```ts
app.all('/api/proxy/*', (c) => forward(c.req.raw, c.env.PROXY, '/api/proxy'))
```

Also add PROXY to router Env interface and wrangler.toml services binding.

## TOOLS-REGISTRY.md (new file in SuperClaude)

Path: brain/06-meta/TOOLS-REGISTRY.md

Contents:
```markdown
# Tools Registry — SuperClaude
Brain Ops reads this at session start. Connectors not listed here are not active.
Only ClaudeFare needs to be connected in claude.ai settings.

## Always Available (ClaudeFare native)
| Tool | Function |
|------|----------|
| get_active_state | Load ACTIVE-STATE.md session context |
| get_ops_board | Load OPS-BOARD.md task board |
| get_brain_node | Read any brain/ file by path |
| list_skills | List all skills in skills/user/ |
| get_skill | Read a specific SKILL.md |

## On Demand (ClaudeFare proxy — no connector needed)
| Tool | Trigger phrases | Function |
|------|----------------|----------|
| proxy_github | "push this", "read file", "check CI", "merge" | GitHub file ops, branches, CI |
| proxy_cloudflare | "deploy", "query D1", "check workers" | CF Workers/D1/KV management |
| proxy_vercel | "check vercel", "runtime logs", "deployment" | Vercel projects/deploys/logs |
| proxy_calendar | "what's on my calendar", "schedule", "free time" | GCal read/write |
| proxy_gmail | "check email", "search gmail" | Gmail search/read |

## Removed (never connect these)
- Linear: replaced by OPS-BOARD.md
- Stripe: not in stack
- Supabase: not in stack  
- TurboTax: not in stack
- Learning Commons: not in stack
```

## deploy.yml addition
Add deploy-proxy job following same pattern as other Workers.
Secrets to set via wrangler secret put before first deploy:
- GITHUB_TOKEN (rotate from current exposed token)
- CF_API_TOKEN
- CF_ACCOUNT_ID  
- VERCEL_TOKEN
- VERCEL_TEAM_ID
- GOOGLE_OAUTH_TOKENS (JSON: { access_token, refresh_token, expiry })

## Pass Conditions
1. `POST api.thechefos.app/api/proxy/github/get_file` with
   `{ "repo": "SuperClaude", "path": "brain/OPS-BOARD.md" }` returns file content
2. `POST api.thechefos.app/api/proxy/cloudflare/workers_list` returns worker names
3. ClaudeFare tool `proxy_github` visible in claude.ai connector tool list
4. Session with ONLY ClaudeFare connected can read a file, query D1, check Vercel

## Token Note
After this hunt deploys: rotate GitHub token (OPS-001 on OPS-BOARD).
New token goes into proxy Worker secret only — never in Chat again.

## Order of Operations
1. Create packages/proxy/ directory and files
2. Add proxy tools to packages/mcp-server/src/index.ts
3. Add service binding to packages/mcp-server/wrangler.toml
4. Add router route + binding
5. Add deploy job to .github/workflows/deploy.yml
6. Create brain/06-meta/TOOLS-REGISTRY.md in SuperClaude
7. Set secrets via wrangler secret put (list provided above)
8. Deploy and verify pass conditions
