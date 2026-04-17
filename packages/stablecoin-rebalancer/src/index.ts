import { Hono } from "hono";
import type { Env } from "./lib/assert-read-only";
import { assertReadOnly } from "./lib/assert-read-only";
import { dashboardHtml } from "./dashboard/html";
import { handleScheduled } from "./scheduled";
import { runRateSnapshot } from "./scanners/snapshot";
import { evaluateOpportunities } from "./scanners/arbitrage";
import { sendAlert } from "./lib/telegram";

const app = new Hono<{ Bindings: Env }>();

app.get("/", (c) => c.redirect("/dashboard"));
app.get("/dashboard", (c) => c.html(dashboardHtml));

app.get("/api/health", async (c) => {
  const since = Date.now() - 24 * 3600 * 1000;
  const runs = await c.env.DB.prepare(
    `SELECT scanner, MAX(started_ts) AS last_run, COUNT(*) AS n,
            SUM(CASE WHEN status='ok' THEN 1 ELSE 0 END) AS ok_n
       FROM scanner_runs WHERE started_ts >= ? GROUP BY scanner`
  ).bind(since).all();
  return c.json({ ok: true, ts: Date.now(), scanners: runs.results });
});

app.get("/api/rates", async (c) => {
  // Latest batch only — pick max snapshot_ts per (asset,chain,protocol)
  const r = await c.env.DB.prepare(
    `SELECT chain, protocol, asset, supply_apy, utilization, snapshot_ts
       FROM rate_snapshots
      WHERE snapshot_ts >= (SELECT MAX(snapshot_ts) - 3600000 FROM rate_snapshots)
      ORDER BY asset, supply_apy DESC`
  ).all();
  return c.json({ rates: r.results, ts: Date.now() });
});

app.get("/api/opportunities", async (c) => {
  const limit = Math.min(Number(c.req.query("limit") ?? 10), 100);
  const r = await c.env.DB.prepare(
    `SELECT * FROM opportunities ORDER BY detected_ts DESC LIMIT ?`
  ).bind(limit).all();
  return c.json({ opportunities: r.results });
});

app.get("/api/history", async (c) => {
  const asset = c.req.query("asset") ?? "USDC";
  const days = Math.min(Number(c.req.query("days") ?? 30), 90);
  const since = Date.now() - days * 24 * 3600 * 1000;
  const r = await c.env.DB.prepare(
    `SELECT chain, protocol, supply_apy, snapshot_ts
       FROM rate_snapshots
      WHERE asset=? AND snapshot_ts >= ?
      ORDER BY snapshot_ts ASC`
  ).bind(asset, since).all();
  return c.json({ points: r.results });
});

/** Test endpoint: force one full snapshot+arb cycle. READ_ONLY still enforced. */
app.get("/api/force-snapshot", async (c) => {
  assertReadOnly(c.env);
  await runRateSnapshot(c.env);
  await evaluateOpportunities(c.env);
  return c.json({ ok: true });
});

/** Announce online (one-shot for Clue 5 verification; can remove later). */
app.get("/api/announce-online", async (c) => {
  const r = await c.env.DB.prepare(
    `SELECT COUNT(DISTINCT batch_id) AS n FROM rate_snapshots`
  ).all();
  const snapshots = Number((r.results?.[0] as { n?: number })?.n ?? 0);
  const oppRes = await c.env.DB.prepare(`SELECT COUNT(*) AS n FROM opportunities`).all();
  const opps = Number((oppRes.results?.[0] as { n?: number })?.n ?? 0);
  const url = new URL(c.req.url).origin;
  await sendAlert(c.env, "online", { url, snapshots, opps },
    `🪙 <b>stablecoin-rebalancer v1 online</b>\n${url}\n${snapshots} snapshots logged · ${opps} opportunities flagged`
  );
  return c.json({ ok: true, snapshots, opps });
});

export default {
  fetch: app.fetch,
  async scheduled(event: ScheduledController, env: Env): Promise<void> {
    await handleScheduled(event, env);
  },
};
