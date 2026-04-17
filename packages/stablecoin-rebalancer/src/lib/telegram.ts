import type { Env } from "./assert-read-only";

export type AlertKind = "opportunity_detected" | "scanner_stuck" | "online" | "daily_digest";

export async function sendAlert(env: Env, kind: AlertKind, payload: unknown, message: string): Promise<void> {
  const now = Date.now();
  try {
    await env.DB.prepare(
      `INSERT INTO alerts (kind, payload_json, sent_ts) VALUES (?, ?, ?)`
    ).bind(kind, JSON.stringify(payload), now).run();
  } catch (e) {
    console.error("telegram: DB insert failed", e);
  }
  try {
    await fetch("https://api.thechefos.app/api/telegram", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message,
        chat_id: env.TELEGRAM_CHAT_ID,
        parse_mode: "HTML",
      }),
    });
  } catch (e) {
    console.error("telegram: fetch failed", e);
  }
}

export function formatOpportunity(o: {
  asset: string; source_protocol: string; source_chain: string; source_apy: number;
  target_protocol: string; target_chain: string; target_apy: number;
  net_edge_bps: number; gas_estimate_usd: number; capital_assumption: number;
}): string {
  const pct = (x: number) => (x * 100).toFixed(2) + "%";
  return `🪙 <b>${o.asset} rate gap</b>\n` +
    `<code>${o.source_protocol}@${o.source_chain}</code>: ${pct(o.source_apy)}\n` +
    `→ <code>${o.target_protocol}@${o.target_chain}</code>: ${pct(o.target_apy)}\n` +
    `Net edge: <b>${(o.net_edge_bps / 100).toFixed(2)}%</b> ` +
    `(on $${o.capital_assumption}, gas $${o.gas_estimate_usd.toFixed(2)})`;
}
