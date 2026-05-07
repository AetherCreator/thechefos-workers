# C3 COMPLETE — locke-harvest Worker scaffold

**Date:** 2026-05-06T23:52:10Z
**Substrate:** auto-exec.sh → claude-exec.sh (per `[SUBSTANTIAL]` first-line tag)
**Pattern:** staged-source cp-into-place (sidesteps prior streaming failure on large Write tool calls)
**Hunt:** forge-and-library
**Status:** complete

## Files committed at `packages/locke-harvest/`

- `wrangler.toml` (583 bytes, copied from staged/)
- `package.json` (302 bytes, copied from staged/)
- `src/index.ts` (~12.7 KB, copied from staged/)

Source commit: 4be41419b31cde7a6e95ddcf9e82efc6143b165e

## CI verification

- deploy.yml run id: 25474902227
- conclusion: success
- status: completed

## Deferred (intentional, NOT failures)

- **KV-backed cross-invocation dedup** — MVP uses in-memory Set. Cross-invocation dedup per LIBRARIAN-SCHEMA §7 is post-MVP.
- **Phase 2 Agent-Reach** — C1 audit confirms not installed. Phase 1 (SearXNG) → Phase 3 (Gemini) only for MVP.
- **SearXNG Cloudflare tunnel** — wrangler.toml points at `https://searxng-tunnel.thechefos.app/search`. Verify the tunnel exists before first cron; otherwise expect `query_failed` intel events. NOT blocking deploy.

## Tyler-side post-deploy steps (DO NOT execute from this clue)

```
wrangler secret put GEMINI_API_KEY --name locke-harvest        # value from /opt/secrets/gemini-key
wrangler secret put BRAIN_WRITE_SECRET --name locke-harvest    # value: SuperDuperClaude
wrangler secret put HARVEST_RUN_SECRET --name locke-harvest    # any random 32-char string; save to /opt/secrets/locke-harvest-run-key
```

## Smoke (Tyler-side, becomes C4)

```
curl -X POST "https://locke-harvest.tveg-baking.workers.dev/run?secret=$(cat /opt/secrets/locke-harvest-run-key)"
```

Expect: `{"kept":N,"discarded":M,"status":"complete|no_signal|all_discarded","session_id":"…"}`. Successful smoke writes ≥1 file under `brain/05-leads/` (or `_drafts/`) and a session report under `brain/05-leads/_sessions/`.