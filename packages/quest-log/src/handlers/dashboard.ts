import type { Context } from "hono";
import type { Env } from "../index";
import { getCachedOrFetch } from "../cache";

const CACHE_KEY_ACTIVE = "cache:dashboard:active-state";
const CACHE_KEY_OPS = "cache:dashboard:ops-board";
const CACHE_KEY_COST = "cache:dashboard:cost-ledger";
const CACHE_TTL = 300;

export async function computeQlkCookie(secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode("qlk-v1"));
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, "0")).join("");
}

function parseCookies(header: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx < 0) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) out[k] = v;
  }
  return out;
}

function escHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export async function fetchGithubRaw(env: Env, path: string): Promise<string> {
  const url = `https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO_SUPERCLAUDE}/contents/${path}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: "application/vnd.github.raw",
      "User-Agent": "quest-log-worker/1.0",
    },
  });
  if (!res.ok) throw new Error(`GitHub ${res.status} for ${path}`);
  return res.text();
}

export async function fetchCostLedger(env: Env): Promise<string> {
  try {
    const weekAgo = new Date(Date.now() - 7 * 24 * 3600_000).toISOString();
    const { results } = await env.DB.prepare(
      "SELECT COUNT(*) as runs FROM carpenter_runs WHERE created_at > ?"
    ).bind(weekAgo).all();
    const runs = (results?.[0] as { runs?: number } | undefined)?.runs ?? 0;
    return `Carpenter: ${runs} runs / $0.00\n(Workers AI Kimi K2.6, in-network)`;
  } catch (err) {
    console.error("D1 cost ledger error:", err);
    return `Carpenter: — / $0.00 (D1 read failed: ${String(err)})`;
  }
}

export function parseActiveBlock(md: string): string {
  const lines = md.split("\n");
  const out: string[] = [];
  for (const line of lines) {
    if (/^-{3,}/.test(line.trim())) break;
    out.push(line);
  }
  return out.join("\n").trim();
}

export function parseOpsBoard(md: string): { open: string[]; victories: string[] } {
  const lines = md.split("\n");
  const open: string[] = [];
  const victories: string[] = [];
  type Section = "none" | "urgent" | "active" | "completed";
  let section: Section = "none";
  const sevenDaysAgo = Date.now() - 7 * 24 * 3600_000;

  for (const line of lines) {
    const t = line.trim();
    if (t.startsWith("##")) {
      if (t.includes("🚨") || t.toUpperCase().includes("URGENT")) section = "urgent";
      else if (t.includes("✅") || t.toUpperCase().includes("COMPLETED")) section = "completed";
      else if (t.includes("🟢") || t.toUpperCase().includes("ACTIVE")) section = "active";
      else section = "none";
      continue;
    }
    // skip table separator rows and non-table lines
    if (!t.startsWith("|") || /^\|\s*[-:]+\s*\|/.test(t)) continue;
    if (section === "urgent" || section === "active") {
      if (open.length < 10) open.push(t);
    } else if (section === "completed") {
      const m = t.match(/(\d{4}-\d{2}-\d{2})/);
      if (m && Date.parse(m[1]) >= sevenDaysAgo && victories.length < 10) {
        victories.push(t);
      }
    }
  }
  return { open, victories };
}

function tableRowsToHtml(rows: string[]): string {
  if (!rows.length) return `<p class="muted">None found</p>`;
  return `<ul>${rows.map(r => `<li>${escHtml(r)}</li>`).join("")}</ul>`;
}

function renderHtml(data: {
  activeState: string;
  open: string[];
  victories: string[];
  costLedger: string;
  refreshedAt: Date;
}): string {
  const ts = data.refreshedAt.toISOString();
  const minAgo = Math.floor((Date.now() - data.refreshedAt.getTime()) / 60000);
  const timeLabel = minAgo === 0 ? "just now" : `${minAgo} min ago`;

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="theme-color" content="#0a0a0a">
<link rel="manifest" href="/manifest.json">
<title>Quest Log</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{background:#0a0a0a;color:#e0e0e0;font-family:system-ui,sans-serif;max-width:420px;margin:0 auto;padding:12px}
header{padding:8px 0 16px;color:#888;font-size:.8rem}
.card{background:#141414;border:1px solid #222;border-radius:8px;padding:14px;margin-bottom:12px}
.card h2{font-size:1rem;margin-bottom:10px;color:#fff}
.card pre{white-space:pre-wrap;font-size:.78rem;color:#bbb;line-height:1.5}
.card ul{padding-left:16px;font-size:.8rem;line-height:1.6;color:#bbb}
.card-placeholder{opacity:.5}
.muted{color:#666;font-size:.8rem;font-style:italic}
@media (prefers-color-scheme:light){body{background:#f5f5f5;color:#111}.card{background:#fff;border-color:#ddd}.card h2{color:#000}.card pre,.card ul{color:#333}.muted{color:#888}}
</style>
</head>
<body>
<header>Quest Log &middot; last refresh: <time data-refreshed-at="${escHtml(ts)}">${escHtml(timeLabel)}</time></header>

<section class="card">
<h2>&#9875; CURRENT ADVENTURE</h2>
<div><pre>${escHtml(data.activeState || "No active state found")}</pre></div>
</section>

<section class="card">
<h2>&#128308; OPEN QUESTS</h2>
<div>${tableRowsToHtml(data.open)}</div>
</section>

<section class="card">
<h2>&#128994; RECENT VICTORIES</h2>
<div>${tableRowsToHtml(data.victories)}</div>
</section>

<section class="card">
<h2>&#128176; COST LEDGER</h2>
<div><pre>${escHtml(data.costLedger)}</pre></div>
</section>

<section class="card card-placeholder">
<h2>&#129689; Crew XP</h2>
<div><p class="muted">Phase 2 P5 lands</p></div>
</section>

<section class="card card-placeholder">
<h2>&#129689; Spirit Level</h2>
<div><p class="muted">Phase 2 P5 lands</p></div>
</section>

<section class="card card-placeholder">
<h2>&#129689; Knowledge Map</h2>
<div><p class="muted">Phase 2 P5 lands</p></div>
</section>

<script>
(function(){
  var el=document.querySelector('time[data-refreshed-at]');
  if(!el)return;
  var ts=new Date(el.getAttribute('data-refreshed-at'));
  function tick(){var d=Math.floor((Date.now()-ts.getTime())/60000);el.textContent=d===0?'just now':d+' min ago';}
  tick();setInterval(tick,30000);
})();
</script>
</body>
</html>`;
}

