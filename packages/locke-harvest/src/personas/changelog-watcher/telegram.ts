// Telegram notification helpers for changelog-watcher triage decisions.
// pingImmediate: for security_advisory — fires immediately to Tyler direct.
// queueDailyDigest: for breaking_change — stores in KV daily_digest_queue.
// All functions soft-fail: errors are returned, not thrown.

import type { Env } from '../../types';
import type { ChangelogLead } from '../../changelogSchema';

const TELEGRAM_API = 'https://api.telegram.org';

export interface TelegramResult {
  ok: boolean;
  message_id?: number;
  error?: string;
}

export async function pingImmediate(env: Env, lead: ChangelogLead): Promise<TelegramResult> {
  const token = env.MASTRO_BOT_TOKEN;
  const chatId = env.TYLER_CHAT_ID;

  if (!token || !chatId) {
    return { ok: false, error: 'telegram_not_configured' };
  }

  const text = [
    `🚨 *SECURITY ADVISORY — ${lead.dep_name}*`,
    `Release: ${lead.release_tag}`,
    `URL: ${lead.release_url}`,
    ``,
    lead.severity_signals.slice(0, 3).join('\n') || '(no signals)',
  ].join('\n');

  try {
    const res = await fetch(`${TELEGRAM_API}/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' }),
      signal: AbortSignal.timeout(8_000),
    });
    const data = await res.json() as { ok: boolean; result?: { message_id?: number } };
    return { ok: data.ok, message_id: data.result?.message_id };
  } catch (e) {
    return { ok: false, error: String(e).slice(0, 200) };
  }
}

export interface DigestQueueResult {
  ok: boolean;
  key?: string;
  error?: string;
}

export async function queueDailyDigest(env: Env, lead: ChangelogLead): Promise<DigestQueueResult> {
  // Store in DAILY_DIGEST_KV if bound; soft-fail if not (no drain in v1).
  if (!env.DAILY_DIGEST_KV) {
    return { ok: false, error: 'daily_digest_kv_not_configured' };
  }
  const key = `daily_digest:${new Date().toISOString().split('T')[0]}:${lead.dep_name}:${lead.release_tag}`;
  const entry = {
    dep_name: lead.dep_name,
    release_tag: lead.release_tag,
    release_url: lead.release_url,
    severity: lead.severity,
    criticality: lead.criticality,
    ts: new Date().toISOString(),
  };
  try {
    await env.DAILY_DIGEST_KV.put(key, JSON.stringify(entry), {
      expirationTtl: 7 * 86400, // 7 days — digest drain window
    });
    return { ok: true, key };
  } catch (e) {
    return { ok: false, error: String(e).slice(0, 200) };
  }
}
