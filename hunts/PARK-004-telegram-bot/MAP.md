# Hunt: PARK-004 — Lamora (Telegram Bot)
Goal: A Telegram bot named Lamora that lets Tyler capture thoughts from iPhone or Watch and receive proactive system alerts. Zero infrastructure on Tyler's end — all serverless Cloudflare Workers.
Repo: AetherCreator/thechefos-workers
Branch: feature/park-workers

## Named after Locke Lamora — The Gentleman Bastard
Fast, clever, gets in and out without being noticed. Captures what matters.

## What this unlocks
- **Capture:** Message Lamora → node in brain/ in 3 seconds. Text, voice, photo. From Watch or iPhone, 3am in the kitchen, anywhere.
- **Alerts:** Stripe failure, Vercel error, urgent Linear issue → Lamora messages Tyler. Notification on Watch. No computer. Ever.

## Bot credentials (stored as Worker secrets — never in code)
- TELEGRAM_BOT_TOKEN — `8720879536:AAFCxpK9U_WNVGvJJfTkAcH2Y-ODIa2HL_0` (store via wrangler secret put, already set in Cloudflare dashboard)
- TELEGRAM_CHAT_ID — `6091970994` ✅ confirmed
- BRAIN_WEBHOOK_SECRET — `Lies-of-Lamora-2026` ✅ confirmed (matches brain-write Worker)
- GITHUB_TOKEN — stored in Worker, used for any direct GitHub reads needed

## Architecture
```
Tyler → Telegram (text/voice/photo)
           ↓
Cloudflare Worker webhook (/api/telegram)
           ↓
Parse message type
  text → format as brain node
  voice → Workers AI Whisper transcription → format as brain node
  photo → caption + image URL → format as brain node
  /command → route to correct brain domain
           ↓
POST to /api/brain/push (PARK-003 endpoint)
           ↓
✅ Reply to Lamora: "Captured: [preview]"

Cloudflare Cron Worker (every hour)
           ↓
Check Stripe: failed/past_due subscriptions
Check Vercel: 5xx errors in last hour
Check Linear: urgent issues stale >7 days
           ↓
Any findings → Telegram message to TELEGRAM_CHAT_ID
           ↓
Tyler's Watch vibrates 🏴‍☠️
```

## Capture Commands
- `/idea [text]` → brain/05-knowledge/
- `/bake [text]` → brain/03-professional/chef/
- `/coci [text]` → brain/02-personal/family/
- `/money [text]` → brain/04-finance/
- `/note [text]` → brain/00-session/ (quick, no category)
- Voice message → auto-transcribed via Workers AI (@cf/openai/whisper), domain auto-detected
- Photo + caption → stored with image URL in node content
- Plain text (no command) → brain/00-session/ with raw content

## Proactive Alert Format
```
🚨 STRIPE ALERT
Past due: chef@restaurant.com
Plan: Pro $14/mo
Action: Check Stripe dashboard

⚠️ VERCEL ERROR  
superconci: 12 errors in last hour
Top error: TypeError in StoryPlayer
Action: Check Vercel logs

📋 LINEAR FLAG
AET-100 urgent for 8 days
Chef knowledge interview incomplete
Action: Schedule domain interview
```

## Clue Tree
1. **Webhook Worker** → pass: packages/telegram-bot/ scaffolded, webhook registered at api.thechefos.app/api/telegram via Telegram setWebhook API, Worker receives messages and replies "Lamora hears you", /health returns bot username
2. **Text + Voice Capture** → pass: text messages formatted as brain node and pushed via /api/brain/push, voice messages transcribed via Workers AI Whisper, both reply "✅ Captured: [first 50 chars]", /note /idea /bake /coci /money commands all route to correct brain path
3. **Photo Capture + Status** → pass: photos stored with caption as brain node, /status command fetches and returns summary of ACTIVE-STATE.md from GitHub, /help returns command list
4. **Proactive Alert Cron** → pass: Cron trigger configured in wrangler.toml (every 1 hour), checks Stripe list_subscriptions for past_due/unpaid, checks Vercel runtime logs for 5xx errors, checks Linear urgent issues updated >7 days ago, sends formatted alert for any findings, silent if all clear
5. **Router Integration + End-to-End** → pass: /api/telegram route wired in thechefos-router, all 4 Worker secrets configured, end-to-end test passes: voice message on iPhone → transcribed → node in brain/ → "✅ Captured" reply

## Critical Rules
- ALL secrets via wrangler secret put — never hardcode
- Validate Telegram webhook source using secret token in URL (not just any POST)
- Workers AI Whisper: @cf/openai/whisper model, free tier, no external API needed
- PARK-003 must be deployed before this hunt (brain write endpoint dependency)
- Cron trigger requires paid Cloudflare Workers plan OR use free tier with external cron ping
- Reply to every message — silence makes Tyler think it's broken

## Worker Secrets Required
```
TELEGRAM_BOT_TOKEN = stored in Cloudflare ✅
TELEGRAM_CHAT_ID = 6091970994 ✅
BRAIN_WEBHOOK_SECRET = Lies-of-Lamora-2026 ✅
GITHUB_TOKEN = stored in Cloudflare ✅
```

## Clue 1 Status
✅ COMPLETE — packages/telegram-bot/ scaffolded, webhook Worker built, router integration wired.
Branch: claude/park-workers-telegram-bot-VgisJ
Note: Lamora won't respond yet — api.thechefos.app domain not wired + Worker not deployed to Cloudflare.
Deploy is required before registering the Telegram webhook.

## Success State (TREASURE)
6am. Tyler is in the kitchen. Croissants are proofing.
He raises his Watch: "bake: cold butter at 15 degrees gives better lamination layers"
His Watch vibrates: "✅ Captured: cold butter at 15 degrees..."
The node is in brain/03-professional/chef/

At 8am his Watch vibrates again:
"🚨 STRIPE: Past due — chef@restaurant.com — Pro plan"
He handles it before breakfast.

Lamora never sleeps. No computer. No token. No manual steps.
The system works while he does. 🏴‍☠️
