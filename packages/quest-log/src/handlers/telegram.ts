import type { Context } from "hono";
import type { Env } from "../index";
import { requireApiKey } from "../auth";
import {
  fetchGithubRaw,
  fetchCostLedger,
  parseActiveBlock,
  parseOpsBoard,
} from "./dashboard";
import { getCachedOrFetch } from "../cache";

const TYLER_USER_ID = 6091970994;
const CACHE_TTL = 300;

interface TelegramRequest {
  chat_id?: number;
  user_id?: number;
  username?: string;
}

function fmtMarkdown(opts: {
  adventureBlock: string;
  open: string[];
  victories: string[];
  costLedger: string;
}): string {
  const lines: string[] = [];
  lines.push("📜 *Quest Log*");
  lines.push("");
  lines.push("⚓ *CURRENT ADVENTURE*");
  const advHead = opts.adventureBlock
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .slice(0, 6)
    .join("\n")
    .trim();
  lines.push(advHead || "_(empty)_");
  lines.push("");
  lines.push("🔴 *OPEN QUESTS*");
  if (opts.open.length === 0) {
    lines.push("_(none)_");
  } else {
    for (const row of opts.open.slice(0, 8)) lines.push(`• ${row}`);
  }
  lines.push("");
  lines.push("🟢 *RECENT VICTORIES*");
  if (opts.victories.length === 0) {
    lines.push("_(none)_");
  } else {
    for (const row of opts.victories.slice(0, 6)) lines.push(`• ${row}`);
  }
  lines.push("");
  lines.push("💰 *COST LEDGER*");
  lines.push(opts.costLedger);
  lines.push("");
  lines.push("_Phase 2 P5 lands: Crew XP · Spirit Level · Knowledge Map_");
  return lines.join("\n");
}

export async function postTelegramQuests(c: Context<{ Bindings: Env }>) {
  const authErr = requireApiKey(c.req.raw, c.env);
  if (authErr) return authErr;

  let body: TelegramRequest;
  try {
    body = (await c.req.json()) as TelegramRequest;
  } catch {
    return c.json({ ok: false, error: "bad_json" }, 400);
  }

  if (typeof body.user_id !== "number") {
    return c.json({ ok: false, error: "missing_user_id" }, 400);
  }

  // Tyler-only gate. Return 200 with a polite refusal so n8n can still forward
  // the markdown to whoever issued the command (visible boundary, not a silent drop).
  if (body.user_id !== TYLER_USER_ID) {
    return c.json({
      ok: true,
      markdown:
        "_Quest Log is Tyler-only. nice try, friend._",
    });
  }

  const kv = c.env.QUEST_LOG_STATE;

  // Reuse the same 5-min KV cache layer as the HTML dashboard (same keys).
  // Graceful degradation: if any fetch fails, render a placeholder.
  let activeStateMd = "";
  let opsBoardMd = "";
  let costLedger = "Carpenter: — / $0.00 (cost-ledger unavailable)";

  try {
    activeStateMd = await getCachedOrFetch(
      kv,
      "cache:dashboard:active-state",
      CACHE_TTL,
      () => fetchGithubRaw(c.env, "brain/00-session/ACTIVE-STATE.md")
    );
  } catch {
    activeStateMd = "_(ACTIVE-STATE fetch failed)_";
  }

  try {
    opsBoardMd = await getCachedOrFetch(
      kv,
      "cache:dashboard:ops-board",
      CACHE_TTL,
      () => fetchGithubRaw(c.env, "brain/OPS-BOARD.md")
    );
  } catch {
    opsBoardMd = "";
  }

  try {
    costLedger = await getCachedOrFetch(
      kv,
      "cache:dashboard:cost-ledger",
      CACHE_TTL,
      () => fetchCostLedger(c.env)
    );
  } catch {
    // keep placeholder
  }

  const adventureBlock = parseActiveBlock(activeStateMd);
  const ops = parseOpsBoard(opsBoardMd);

  return c.json({
    ok: true,
    markdown: fmtMarkdown({
      adventureBlock,
      open: ops.open,
      victories: ops.victories,
      costLedger,
    }),
  });
}
