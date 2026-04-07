import { Hono } from 'hono'

export interface Env {
  TELEGRAM_BOT_TOKEN: string
  TELEGRAM_CHAT_ID: string
  BRAIN_WEBHOOK_SECRET: string
  GITHUB_TOKEN: string
  AI: Ai
  // Alert service secrets (for cron)
  STRIPE_API_KEY: string
  VERCEL_TOKEN: string
  VERCEL_PROJECT_ID: string
  LINEAR_API_KEY: string
  BRAIN_WRITE: Fetcher
}

// Sender allowlist — only these Telegram user IDs can trigger brain writes
// Tyler's Telegram user ID (same as chat ID for private chats)
const BRAIN_WRITE_ALLOWED_SENDERS = new Set([6091970994])

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

// One-shot webhook setup — sets Telegram webhook to this Worker's endpoint
app.get('/api/telegram/setup-webhook', async (c) => {
  const webhookUrl = 'https://api.thechefos.app/api/telegram'
  const setResp = await fetch(
    `https://api.telegram.org/bot${c.env.TELEGRAM_BOT_TOKEN}/setWebhook`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: webhookUrl }),
    }
  )
  const setData = await setResp.json()

  const infoResp = await fetch(
    `https://api.telegram.org/bot${c.env.TELEGRAM_BOT_TOKEN}/getWebhookInfo`
  )
  const infoData = await infoResp.json()

  return c.json({ set: setData, info: infoData })
})

// Outbound send endpoint — used by n8n to send replies to Tyler
// Body: { message: { chat: { id: number }, text: string } }
app.post('/api/telegram/send', async (c) => {
  const body = await c.req.json<{ message: { chat: { id: number }; text: string } }>()
  const chatId = body?.message?.chat?.id
  const text = body?.message?.text
  if (!chatId || !text) return c.json({ ok: false, error: 'missing chat_id or text' }, 400)
  await sendTelegram(c.env.TELEGRAM_BOT_TOKEN, chatId, text)
  return c.json({ ok: true })
})

