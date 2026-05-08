# n8n schedule workflows

CF account is at the 5/5 cron-trigger cap (code 10072). Future swarm Workers
that need scheduled fires register via n8n instead of a CF cron — n8n is
already running on InfiniVeg, has its own scheduler, and scales without quota
concerns.

## Files

| File | Schedule | Target |
|------|----------|--------|
| `council-weekly.json` | Sun 01:00 UTC | `POST council.tveg-baking.workers.dev/run-manual?secret=$COUNCIL_RUN_SECRET` |

## Import (one-time per workflow)

1. Open n8n UI: `https://n8n.thechefos.app`
2. Workflows → Import from File → select the `.json` from this directory
3. Set required env var on the n8n container:
   ```
   docker exec -it n8n /bin/sh -c "export COUNCIL_RUN_SECRET=<value-from-/opt/secrets/council-run-key>"
   ```
   Or set in `/opt/n8n/.env` and `docker compose up -d` to reload.
4. Activate workflow (toggle top-right)
5. Verify by running once manually (Execute Workflow button)

## Why not CF cron?

- Free CF plan: max 5 cron triggers per account
- Currently used: locke-harvest (1), superclaude-brain-graph (2),
  stablecoin-rebalancer (1), thechefos-telegram-bot (1) = 5/5
- Council added would be 6 → rejected
- Same problem will recur as Schemer/Builder/Reviewer get autonomous
  schedules in v1.1
- n8n has no such cap and is already part of the stack
