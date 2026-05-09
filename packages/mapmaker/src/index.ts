// @Aether_MapMaker_bot — schema-validating hunt dispatcher.
// Persona: validator-dispatcher (NOT a thinker). Pure logic — no LLM calls.
//
// Flow:
//   Tyler DMs Mapmaker a charter -> validate YAML+MAP ->
//   write CHARTER.md + auto-gen clue-1 PROMPT.md to brain ->
//   send /build@Mastro_ClaudeBot <hunt> 1 to FORGE_OPS_GROUP ->
//   Mastro fires WF04 -> auto-exec.sh routes [NARROW] to hunter-exec.py ->
//   Hunter writes COMPLETE.md -> Long John pings ✅
//
// Sovereignty: only outbound = Telegram Bot API + thechefos-brain-write Worker. No LLM.

import { parse as parseYAML } from 'yaml';

interface Env {
  TELEGRAM_TOKEN: string;
  WEBHOOK_SECRET: string;
  BRAIN_WRITE_URL: string;
  BRAIN_WRITE_SECRET: string;
  FORGE_OPS_CHAT_ID?: string;
  HUNTS_KV: KVNamespace;
}

interface Charter {
  hunt: string;
  substrate: 'NARROW' | 'SUBSTANTIAL';
  pass: string;
  bank: string;
  cost: string;
  notes?: string;
}

interface ValidationResult {
  ok: boolean;
  charter?: Charter;
  body?: string;
  errors?: string[];
}

const REQUIRED_FIELDS = ['hunt', 'substrate', 'pass', 'bank', 'cost'] as const;
const HUNT_NAME_RE = /^[a-z0-9][a-z0-9-]{2,48}$/;
const TYLER_USER_ID = 6091970994;

