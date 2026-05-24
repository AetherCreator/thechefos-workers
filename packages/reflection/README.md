# @thechefos/reflection

Weekly reflection Worker for the SuperClaude brain. Fires every Sunday at 22:00 UTC (5PM ET), reads operational metrics from D1 and GitHub, and emits a digest markdown file to `brain/06-meta/reflection/YYYY-Www.md`.

## Clue status

| Clue | Status | Ships |
|------|--------|-------|
| C1   | COMPLETE | Worker scaffold, input adapter stubs, routing, auth |
| C2   | pending | Computation engine — real adapter logic, digest sections |
| C3   | pending | Output: GitHub commit + Telegram notify |
| C4   | pending | First live run |

## Endpoints

### `POST /api/reflect-now`

Trigger reflection manually. Requires `X-Reflection-Key` header.

**Query params:**
- `week` — ISO week `YYYY-Www` (default: current week)
- `dry` — `true` skips commit + Telegram
- `commit` — `true` commits digest to GitHub (C1: stub, always `false`)
- `notify` — `true` sends Telegram (C1: stub, always `false`)

### `GET /health`

Public health check.

## Cron

Registered as `0 22 * * 0` (Sunday 22:00 UTC). C1 stubs the handler with a log line; C2 wires the full run.

## Secrets (set via `wrangler secret put` in C3)

- `REFLECTION_API_SECRET` — X-Reflection-Key match value
- `GITHUB_REFLECTION_PAT` — fine-grained PAT with write on `brain/06-meta/reflection/*`
- `BRAIN_WRITE_API_SECRET` — for `/api/ops/file` dogfood
- `SHIPS_DOCTOR_BOT_TOKEN` — Telegram bot token
- `TYLER_CHAT_ID` — Telegram chat ID

## Deploy

```bash
# Dry-run only until C2 (real deploy in C2)
cd packages/reflection
pnpm dry-run

# Real deploy (C2+)
pnpm deploy
```

## Tests

```bash
cd packages/reflection
pnpm test
```
