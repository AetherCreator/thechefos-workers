# Pa.C3 — WF04 /crew Command (n8n patch)

**Status:** Repo artifact ready for manual import (live n8n activation requires Shell Bridge).

## Files
- `WF04-crew-xp-patch.json` — Full patched workflow JSON (4 new nodes: IF + HTTP + Code Formatter + Telegram Send)

## How to apply (when Shell Bridge is stable)
1. `curl -sS https://n8n.thechefos.app/api/v1/workflows/uCtREDPI7homnJpF -H "X-N8N-API-KEY: $(sudo cat /opt/secrets/n8n-api-key)" > /tmp/wf04-current.json`
2. Use the JSON in this folder as the body for PUT (strip metadata first if needed).
3. `curl -X PUT ... --data @WF04-crew-xp-patch.json`
4. Re-activate.

## Node specs (per CHARTER §6 C3 cache)
- IF: exact `/crew` + Tyler chat_id 6091970994 (AND combinator)
- HTTP: GET /api/crew/xp-read with x-brain-write-secret header
- Code: Markdown table formatter (8 roles, librarian shows "(not deployed)")
- Telegram Send: reply with parse_mode Markdown

Matches P2 Voyage precedent exactly.

**Tyler smoke:** /crew from phone in C4.
