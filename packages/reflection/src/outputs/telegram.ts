export interface TelegramDigest {
  week: string;
  commitUrl: string;
  filedOpsRows: string[];
  notableHighlights: string[];
  isSmoke: boolean;
}

export interface TelegramEnv {
  SHIPS_DOCTOR_BOT_TOKEN: string;
  TYLER_CHAT_ID: string;
}

export async function sendReflectionTelegram(
  env: TelegramEnv,
  digest: TelegramDigest
): Promise<{ ok: boolean; message_id?: number; error?: string }> {
  const text = buildTelegramText(digest);

  const resp = await fetch(
    `https://api.telegram.org/bot${env.SHIPS_DOCTOR_BOT_TOKEN}/sendMessage`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: env.TYLER_CHAT_ID,
        text,
        parse_mode: "Markdown",
        disable_web_page_preview: true,
      }),
    }
  );

  if (!resp.ok) {
    const errText = await resp.text();
    return { ok: false, error: `telegram failed ${resp.status}: ${errText.slice(0, 200)}` };
  }

  const result = (await resp.json()) as { ok: boolean; result?: { message_id: number } };
  if (!result.ok) {
    return { ok: false, error: "telegram API returned ok=false" };
  }

  return { ok: true, message_id: result.result?.message_id };
}

function buildTelegramText(digest: TelegramDigest): string {
  const titlePrefix = digest.isSmoke ? "*[SMOKE]* " : "";
  const title = `${titlePrefix}*Weekly Reflection — ${escapeMarkdown(digest.week)}*`;

  const notables =
    digest.notableHighlights.length > 0
      ? digest.notableHighlights
          .slice(0, 5)
          .map((n) => `• ${escapeMarkdown(n)}`)
          .join("\n")
      : "• _(none)_";

  const filed =
    digest.filedOpsRows.length > 0
      ? digest.filedOpsRows.map(escapeMarkdown).join(", ")
      : "_(none)_";

  return [
    `🪞 ${title}`,
    "",
    `📄 Digest: ${digest.commitUrl}`,
    "",
    `🔔 *Notable*:`,
    notables,
    "",
    `📋 *Filed*: ${filed}`,
    "",
    `_thechefos-reflection-worker_`,
  ].join("\n");
}

// Telegram MarkdownV1 escaping — only escape chars that break formatting in dynamic content
export function escapeMarkdown(s: string): string {
  return s.replace(/[_*[\]()]/g, (c) => `\\${c}`);
}