async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function uuidv7(): string {
  const ts = Date.now();
  const tsHex = ts.toString(16).padStart(12, '0');
  const rand = crypto.getRandomValues(new Uint8Array(10));
  const r = Array.from(rand).map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${tsHex.slice(0, 8)}-${tsHex.slice(8, 12)}-7${r.slice(0, 3)}-${r.slice(3, 7)}-${r.slice(7, 19)}`;
}

function normalizeForHash(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

function parseCharter(text: string): ValidationResult {
  const fmMatch = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!fmMatch) {
    return {
      ok: false,
      errors: [
        'Charter must start with YAML frontmatter delimited by `---` lines',
        'Expected:\n```\n---\nhunt: my-hunt\nsubstrate: NARROW\npass: "..."\nbank: brain/...\ncost: "$0"\n---\n# CHARTER: ...\n## MAP\n- C1: ...\n```',
      ],
    };
  }

  let frontmatter: any;
  try {
    frontmatter = parseYAML(fmMatch[1]);
  } catch (e: any) {
    return { ok: false, errors: [`YAML parse error: ${e.message}`] };
  }
  if (!frontmatter || typeof frontmatter !== 'object') {
    return { ok: false, errors: ['Frontmatter must be a YAML object'] };
  }

  const errors: string[] = [];
  for (const field of REQUIRED_FIELDS) {
    const v = frontmatter[field];
    if (v === undefined || v === null || v === '') {
      errors.push(`Missing required field: \`${field}\``);
    }
  }
  if (frontmatter.hunt && !HUNT_NAME_RE.test(String(frontmatter.hunt))) {
    errors.push(`\`hunt\` must be lowercase kebab-case, 3-49 chars (got: \`${frontmatter.hunt}\`)`);
  }
  if (frontmatter.substrate && !['NARROW', 'SUBSTANTIAL'].includes(frontmatter.substrate)) {
    errors.push(`\`substrate\` must be \`NARROW\` or \`SUBSTANTIAL\` (got: \`${frontmatter.substrate}\`)`);
  }
  if (frontmatter.bank && !String(frontmatter.bank).startsWith('brain/')) {
    errors.push(`\`bank\` must be a path under \`brain/\` (got: \`${frontmatter.bank}\`)`);
  }

  // Walk lines to find the ## MAP section and count its bullets.
  // Earlier lookahead-based regex with the `m` flag misfired because `$` matches
  // end-of-LINE under multiline mode — the lazy capture stopped after the first
  // bullet, mis-reporting waypoint count. Line-walker is unambiguous.
  const body = fmMatch[2];
  const lines = body.split('\n');
  const mapStart = lines.findIndex((l) => /^##\s+MAP\s*$/.test(l));
  if (mapStart === -1) {
    errors.push('Body must contain a `## MAP` section');
  } else {
    let mapEnd = lines.length;
    for (let i = mapStart + 1; i < lines.length; i++) {
      if (/^#{1,2}\s/.test(lines[i])) {
        mapEnd = i;
        break;
      }
    }
    const waypoints = lines
      .slice(mapStart + 1, mapEnd)
      .filter((l) => /^[-*]\s+/.test(l));
    if (waypoints.length < 3) {
      errors.push(`MAP must have ≥3 waypoints (found: ${waypoints.length})`);
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, charter: frontmatter as Charter, body };
}

async function tg(env: Env, method: string, payload: any): Promise<Response> {
  return fetch(`https://api.telegram.org/bot${env.TELEGRAM_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}


// Convert our internal markdown-like syntax to safe Telegram HTML.
// Markdown V1's underscore-as-italic semantics break on plain text containing `_`
// (e.g. "chat_id", "Mastro_ClaudeBot"). HTML mode avoids that whole class of bugs.
function mdToHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/```([\s\S]*?)```/g, (_m, code) => `<pre>${code}</pre>`)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*([^*]+)\*/g, '<b>$1</b>');
}

async function reply(env: Env, chatId: number | string, text: string, replyTo?: number): Promise<void> {
  const r = await tg(env, 'sendMessage', {
    chat_id: chatId,
    text: mdToHtml(text),
    parse_mode: 'HTML',
    reply_to_message_id: replyTo,
  });
  if (!r.ok) {
    // Fall back to plain text if HTML parsing somehow fails. Visibility > formatting.
    const errBody = await r.text().catch(() => '');
    console.error('reply HTML failed, falling back to plain', r.status, errBody.slice(0, 200));
    await tg(env, 'sendMessage', { chat_id: chatId, text, reply_to_message_id: replyTo });
  }
}

async function brainWrite(env: Env, path: string, content: string, message: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(env.BRAIN_WRITE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-webhook-secret': env.BRAIN_WRITE_SECRET,
      },
      body: JSON.stringify({ path, content, message }),
    });
    if (!res.ok) {
      return { ok: false, error: `brain-write ${res.status}: ${(await res.text()).slice(0, 160)}` };
    }
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: `brain-write fetch error: ${e.message}` };
  }
}

async function persistCharter(env: Env, huntId: string, charter: Charter, body: string): Promise<{ ok: boolean; error?: string }> {
  const charterPath = `hunts/${charter.hunt}/CHARTER.md`;
  const promptPath = `hunts/${charter.hunt}/clue-1/PROMPT.md`;
  const dispatched_at = new Date().toISOString();

  const charterContent = [
    '---',
    ...Object.entries({ ...charter, hunt_id: huntId, dispatched_at }).map(
      ([k, v]) => `${k}: ${typeof v === 'string' ? JSON.stringify(v) : v}`
    ),
    'authored_by: mapmaker-bot',
    '---',
    '',
    body,
  ].join('\n');

  const promptContent = [
    '[NARROW]',
    '',
    `# ${charter.hunt} — Clue 1`,
    '',
    `**Hunt ID:** ${huntId}`,
    `**Bank target:** ${charter.bank}`,
    `**Substrate:** ${charter.substrate}`,
    '',
    '## Task',
    '',
    `You are firing clue-1 of a Mapmaker-dispatched hunt. The CHARTER has been`,
    `validated and saved to \`${charterPath}\`. Pass condition: ${charter.pass}`,
    '',
    'Steps:',
    '',
    `1. Use \`github_put_file\` to write \`hunts/${charter.hunt}/clue-1/COMPLETE.md\` with:`,
    '   - YAML frontmatter: hunt_id, completed_at (ISO), substrate, mapmaker_dispatch: true',
    '   - Body: "✅ Mapmaker → Mastro → WF04 → Hunter loop closed cleanly."',
    '   - Reference back to ../CHARTER.md',
    '2. Exit clean. No synthesis required.',
    '',
    'This is a smoke test — the goal is verifying end-to-end bot-to-bot dispatch.',
    'Long John will ping ✅ on COMPLETE.md commit.',
  ].join('\n');

  const c = await brainWrite(env, charterPath, charterContent, `mapmaker: ${charter.hunt} CHARTER (${huntId.slice(0, 8)})`);
  if (!c.ok) return c;

  const p = await brainWrite(env, promptPath, promptContent, `mapmaker: ${charter.hunt} clue-1 PROMPT (${huntId.slice(0, 8)})`);
  if (!p.ok) return p;

  return { ok: true };
}

async function dispatchToMastro(env: Env, charter: Charter): Promise<{ ok: boolean; error?: string; deferred?: boolean }> {
  if (!env.FORGE_OPS_CHAT_ID) {
    return { ok: false, deferred: true, error: 'FORGE_OPS_CHAT_ID not set — charter saved but dispatch deferred. Configure secret to enable bot-to-bot.' };
  }
  const cmd = `/build@Mastro_ClaudeBot ${charter.hunt} 1`;
  try {
    const res = await tg(env, 'sendMessage', { chat_id: env.FORGE_OPS_CHAT_ID, text: cmd });
    if (!res.ok) {
      return { ok: false, error: `Telegram sendMessage ${res.status}: ${(await res.text()).slice(0, 160)}` };
    }
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: `Telegram fetch error: ${e.message}` };
  }
}

