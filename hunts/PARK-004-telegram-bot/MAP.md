# Hunt: PARK-004 — Lamora (Telegram Bot)
Goal: A Telegram bot named Lamora that captures Tyler's thoughts from anywhere and sends proactive alerts. Zero infrastructure on Tyler's end. Serverless. 24/7. Free.
Repo: AetherCreator/thechefos-workers
Branch: feature/park-workers

## Named after Locke Lamora — The Thorn of Camorr
Gentleman Bastard. Con artist. The most dangerous man in any room who looks like the least.
His weapon is his mouth. He's on your side — you'll figure that out from context.

## Clue 1 Status
✅ COMPLETE — packages/telegram-bot/ scaffolded, Hono Worker, webhook replies, /health works.
Branch: claude/park-workers-telegram-bot-VgisJ
Needs: Deploy to Cloudflare + register webhook at api.thechefos.app/api/telegram

## Bot Credentials (Worker secrets — never in code)
```
TELEGRAM_BOT_TOKEN = stored in Cloudflare ✅
TELEGRAM_CHAT_ID = 6091970994 ✅
BRAIN_WEBHOOK_SECRET = Lies-of-Lamora-2026 ✅
GITHUB_TOKEN = stored in Cloudflare ✅
STRIPE_API_KEY = [add via wrangler secret put]
VERCEL_TOKEN = [add via wrangler secret put]
LINEAR_API_KEY = [add via wrangler secret put]
```

## Architecture
```
Tyler (Watch/iPhone) → Telegram message → Cloudflare Worker /api/telegram
                                                    ↓
                                          Parse message type
                                   text | voice | photo | /command
                                                    ↓
                              voice → Workers AI Whisper transcription
                              photo → caption + image URL
                              /command → route to correct brain path
                                                    ↓
                              POST to /api/brain/push (PARK-003)
                                    { path, content, message }
                                                    ↓
                              Reply to Tyler: Lamora voice confirmation

Cron Worker (every hour, 0 * * * *)
                    ↓
     Check Stripe: past_due / unpaid subscriptions
     Check Vercel: 5xx errors in last hour  
     Check Linear: Urgent issues stale >7 days
                    ↓
     Any findings → Telegram sendMessage to TELEGRAM_CHAT_ID
     All clear → silence (no spam)
```

## Command Routing
```
/bake [text]  → brain/03-professional/chef/bake-log-[date].md
/coci [text]  → brain/02-personal/family/coci-[date].md
/idea [text]  → brain/05-knowledge/ideas/idea-[date].md
/money [text] → brain/04-finance/note-[date].md
/note [text]  → brain/00-session/quick-[date].md
/status       → fetch ACTIVE-STATE.md from GitHub → send summary
/help         → send command list in Lamora voice
plain text    → brain/00-session/quick-[date].md
voice         → transcribe → detect domain from content → route accordingly
photo+caption → brain/03-professional/chef/ if looks like food, else brain/00-session/
```

## LAMORA VOICE SPEC (Claude Code must implement ALL replies in this voice)

### Who He Is
Locke Lamora is the Thorn of Camorr. Orphan. Con artist. Slightly built, can barely hold a
sword. His weapon is his mouth. He talks when things go wrong — especially then. Swears
casually, not for shock — it's punctuation. Loyal to the bone but will never make it obvious.
One quip past where a reasonable person would stop.

"There's no freedom quite like the freedom of being constantly underestimated."

### Voice Principles
1. SHORT — one line. Let it land.
2. DRY — understatement when terrible, mock-grandiosity when fine
3. NEVER explains the joke
4. Profanity is placed right, not frequent
5. Loyal but never sentimental — deflects sincerity with wit
6. One quip past reasonable
7. NEVER says hello, never thanks you, never uses exclamation points on good news

### Successful Capture Replies (pick style, vary them)
Text: "Stashed. Your crumb structure theory is in the vault."
Text: "Filed. Some future version of you will be glad you said that."
Text: "Got it. The gods of brain/ are satisfied."

Voice: "Transcribed your muttering. Took creative interpretation on two words. Pushed it."
Voice: "Whisper says you said \'[preview]\'. I\'ll take your word for it."
Voice: "Voice captured. Enunciate next time. Not for me — for posterity."

Photo: "Picture plus caption. Saved. Your future self owes me."
Photo: "Filed your visual evidence. Kitchen work, I assume — it usually is."

### Command Replies
/bake: "Bake log filed. chef/ folder, where the serious business lives."
/coci: "Filed under Coci moments. That kid\'s going to read these someday, you know."
/idea: "Idea captured. Whether it\'s a good one is above my pay grade."
/money: "Finance folder. Noted. Try not to need it."
/note: "Quick capture. No judgment on the category."

### Failed Operations
GitHub 404: "Tried to write that to brain/. GitHub told me to go fuck myself. 404. File doesn\'t exist yet. Want me to create it?"
GitHub 500: "GitHub is having a crisis. Not my fault. Try again in a minute — they\'ll sort themselves out."
Transcription fail: "Whisper couldn\'t make sense of your audio. Was that a kitchen or a wind tunnel? Try again."

### Proactive Alert Format
Stripe past due: "🚨 STRIPE\n[email] hasn\'t paid their dues. [Plan] — [amount].\nYou\'ve got the dashboard."
Vercel errors: "⚠️ VERCEL\n[project]: [N] errors in the last hour.\nTop offense: [error] in [location].\nLogs are yours."
Linear stale: "📋 LINEAR\n[ID] has been Urgent for [N] days.\n\'[title]\'\nEither handle it or stop calling it Urgent. Respectfully."
All clear (once/day max): "Checked everything. Stripe looks honest. Vercel\'s behaving. Linear\'s only moderately on fire. Sleep well."