app.post('/api/telegram', async (c) => {
  const body = await c.req.json<TelegramUpdate>()

  const message = body.message
  if (!message) {
    return c.json({ ok: true })
  }

  const chatId = message.chat.id
  const senderId = message.from?.id

  // SENDER FILTER: Only Tyler's messages can write to brain
  // Messages without a sender (e.g., from n8n posting directly) are blocked from brain writes
  const isTyler = senderId !== undefined && BRAIN_WRITE_ALLOWED_SENDERS.has(senderId)

  try {
    // Voice message → transcribe via Workers AI Whisper (Tyler only)
    if (message.voice) {
      if (!isTyler) {
        return c.json({ ok: true }) // silently ignore non-Tyler voice
      }
      await handleVoice(c.env, chatId, message.voice)
      return c.json({ ok: true })
    }

    // Photo message → capture with caption (Tyler only)
    if (message.photo && message.photo.length > 0) {
      if (!isTyler) {
        return c.json({ ok: true }) // silently ignore non-Tyler photos
      }
      await handlePhoto(c.env, chatId, message.photo, message.caption)
      return c.json({ ok: true })
    }

    // Text message (with or without command)
    if (message.text) {
      // Conductor commands → forward to n8n Telegram Command Router (any sender)
      const conductorCommands = ['/build', '/kill', '/babysit', '/hunts']
      const isConductor = conductorCommands.some(
        (cmd) => message.text === cmd || message.text!.startsWith(cmd + ' ')
      )
      if (isConductor) {
        await fetch('https://n8n.thechefos.app/webhook/telegram-commands', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message }),
        })
        return c.json({ ok: true })
      }

      // Grok Forge commands → forward to n8n Grok Harvester (Tyler only — triggers brain writes)
      if (message.text!.startsWith('/idea ') && isTyler) {
        const content = message.text!.slice(6).trim()
        await sendTelegram(c.env.TELEGRAM_BOT_TOKEN, chatId, '🧠 Harvesting idea...')
        await fetch('https://n8n.thechefos.app/webhook/grok-harvest', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mode: 'idea', content, chat_id: chatId }),
        })
        return c.json({ ok: true })
      }

      if (message.text!.startsWith('/dump ') && isTyler) {
        const content = message.text!.slice(6).trim()
        await sendTelegram(c.env.TELEGRAM_BOT_TOKEN, chatId, '🧠 Processing dump...')
        await fetch('https://n8n.thechefos.app/webhook/grok-harvest', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mode: 'dump', content, chat_id: chatId }),
        })
        return c.json({ ok: true })
      }

      if (message.text === '/scan' && isTyler) {
        await sendTelegram(c.env.TELEGRAM_BOT_TOKEN, chatId, '🔍 Running brain scan...')
        await fetch('https://n8n.thechefos.app/webhook/grok-harvest', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mode: 'scan', chat_id: chatId }),
        })
        return c.json({ ok: true })
      }

      // Researcher command → forward to n8n Researcher Agent (Tyler only)
      if (message.text!.startsWith('/research ') && isTyler) {
        const args = message.text!.slice(10).trim()
        const topicMatch = args.match(/^"([^"]+)"\s*(.*)$/) || args.match(/^(\S+)\s*(.*)$/)
        const topic = topicMatch ? topicMatch[1] : args
        const depth = topicMatch?.[2]?.trim() || 'surface'
        await sendTelegram(c.env.TELEGRAM_BOT_TOKEN, chatId, `📚 Starting research: "${topic}" (${depth})...`)
        await fetch('https://n8n.thechefos.app/webhook/researcher', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ topic, depth, chat_id: chatId }),
        })
        return c.json({ ok: true })
      }

      // Wiki search (read-only, any sender is fine)
      if (message.text!.startsWith('/wiki ')) {
        const query = message.text!.slice(6).trim()
        const wikiResp = await fetch(
          `https://api.thechefos.app/api/brain/graph/query?q=${encodeURIComponent(query)}&limit=5`
        )
        if (wikiResp.ok) {
          const data = await wikiResp.json() as { results?: Array<{ title: string; slug: string; summary?: string }> }
          const results = (data as any).results || (data as any).data || []
          if (results.length > 0) {
            const msg = '📖 Wiki Results:\n' + results.map((r: any) => `• ${r.title || r.slug}: ${(r.summary || r.insight || '').slice(0, 80)}`).join('\n')
            await sendTelegram(c.env.TELEGRAM_BOT_TOKEN, chatId, msg)
          } else {
            await sendTelegram(c.env.TELEGRAM_BOT_TOKEN, chatId, `📖 No wiki results for "${query}"`)
          }
        } else {
          await sendTelegram(c.env.TELEGRAM_BOT_TOKEN, chatId, '⚠️ Wiki search unavailable')
        }
        return c.json({ ok: true })
      }

      // Special commands that don't push to brain (any sender)
      if (message.text === '/status') {
        await handleStatus(c.env, chatId)
        return c.json({ ok: true })
      }
      if (message.text === '/help' || message.text === '/start') {
        await handleHelp(c.env.TELEGRAM_BOT_TOKEN, chatId)
        return c.json({ ok: true })
      }

      // Default text capture → brain (TYLER ONLY)
      if (isTyler) {
        await handleText(c.env, chatId, message.text)
      }
      // Non-Tyler text messages are silently ignored (no brain write, no error)
      return c.json({ ok: true })
    }

    // Fallback — acknowledge unhandled message types (Tyler only)
    if (isTyler) {
      await sendTelegram(c.env.TELEGRAM_BOT_TOKEN, chatId, 'Lamora hears you')
    }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : 'Unknown error'
    if (isTyler) {
      await sendTelegram(c.env.TELEGRAM_BOT_TOKEN, chatId, `❌ Error: ${errMsg}`)
    }
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
    '*Grok Forge:*',
    '/idea [text] → harvest knowledge nodes',
    '/dump [text] → bulk knowledge extraction',
    '/scan → brain scan + suggestions',
    '/research "[topic]" [depth] → wiki research',
    '/wiki [query] → search wiki',
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
  const resp = await env.BRAIN_WRITE.fetch('https://thechefos-brain-write.workers.dev/api/brain/push', {
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

// --- Proactive Alert Cron ---

async function handleScheduled(env: Env): Promise<void> {
  const alerts: string[] = []

  // Check Stripe for past_due/unpaid subscriptions
  if (env.STRIPE_API_KEY) {
    const stripeAlerts = await checkStripe(env.STRIPE_API_KEY)
    alerts.push(...stripeAlerts)
  }

  // Check Vercel for 5xx errors
  if (env.VERCEL_TOKEN && env.VERCEL_PROJECT_ID) {
    const vercelAlerts = await checkVercel(env.VERCEL_TOKEN, env.VERCEL_PROJECT_ID)
    alerts.push(...vercelAlerts)
  }

  // Check Linear for stale urgent issues
  if (env.LINEAR_API_KEY) {
    const linearAlerts = await checkLinear(env.LINEAR_API_KEY)
    alerts.push(...linearAlerts)
  }

  // Send alerts if any, silent if all clear
  if (alerts.length > 0) {
    const message = alerts.join('\n\n')
    await sendTelegram(env.TELEGRAM_BOT_TOKEN, Number(env.TELEGRAM_CHAT_ID), message)
  }
}

async function checkStripe(apiKey: string): Promise<string[]> {
  const alerts: string[] = []

  const resp = await fetch(
    'https://api.stripe.com/v1/subscriptions?status=past_due&limit=10',
    { headers: { Authorization: `Bearer ${apiKey}` } }
  )

  if (!resp.ok) return alerts

  const data = (await resp.json()) as {
    data: Array<{
      status: string
      customer: string
      items: { data: Array<{ price: { unit_amount: number; recurring: { interval: string } }; plan?: { nickname: string } }> }
    }>
  }

  for (const sub of data.data) {
    const item = sub.items.data[0]
    const amount = item?.price?.unit_amount ? `$${(item.price.unit_amount / 100).toFixed(0)}/mo` : 'unknown'
    const plan = item?.plan?.nickname || 'subscription'
    alerts.push(`🚨 STRIPE ALERT\nPast due: ${sub.customer}\nPlan: ${plan} ${amount}\nAction: Check Stripe dashboard`)
  }

  // Also check unpaid
  const unpaidResp = await fetch(
    'https://api.stripe.com/v1/subscriptions?status=unpaid&limit=10',
    { headers: { Authorization: `Bearer ${apiKey}` } }
  )

  if (unpaidResp.ok) {
    const unpaidData = (await unpaidResp.json()) as { data: Array<{ customer: string }> }
    for (const sub of unpaidData.data) {
      alerts.push(`🚨 STRIPE ALERT\nUnpaid: ${sub.customer}\nAction: Check Stripe dashboard`)
    }
  }

  return alerts
}

async function checkVercel(token: string, projectId: string): Promise<string[]> {
  const alerts: string[] = []
  const since = Date.now() - 60 * 60 * 1000 // last hour

  const resp = await fetch(
    `https://api.vercel.com/v1/projects/${projectId}/deployments?limit=5&state=READY&since=${since}`,
    { headers: { Authorization: `Bearer ${token}` } }
  )

  if (!resp.ok) return alerts

  // Check runtime logs for 5xx errors
  const logsResp = await fetch(
    `https://api.vercel.com/v2/projects/${projectId}/logs?since=${since}&type=error&limit=50`,
    { headers: { Authorization: `Bearer ${token}` } }
  )

  if (!logsResp.ok) return alerts

  const logsData = (await logsResp.json()) as {
    data?: Array<{ message: string; statusCode?: number; proxy?: { statusCode?: number } }>
  }

  const errors = (logsData.data || []).filter(
    (log) => (log.statusCode && log.statusCode >= 500) || (log.proxy?.statusCode && log.proxy.statusCode >= 500)
  )

  if (errors.length > 0) {
    const topError = errors[0]?.message?.slice(0, 100) || 'Unknown error'
    alerts.push(`⚠️ VERCEL ERROR\n${projectId}: ${errors.length} errors in last hour\nTop error: ${topError}\nAction: Check Vercel logs`)
  }

  return alerts
}

async function checkLinear(apiKey: string): Promise<string[]> {
  const alerts: string[] = []
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()

  const query = `{
    issues(filter: {
      priority: { eq: 1 },
      updatedAt: { lt: "${sevenDaysAgo}" },
      state: { type: { nin: ["completed", "canceled"] } }
    }, first: 10) {
      nodes {
        identifier
        title
        updatedAt
      }
    }
  }`

  const resp = await fetch('https://api.linear.app/graphql', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: apiKey,
    },
    body: JSON.stringify({ query }),
  })

  if (!resp.ok) return alerts

  const data = (await resp.json()) as {
    data?: { issues?: { nodes: Array<{ identifier: string; title: string; updatedAt: string }> } }
  }

  const issues = data.data?.issues?.nodes || []
  for (const issue of issues) {
    const daysStale = Math.floor((Date.now() - new Date(issue.updatedAt).getTime()) / (1000 * 60 * 60 * 24))
    alerts.push(`📋 LINEAR FLAG\n${issue.identifier} urgent for ${daysStale} days\n${issue.title}\nAction: Review and update`)
  }

  return alerts
}

export default {
  fetch: app.fetch,
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(handleScheduled(env))
  },
}
