# n8n WF04 — Voyage Patch

## What this is

`WF04-voyage-patch.json` is the full patched export of the **04 — Telegram Command Router**
workflow (n8n ID `uCtREDPI7homnJpF`), adding a `/voyage <hunt-slug>` command branch.

### What the patch adds

- New rule in the `Route Command` switch node: `/voyage` → `Voyage Main`
- `Voyage Main` (Code node, id `voyage-main-node`): single-node handler that
  1. Validates `hunt_slug` (returns usage reply if missing)
  2. Fetches `CHARTER.md` from GitHub raw (`AetherCreator/SuperClaude`) — fallback because
     `brain-write /api/brain/read` route was absent at C4 time
  3. Extracts `§1 Treasure` section as `hunt_intent`
  4. POSTs to voyage worker `/voyage/start`
  5. Replies to Telegram with `voyage_id` + state link
- Fallback regex updated to exclude `/voyage` from the unknown-command path

### Required n8n env var

Set before activating:

```
VOYAGE_WORKER_BASE_URL=https://voyage.tveg-baking.workers.dev
```

(Default is already `https://voyage.tveg-baking.workers.dev` if unset — set it explicitly
once the worker is deployed in C5.)

## Import (manual path — Option B)

C4 attempted a direct CLI import (Option A). If that succeeded the workflow is already live.
If not, follow these steps:

1. Open n8n UI: `https://n8n.thechefos.app`
2. Open workflow **04 — Telegram Command Router**
3. Click the **⋯** menu → **Import from File** → select `WF04-voyage-patch.json`
4. n8n will replace the workflow with the patched version (same ID → in-place update)
5. Set env var on the container if not already set:
   ```
   docker exec n8n sh -c "echo VOYAGE_WORKER_BASE_URL=https://voyage.tveg-baking.workers.dev >> /home/node/.n8n/.env"
   docker restart n8n
   ```
6. Activate the workflow (toggle top-right if it was deactivated by import)
7. Verify by running the synthetic smoke: `packages/voyage/test/e2e-smoke.sh`

## Smoke test

```bash
bash packages/voyage/test/e2e-smoke.sh
```

At C4 time the voyage worker is not yet deployed (C5 handles that). The smoke script
validates the n8n webhook endpoint shape; a voyage-worker 502/connection-refused error in
the Telegram reply is expected and documented.
