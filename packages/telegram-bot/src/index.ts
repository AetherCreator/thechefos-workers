import { Hono } from 'hono'

export interface Env {
  TELEGRAM_BOT_TOKEN: string
  TELEGRAM_CHAT_ID: string
  BRAIN_WEBHOOK_SECRET: string
  GITHUB_TOKEN: string
  AI: Ai
}

// Command → brain path mapping
const COMMAND_PATHS: Record<string, string> = {
  '/note': 'brain/00-session/',
  '/idea': 'brain/05-knowledge/',
  '/bake': 'brain/03-professional/chef/',
  '/coci': 'brain/02-personal/family/',
  '/money': 'brain/04-finance/',
}

const app = new Hono<{ Bindings: Env }>()

// Health check — returns bot username via Telegram getMe API
app.get('/health', async (c) => {
  const resp = await fetch(
    `https://api.telegram.org/bot${c.env.TELEGRAM_BOT_TOKEN}/getMe`
  )
  const data = (await resp.json()) as {
    ok: boolean
    result?: { username: string }
  }

  if (!data.ok || !data.result) {
    return c.json({ status: 'error', message: 'Failed to reach Telegram API' }, 502)
  }

  return c.json({ status: 'ok', bot: data.result.username })
})

// Telegram webhook endpoint
app.post('/api/telegram', async (c) => {
  const body = await c.req.json<TelegramUpdate>()

  const message = body.message
  if (!message) {
    return c.json({ ok: true })
  }

  const chatId = message.chat.id

  try {
    // Voice message → transcribe via Workers AI Whisper
    if (message.voice) {
      await handleVoice(c.env, chatId, message.voice)
      return c.json({ ok: true })
    }

    // Photo message → capture with caption
    if (message.photo && message.photo.length > 0) {
      await handlePhoto(c.env, chatId, message.photo, message.caption)
      return c.json({ ok: true })
    }

    // Text message (with or without command)
    if (message.text) {
      // Special commands that don't push to brain
      if (message.text === '/status') {
        await handleStatus(c.env, chatId)
        return c.json({ ok: true })
      }
      if (message.text === '/help' || message.text === '/start') {
        await handleHelp(c.env.TELEGRAM_BOT_TOKEN, chatId)
        return c.json({ ok: true })
      }

      await handleText(c.env, chatId, message.text)
      return c.json({ ok: true })
    }

    // Fallback — acknowledge unhandled message types
    await sendTelegram(c.env.TELEGRAM_BOT_TOKEN, chatId, 'Lamora hears you')
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : 'Unknown error'
    await sendTelegram(c.env.TELEGRAM_BOT_TOKEN, chatId, `❌ Error: ${errMsg}`)
  }

  return c.json({ ok: true })
})

// --- Handlers ---

async function handleText(env: Env, chatId: number, text: string): Promise<void> {
  const { path, content } = parseCommand(text)
  const slug = slugify(content.slice(0, 40))
  const filename = `${Date.now()}-${slug}.md`
  const fullPath = `${path}${filename}`

  const nodeContent = `---\ncaptured: ${new Date().toISOString()}\nsource: telegram\n---\n\n${content}`

  await pushToBrain(env, fullPath, nodeContent, `capture: ${content.slice(0, 50)}`)
  await sendTelegram(env.TELEGRAM_BOT_TOKEN, chatId, `✅ Captured: ${content.slice(0, 50)}`)
}

async function handleVoice(env: Env, chatId: number, voice: TelegramVoice): Promise<void> {
  // Get file URL from Telegram
  const fileResp = await fetch(
    `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/getFile`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file_id: voice.file_id }),
    }
  )
  const fileData = (await fileResp.json()) as {
    ok: boolean
    result?: { file_path: string }
  }

  if (!fileData.ok || !fileData.result?.file_path) {
    throw new Error('Failed to get voice file from Telegram')
  }

  // Download the audio file
  const audioUrl = `https://api.telegram.org/file/bot${env.TELEGRAM_BOT_TOKEN}/${fileData.result.file_path}`
  const audioResp = await fetch(audioUrl)
  const audioBuffer = await audioResp.arrayBuffer()

  // Transcribe via Workers AI Whisper
  const transcription = (await env.AI.run('@cf/openai/whisper', {
    audio: [...new Uint8Array(audioBuffer)],
  })) as { text: string }

  const text = transcription.text?.trim()
  if (!text) {
    throw new Error('Whisper returned empty transcription')
  }

  // Route transcribed text through the same command parsing
  const { path, content } = parseCommand(text)
  const slug = slugify(content.slice(0, 40))
  const filename = `${Date.now()}-${slug}.md`
  const fullPath = `${path}${filename}`

  const nodeContent = `---\ncaptured: ${new Date().toISOString()}\nsource: telegram-voice\ntranscription: whisper\n---\n\n${content}`

  await pushToBrain(env, fullPath, nodeContent, `voice capture: ${content.slice(0, 50)}`)
  await sendTelegram(env.TELEGRAM_BOT_TOKEN, chatId, `✅ Captured: ${content.slice(0, 50)}`)
}