async function processCharter(env: Env, charterText: string): Promise<string> {
  const result = parseCharter(charterText);
  if (!result.ok) {
    return [
      '❌ *Charter validation failed*',
      '',
      ...result.errors!.map((e) => `• ${e}`),
      '',
      '_Fix the charter and re-send to retry._',
    ].join('\n');
  }

  const charter = result.charter!;
  const normalized = normalizeForHash(charterText);
  const charterHash = await sha256Hex(normalized);

  const existing = await env.HUNTS_KV.get(`hash:${charterHash}`);
  if (existing) {
    return [
      '↻ *Idempotent return*',
      '',
      'This exact charter was already dispatched.',
      `Hunt ID: \`${existing}\``,
      `Name: \`${charter.hunt}\``,
      '',
      '_To re-fire, modify the charter (any byte change works) and re-send._',
    ].join('\n');
  }

  const huntId = uuidv7();

  const persistResult = await persistCharter(env, huntId, charter, result.body!);
  if (!persistResult.ok) {
    return [
      '⚠️ *Brain write failed — no dispatch attempted*',
      '',
      persistResult.error!,
      '',
      '_Idempotency NOT recorded. Safe to retry._',
    ].join('\n');
  }

  await env.HUNTS_KV.put(`hash:${charterHash}`, huntId, { expirationTtl: 60 * 60 * 24 * 30 });
  await env.HUNTS_KV.put(`hunt:${huntId}`, JSON.stringify({
    ...charter,
    hash: charterHash,
    dispatched_at: new Date().toISOString(),
  }));

  const dispatch = await dispatchToMastro(env, charter);
  if (dispatch.deferred) {
    return [
      '🟡 *Charter saved, dispatch DEFERRED*',
      '',
      `Hunt ID: \`${huntId}\``,
      `Name: \`${charter.hunt}\``,
      `Substrate: \`${charter.substrate}\``,
      '',
      '*Files written:*',
      `• \`hunts/${charter.hunt}/CHARTER.md\``,
      `• \`hunts/${charter.hunt}/clue-1/PROMPT.md\``,
      '',
      '_FORGE_OPS_CHAT_ID secret missing. Manual fire:_',
      `\`@Mastro_ClaudeBot /build ${charter.hunt} 1\``,
    ].join('\n');
  }
  if (!dispatch.ok) {
    return [
      '⚠️ *Charter saved, but dispatch failed*',
      '',
      `Hunt ID: \`${huntId}\``,
      `Name: \`${charter.hunt}\``,
      '',
      `Error: ${dispatch.error}`,
      '',
      `_Manual fire: \`@Mastro_ClaudeBot /build ${charter.hunt} 1\`_`,
    ].join('\n');
  }

  return [
    '✅ *Hunt dispatched*',
    '',
    `Hunt ID: \`${huntId}\``,
    `Name: \`${charter.hunt}\``,
    `Substrate: \`${charter.substrate}\``,
    `Bank target: \`${charter.bank}\``,
    '',
    '_Mapmaker → Mastro → WF04 → Hunter loop is hot. Long John will ping on close._',
  ].join('\n');
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/health') {
      return Response.json({
        ok: true,
        persona: 'mapmaker',
        schema: 'mapmaker-1.0',
        bot: 'Aether_MapMaker_bot',
        dispatch_path: 'C-bot-to-bot',
        forge_ops_configured: !!env.FORGE_OPS_CHAT_ID,
      });
    }

    if (url.pathname === '/webhook' && request.method === 'POST') {
      const secretHeader = request.headers.get('X-Telegram-Bot-Api-Secret-Token');
      if (secretHeader !== env.WEBHOOK_SECRET) {
        return new Response('Forbidden', { status: 403 });
      }

      let update: any;
      try {
        update = await request.json();
      } catch {
        return new Response('Bad JSON', { status: 400 });
      }

      const msg = update.message;
      if (!msg) return new Response('OK');

      const text: string = msg.text ?? msg.caption ?? '';
      const senderId = msg.from?.id;
      const chatId = msg.chat.id;

      if (/^\/grouphere(@\w+)?(\s|$)/.test(text)) {
        await reply(env, chatId,
          `🗺️ *Mapmaker present*\n\n` +
          `\`chat_id: ${chatId}\`\n` +
          `type: ${msg.chat.type}\n` +
          `title: ${msg.chat.title ?? '(none)'}\n\n` +
          `_Add this chat_id as the \`FORGE_OPS_CHAT_ID\` secret to enable bot-to-bot dispatch._`,
          msg.message_id
        );
        return new Response('OK');
      }

      if (/^\/(help|start)(@\w+)?$/.test(text.trim())) {
        await reply(env, chatId, [
          '🗺️ *Mapmaker — Charter validator and hunt dispatcher*',
          '',
          '*Commands:*',
          '/help — this message',
          '/grouphere — print chat_id',
          '',
          '*Charter format:*',
          '```',
          '---',
          'hunt: my-hunt-name',
          'substrate: NARROW',
          'pass: "what done looks like"',
          'bank: brain/02-architecture/x.md',
          'cost: "$0"',
          '---',
          '# CHARTER: ...',
          '## MAP',
          '- C1: first waypoint',
          '- C2: second',
          '- C3: third',
          '```',
          '',
          'Send a charter to validate + dispatch.',
        ].join('\n'), msg.message_id);
        return new Response('OK');
      }

      const looksLikeCharter = text.includes('---') && /\nhunt\s*:/.test(text);
      if (looksLikeCharter) {
        if (senderId !== TYLER_USER_ID) {
          await reply(env, chatId, '🛑 Charter dispatch is restricted to Tyler.', msg.message_id);
          return new Response('OK');
        }
        const replyText = await processCharter(env, text);
        await reply(env, chatId, replyText, msg.message_id);
        return new Response('OK');
      }

      if (senderId === TYLER_USER_ID && msg.chat.type === 'private') {
        await reply(env, chatId,
          'Send me a charter (YAML frontmatter + ## MAP section) or `/help`.',
          msg.message_id
        );
      }

      return new Response('OK');
    }

    return new Response('Not Found', { status: 404 });
  },
};
