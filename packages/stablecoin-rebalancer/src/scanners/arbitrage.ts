import type { Env } from "../lib/assert-read-only";
import { assertReadOnly } from "../lib/assert-read-only";
import { logScannerRun, latestSnapshotsByAsset } from "../lib/db";
import { findBestOpportunity, Opportunity } from "../strategies/rate-arb";
import { sendAlert, formatOpportunity } from "../lib/telegram";

const ASSETS: readonly ("USDC" | "USDT" | "DAI")[] = ["USDC", "USDT", "DAI"] as const;

async function getCooldown(env: Env, key: string): Promise<number | null> {
  const r = await env.DB.prepare(
    `SELECT last_sent_ts FROM alert_cooldowns WHERE cooldown_key=?`
  ).bind(key).all();
  const row = r.results?.[0] as { last_sent_ts?: number } | undefined;
  return row?.last_sent_ts ?? null;
}

async function setCooldown(env: Env, key: string, ts: number): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO alert_cooldowns (cooldown_key, last_sent_ts) VALUES (?, ?)
       ON CONFLICT(cooldown_key) DO UPDATE SET last_sent_ts=excluded.last_sent_ts`
  ).bind(key, ts).run();
}

async function persistOpportunity(env: Env, o: Opportunity, alertSent: boolean): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO opportunities (
       asset, source_protocol, source_chain, source_apy,
       target_protocol, target_chain, target_apy,
       rate_delta_bps, gas_estimate_usd, capital_assumption,
       net_edge_bps, detected_ts, alert_sent, metadata_json
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    o.asset, o.source_protocol, o.source_chain, o.source_apy,
    o.target_protocol, o.target_chain, o.target_apy,
    o.rate_delta_bps, o.gas_estimate_usd, o.capital_assumption,
    o.net_edge_bps, Date.now(), alertSent ? 1 : 0,
    JSON.stringify({ cooldown_key: o.cooldown_key })
  ).run();
}

export async function evaluateOpportunities(env: Env): Promise<void> {
  const start = Date.now();
  assertReadOnly(env);
  let status: "ok" | "error" | "partial" = "ok";
  let rowsWritten = 0;
  let errorMsg: string | undefined;

  const capital = Number(env.CAPITAL_ASSUMPTION);
  const gas = {
    ethereum_round_trip_usd: Number(env.GAS_ESTIMATE_USD_ETH),
    l2_round_trip_usd: Number(env.GAS_ESTIMATE_USD_L2),
  };
  const minNetEdgeBps = Number(env.MIN_NET_EDGE_BPS);
  const cooldownMs = Number(env.COOLDOWN_HOURS) * 3600 * 1000;

  try {
    for (const asset of ASSETS) {
      try {
        const rows = (await latestSnapshotsByAsset(env, asset)) as unknown as {
          chain: string; protocol: string; asset: string; supply_apy: number;
        }[];
        const opp = findBestOpportunity(asset, rows, capital, gas, minNetEdgeBps);
        if (!opp) continue;

        const lastSent = await getCooldown(env, opp.cooldown_key);
        const now = Date.now();
        const shouldAlert = !lastSent || (now - lastSent > cooldownMs);

        await persistOpportunity(env, opp, shouldAlert);
        rowsWritten++;

        if (shouldAlert) {
          await sendAlert(env, "opportunity_detected", opp, formatOpportunity(opp));
          await setCooldown(env, opp.cooldown_key, now);
        }
      } catch (e: unknown) {
        status = "partial";
        const msg = (e instanceof Error ? e.message : String(e)).slice(0, 200);
        errorMsg = errorMsg ? errorMsg + " | " + msg : msg;
      }
    }
  } catch (e: unknown) {
    status = "error";
    errorMsg = (e instanceof Error ? e.message : String(e)).slice(0, 500);
  } finally {
    await logScannerRun(env, {
      scanner: "arbitrage",
      started_ts: start,
      duration_ms: Date.now() - start,
      status,
      rows_written: rowsWritten,
      error_msg: errorMsg ?? null,
    });
  }
}
