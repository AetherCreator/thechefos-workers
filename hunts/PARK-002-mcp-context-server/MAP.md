# Hunt: PARK-002 — MCP Context Server
Goal: A Model Context Protocol server at thechefos.com/api/mcp that Claude Chat can connect to as a custom connector. At session start, Claude loads full context automatically — no token required.
Repo: AetherCreator/thechefos-workers
Branch: feature/park-workers

## What this unlocks
Right now every Brain Ops session requires Tyler to paste a GitHub token and Claude manually fetches ACTIVE-STATE.md and OPS-BOARD.md. With this MCP server live:
- Tyler adds thechefos.com/api/mcp as a custom connector in Claude settings
- Every session automatically loads full SuperClaude context
- No token. No manual fetch. Just opens and knows everything.

## MCP Tools to Expose
- get_active_state — returns ACTIVE-STATE.md content
- get_ops_board — returns OPS-BOARD.md content  
- get_brain_node — returns any brain/ file by path
- search_brain — semantic search via PARK-001 Vectorize (optional, add after PARK-001)
- list_skills — lists all skills in skills/user/
- get_skill — returns a skill's SKILL.md content

## Clue Tree
1. **MCP Worker Scaffold** → pass: packages/mcp-server/ exists, wrangler.toml configured, MCP protocol handler responds to tool/list with the 4 core tools
2. **GitHub Read Tools** → pass: get_active_state, get_ops_board, get_brain_node, list_skills all return real data from AetherCreator/SuperClaude via GitHub API
3. **Auth + Router Integration** → pass: MCP endpoint requires CF_MCP_TOKEN header (simple bearer), /api/mcp route wired into thechefos-router, Claude.ai can connect with URL + token
4. **Claude Connector Test** → pass: Tyler adds thechefos.com/api/mcp in Claude settings → Tools, session start auto-loads ACTIVE-STATE and OPS-BOARD content

## Critical Rules
- GITHUB_TOKEN stored as wrangler secret (read-only PAT for SuperClaude repo)
- MCP_AUTH_TOKEN stored as wrangler secret (shared secret for Claude connector auth)
- MCP protocol: JSON-RPC 2.0 over HTTP (not SSE for now — simpler)
- Never expose write access through MCP — read-only to start