async function handlePhoto(
  env: Env,
  chatId: number,
  photos: TelegramPhoto[],
  caption?: string
): Promise<void> {
  // Use the largest photo (last in array)
  const largest = photos[photos.length - 1]

  // Get file URL from Telegram
  const fileResp = await fetch(
    `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/getFile`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file_id: largest.file_id }),
    }
  )
  const fileData = (await fileResp.json()) as {
    ok: boolean
    result?: { file_path: string }
  }

  if (!fileData.ok || !fileData.result?.file_path) {
    throw new Error('Failed to get photo file from Telegram')
  }

  const imageUrl = `https://api.telegram.org/file/bot${env.TELEGRAM_BOT_TOKEN}/${fileData.result.file_path}`
  const captionText = caption?.trim() || 'photo capture'

  const { path, content } = parseCommand(captionText)
  const slug = slugify(content.slice(0, 40))
  const filename = `${Date.now()}-${slug}.md`
  const fullPath = `${path}${filename}`

  const nodeContent = `---\ncaptured: ${new Date().toISOString()}\nsource: telegram-photo\nimage: ${imageUrl}\n---\n\n${content}\n\n![photo](${imageUrl})`

  await pushToBrain(env, fullPath, nodeContent, `photo capture: ${content.slice(0, 50)}`)
  await sendTelegram(env.TELEGRAM_BOT_TOKEN, chatId, `✅ Captured: ${content.slice(0, 50)}`)
}

async function handleStatus(env: Env, chatId: number): Promise<void> {
  const resp = await fetch(
    'https://api.github.com/repos/AetherCreator/SuperClaude/contents/brain/ACTIVE-STATE.md',
    {
      headers: {
        Authorization: `Bearer ${env.GITHUB_TOKEN}`,
        Accept: 'application/vnd.github.v3.raw',
        'User-Agent': 'Lamora-Bot',
      },
    }
  )

  if (!resp.ok) {
    await sendTelegram(env.TELEGRAM_BOT_TOKEN, chatId, '⚠️ Could not fetch ACTIVE-STATE.md')
    return
  }

  const content = await resp.text()
  // Send first 3000 chars (Telegram message limit is 4096)
  const summary = content.length > 3000 ? content.slice(0, 3000) + '\n\n... (truncated)' : content
  await sendTelegram(env.TELEGRAM_BOT_TOKEN, chatId, `📋 ACTIVE STATE\n\n${summary}`)
}

async function handleHelp(token: string, chatId: number): Promise<void> {
  const help = [
    '🏴‍☠️ *Lamora — Gentleman Bastard*',
    '',
    '*Capture Commands:*',
    '/note [text] → quick capture (session)',
    '/idea [text] → knowledge base',
    '/bake [text] → chef/professional',
    '/coci [text] → family',
    '/money [text] → finance',
    '',
    '*Other:*',
    '🎤 Voice message → auto-transcribed & captured',
    '📷 Photo + caption → captured with image',
    '/status → current ACTIVE-STATE summary',
    '/help → this message',
    '',
    'Plain text (no command) → captured to session.',
  ].join('\n')

  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text: help, parse_mode: 'Markdown' }),
  })
}

// --- Brain push ---

async function pushToBrain(
  env: Env,
  path: string,
  content: string,
  message: string
): Promise<void> {
  const resp = await fetch('https://api.thechefos.app/api/brain/push', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-webhook-secret': env.BRAIN_WEBHOOK_SECRET,
    },
    body: JSON.stringify({ path, content, message }),
  })

  if (!resp.ok) {
    const body = await resp.text()
    throw new Error(`Brain push failed (${resp.status}): ${body}`)
  }
}

// --- Command parsing ---

function parseCommand(text: string): { path: string; content: string } {
  for (const [cmd, brainPath] of Object.entries(COMMAND_PATHS)) {
    if (text.startsWith(cmd + ' ') || text === cmd) {
      const content = text.slice(cmd.length).trim() || 'empty note'
      return { path: brainPath, content }
    }
  }
  // No command prefix → default to session
  return { path: 'brain/00-session/', content: text }
}

// --- Telegram helpers ---

async function sendTelegram(token: string, chatId: number, text: string): Promise<void> {
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text }),
  })
}

// --- Utilities ---

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40) || 'note'
}

// --- Telegram types ---

interface TelegramUpdate {
  update_id: number
  message?: TelegramMessage
}

interface TelegramMessage {
  message_id: number
  chat: { id: number }
  from?: { id: number; first_name: string }
  text?: string
  voice?: TelegramVoice
  photo?: TelegramPhoto[]
  caption?: string
  date: number
}

interface TelegramVoice {
  file_id: string
  duration: number
}

interface TelegramPhoto {
  file_id: string
  width: number
  height: number
}

export default app