const MANIFEST_JSON = JSON.stringify({
  name: "Quest Log",
  short_name: "QuestLog",
  start_url: "/dashboard",
  display: "standalone",
  background_color: "#0a0a0a",
  theme_color: "#0a0a0a",
  icons: [
    {
      src: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><rect width='100' height='100' fill='%230a0a0a'/><text x='50' y='65' font-size='60' text-anchor='middle' fill='%23fff'>📜</text></svg>",
      sizes: "192x192",
      type: "image/svg+xml",
    },
  ],
});

export function getManifest(_c: Context): Response {
  return new Response(MANIFEST_JSON, {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

export async function getDashboard(c: Context<{ Bindings: Env }>): Promise<Response> {
  const env = c.env;
  const url = new URL(c.req.url);
  const keyParam = url.searchParams.get("key");

  // ?key=<plain> → validate and issue cookie
  if (keyParam !== null) {
    if (keyParam !== env.QUEST_LOG_DASHBOARD_SECRET) {
      return new Response(JSON.stringify({ ok: false, error: "unauthorized" }), {
        status: 401,
        headers: { "content-type": "application/json" },
      });
    }
    const qlk = await computeQlkCookie(env.QUEST_LOG_DASHBOARD_SECRET);
    return new Response(null, {
      status: 302,
      headers: {
        Location: "/dashboard",
        "Set-Cookie": `qlk=${qlk}; HttpOnly; Secure; SameSite=Strict; Max-Age=2592000; Path=/`,
      },
    });
  }

  // Cookie auth for all other dashboard requests
  const cookies = parseCookies(c.req.header("cookie") ?? null);
  const providedQlk = cookies["qlk"] ?? "";
  const expectedQlk = await computeQlkCookie(env.QUEST_LOG_DASHBOARD_SECRET);
  if (providedQlk !== expectedQlk) {
    return new Response(JSON.stringify({ ok: false, error: "unauthorized" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }

  const kv = env.QUEST_LOG_STATE;

  // ?refresh=1 → bust all 3 dashboard cache keys
  if (url.searchParams.get("refresh") === "1") {
    await Promise.all([
      kv.delete(CACHE_KEY_ACTIVE),
      kv.delete(CACHE_KEY_OPS),
      kv.delete(CACHE_KEY_COST),
    ]);
  }

  const [activeStateMd, opsBoardMd, costLedger] = await Promise.all([
    getCachedOrFetch(kv, CACHE_KEY_ACTIVE, CACHE_TTL, () =>
      fetchGithubRaw(env, "brain/00-session/ACTIVE-STATE.md")
    ).catch((e: Error) => `(fetch failed: ${e.message})`),
    getCachedOrFetch(kv, CACHE_KEY_OPS, CACHE_TTL, () =>
      fetchGithubRaw(env, "brain/OPS-BOARD.md")
    ).catch((_e: Error) => ""),
    getCachedOrFetch(kv, CACHE_KEY_COST, CACHE_TTL, () => fetchCostLedger(env)),
  ]);

  const activeState = parseActiveBlock(activeStateMd as string);
  const { open, victories } = parseOpsBoard(opsBoardMd as string);

  const html = renderHtml({
    activeState,
    open,
    victories,
    costLedger: costLedger as string,
    refreshedAt: new Date(),
  });

  return new Response(html, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}
