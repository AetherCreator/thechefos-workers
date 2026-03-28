import { Hono } from 'hono'

export interface Env {
  TELEGRAM_BOT_TOKEN: string
  TELEGRAM_CHAT_ID: string
  BRAIN_WEBHOOK_SECRET: string
  GITHUB_TOKEN: string
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

  return c.json({
    status: 'ok',
    bot: data.result.username,
  })
})

// Telegram webhook endpoint
app.post('/api/telegram', async (c) => {
  const body = await c.req.json<TelegramUpdate>()

  const message = body.message
  if (!message) {
    return c.json({ ok: true })
  }

  const chatId = message.chat.id
  const text = 'Lamora hears you'

  await sendTelegramMessage(c.env.TELEGRAM_BOT_TOKEN, chatId, text)

  return c.json({ ok: true })
})

// --- Telegram helpers ---

async function sendTelegramMessage(
  token: string,
  chatId: number,
  text: string
): Promise<void> {
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text }),
  })
}

// --- Telegram types (minimal) ---

interface TelegramUpdate {
  update_id: number
  message?: TelegramMessage
}

interface TelegramMessage {
  message_id: number
  chat: { id: number }
  from?: { id: number; first_name: string }
  text?: string
  voice?: { file_id: string; duration: number }
  photo?: Array<{ file_id: string; width: number; height: number }>
  caption?: string
  date: number
}

export default app
