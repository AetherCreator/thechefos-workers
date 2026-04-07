# Telegram Bot Architecture

Each autonomous agent gets its own Telegram bot for clean separation. All bots share one OpenClaw Gateway on VPS but route to different skills.

## Bot Registry

| Bot | Agent | Purpose | Status |
|-----|-------|---------|--------|
| 🎭 **@LockeLamoraBot** | The Seeker | Demand signals, opportunity briefs, lead reports | ✅ Exists |
| 📚 **@TheLibrarianBot** | The Librarian | Wiki updates, research digests, knowledge alerts | ❌ Create via @BotFather |
| 🏛️ **@SuperClaudeBot** | System Ops | Brain health, session state, deploy notifications | ❌ Create via @BotFather |
| 🏭 **@TheFoundryBot** | The Foundry | Build status, ship reports, council results, revenue | ❌ Create via @BotFather |

## Creating New Bots (tap-by-tap)

1. Open Telegram → search **@BotFather**
2. Send `/newbot`
3. Enter display name (e.g. "The Librarian")
4. Enter username (e.g. `TheLibrarianBot` — must end in "bot")
5. Copy the token BotFather gives you
6. Repeat for each bot needed

Store tokens on VPS at `/opt/secrets/telegram-tokens/`:
```
/opt/secrets/telegram-tokens/locke-lamora.token
/opt/secrets/telegram-tokens/librarian.token
/opt/secrets/telegram-tokens/superclaude.token
/opt/secrets/telegram-tokens/foundry.token
```

## OpenClaw Multi-Bot Routing

OpenClaw supports multiple Telegram channels routed to different skills:

```yaml
# openclaw gateway config (conceptual)
channels:
  - name: locke-lamora
    platform: telegram
    token: ${LOCKE_TELEGRAM_TOKEN}
    skill: seeker
    model: gemini-flash  # research, free tier

  - name: librarian
    platform: telegram
    token: ${LIBRARIAN_TELEGRAM_TOKEN}
    skill: librarian
    model: gemini-flash  # research, free tier

  - name: superclaude
    platform: telegram
    token: ${SUPERCLAUDE_TELEGRAM_TOKEN}
    skill: system-ops
    model: ollama/llama3.2  # local, free

  - name: foundry
    platform: telegram
    token: ${FOUNDRY_TELEGRAM_TOKEN}
    skill: foundry-status
    model: ollama/llama3.2  # local, free
```

## Message Flow

```
Tyler's phone
  ├── @LockeLamoraBot  ──→ OpenClaw ──→ seeker skill ──→ SearXNG + Agent-Reach + Gemini
  ├── @TheLibrarianBot ──→ OpenClaw ──→ librarian skill ──→ SearXNG + Gemini + brain-write
  ├── @SuperClaudeBot  ──→ OpenClaw ──→ system-ops skill ──→ Cloudflare Workers APIs
  └── @TheFoundryBot   ──→ OpenClaw ──→ foundry skill ──→ Claude Code + Haiku reviewer
```

## Commands Per Bot

**@LockeLamoraBot:**
- `/hunt` — trigger a manual grift session (search Reddit/HN now)
- `/brief` — get latest findings
- `/leads` — list all active leads awaiting Council
- `/graveyard` — leads that died at the Council gate

**@TheLibrarianBot:**
- `/research [topic] [depth]` — manual research trigger
- `/status` — wiki size, articles today, open questions count
- `/digest` — today's research highlights
- `/wiki [query]` — search the wiki

**@SuperClaudeBot:**
- `/brain` — brain health quick stats
- `/ops` — current OPS cycle status
- `/vps` — VPS resource usage
- `/deploy [worker]` — trigger a Worker redeploy

**@TheFoundryBot:**
- `/forge` — trigger full pipeline (hunt → council → build)
- `/council [lead_id]` — send a specific lead to the Council
- `/shipped` — list shipped products
- `/revenue` — revenue dashboard

## Existing Infrastructure

Tyler's current Telegram setup:
- Chat ID: `6091970994`
- Existing bot: `thechefos-telegram-bot` Worker on Cloudflare
- Existing endpoint: `POST https://api.thechefos.app/api/telegram`

The new bot architecture runs through OpenClaw on VPS, NOT through the existing Cloudflare telegram-bot Worker. They coexist — the existing bot handles system notifications, the new bots handle agent conversations.