### /status reply
"You asked for the state of things. Here it is, unvarnished:\n[ACTIVE-STATE summary]"

### /help reply
"Commands, since apparently you need reminding:\n/bake — kitchen thoughts → brain/chef/\n/coci — family moments → brain/family/\n/idea — concepts → brain/knowledge/\n/money — finance → brain/finance/\n/note — quick capture → brain/session/\n/status — current active state\nVoice — I\'ll transcribe it\nPhoto + caption — I\'ll file it\nEverything else — I\'ll make my best guess and tell you what I did."

### The Lamora Test
Read the reply out loud. If it sounds like a helpful bot — rewrite it.
If it sounds like a clever bastard who happens to be on your side — ship it.

## Clue Tree

### Clue 2: Text + Voice Capture
Read clue-1/COMPLETE.md first. If it does not exist — STOP.

Build on the existing packages/telegram-bot/src/index.ts:
- Parse incoming Telegram update for message type
- Text messages: format as brain node, POST to /api/brain/push, reply in Lamora voice
- Voice messages: fetch OGG file from Telegram API, send to Workers AI Whisper (@cf/openai/whisper), transcribe, format as brain node, push, reply
- All /commands route to correct brain path per command routing table above
- Every reply must match the Lamora voice spec — no generic bot responses
- /status: fetch ACTIVE-STATE.md from GitHub API using GITHUB_TOKEN, return summary in Lamora voice
- /help: return formatted command list in Lamora voice

Pass conditions:
- [ ] Plain text pushed to brain/00-session/ and returns Lamora confirmation
- [ ] Voice transcribed via Workers AI and pushed, returns Lamora confirmation with preview
- [ ] /bake routes to brain/03-professional/chef/
- [ ] /coci routes to brain/02-personal/family/
- [ ] /idea routes to brain/05-knowledge/
- [ ] /status returns ACTIVE-STATE summary, not an error
- [ ] Every reply sounds like Lamora, not a bot

Write clue-2/COMPLETE.md when done.

### Clue 3: Photo Capture + Deploy
Read clue-2/COMPLETE.md first. If it does not exist — STOP.

- Photos: extract file_id, fetch from Telegram API, store caption + Telegram image URL as brain node
- If no caption: reply "A picture without a caption. I\'m not a mind reader. Add one."
- Deploy packages/telegram-bot/ to Cloudflare using wrangler deploy
- Add all secrets via wrangler secret put (see credentials section above)
- Register Telegram webhook: POST to https://api.telegram.org/bot{TOKEN}/setWebhook with url=https://api.thechefos.app/api/telegram
- Verify webhook registered: GET https://api.telegram.org/bot{TOKEN}/getWebhookInfo

Pass conditions:
- [ ] Photo + caption pushed to brain/ and returns Lamora confirmation
- [ ] Photo without caption returns witty Lamora rejection
- [ ] Worker deployed to Cloudflare and appears in workers_list
- [ ] Webhook registered at api.thechefos.app/api/telegram
- [ ] Send "test" to Lamora in Telegram — he replies in character

Write clue-3/COMPLETE.md when done.

### Clue 4: Proactive Alert Cron
Read clue-3/COMPLETE.md first. If it does not exist — STOP.

Create packages/telegram-bot/src/cron.ts:
- Scheduled trigger: "0 * * * *" (every hour) in wrangler.toml
- Check Stripe: GET subscriptions with status=past_due or unpaid using STRIPE_API_KEY
- Check Vercel: GET runtime logs for superconci and chefos projects, filter 5xx in last hour using VERCEL_TOKEN
- Check Linear: GET urgent issues (priority=1) not updated in >7 days using LINEAR_API_KEY
- For each finding: sendMessage to TELEGRAM_CHAT_ID in alert format from voice spec
- All clear: send once per day maximum (check KV for last_all_clear timestamp)

Pass conditions:
- [ ] Cron trigger configured in wrangler.toml
- [ ] Stripe check works (returns findings or silence)
- [ ] Vercel log check works
- [ ] Linear stale issue check works
- [ ] All clear message sent max once per day, silent otherwise
- [ ] Alert messages match voice spec format

Write clue-4/COMPLETE.md when done.

### Clue 5: Router Integration + End-to-End Test
Read clue-4/COMPLETE.md first. If it does not exist — STOP.

- Confirm /api/telegram route wired in thechefos-router (was done in Clue 1, verify it survived deployment)
- End-to-end test from Tyler\'s phone:
  1. Send voice message to Lamora
  2. Lamora transcribes via Workers AI
  3. Lamora pushes to brain/ via /api/brain/push
  4. Lamora replies with Lamora-voice confirmation
  5. Verify node appears in AetherCreator/SuperClaude brain/

Pass conditions:
- [ ] /api/telegram route verified in deployed router
- [ ] Voice → transcribe → brain/ → confirmation: full chain works
- [ ] Reply sounds like Lamora
- [ ] Brain node visible in GitHub

Write clue-5/COMPLETE.md when done. Then open TREASURE.md.

## TREASURE

Tyler is in the kitchen at 6am. Croissants proofing.
Raises his Watch: "bake: cold butter at 15 degrees gives better lamination layers."
Watch vibrates: "Transcribed your muttering. Pushed it. chef/ folder."

At 8am: "🚨 STRIPE — chef@restaurant.com hasn\'t paid their dues. Pro plan — $14. You\'ve got the dashboard."

Lamora never sleeps. 🏴‍☠️
