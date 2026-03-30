---
description: Rules for editing the Telegram bot worker (Lamora persona)
paths: ["packages/telegram-bot/**"]
---

# Telegram Bot Rules

## Persona
- Bot uses the "Lamora" persona — maintain consistent voice and personality
- Do not change persona characteristics without explicit user approval

## Webhook Security
- Telegram webhook endpoint at `/api/telegram*` via router
- Validate incoming webhook requests against Telegram's IP ranges or secret token
- Never expose the bot token in responses or logs
  verify: Grep("console\\.log.*BOT_TOKEN|console\\.log.*bot_token", "packages/telegram-bot/") → 0 matches [added: 2026-03-30]

## Message Handling
- All message handlers must be non-blocking — respond within Cloudflare Workers CPU time limits
- For long operations, acknowledge the message first, then process asynchronously
- Sanitize user input before passing to any AI or database operation

## Environment
- Bot token and chat IDs are environment secrets
- Test with wrangler deploy --dry-run before pushing changes
