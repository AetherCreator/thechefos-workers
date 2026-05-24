import { Hono } from "hono";
import { requireReflectionKey } from "./auth";
import { handleCronTrigger } from "./cron";
import { buildEmptyDigest } from "./digest/empty";
import type { Env, InputVolumes, ReflectNowResponse } from "./types";

const WEEK_RE = /^\d{4}-W(0[1-9]|[1-4]\d|5[0-3])$/;

function getCurrentISOWeek(): string {
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const dow = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dow);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

const app = new Hono<{ Bindings: Env }>();

app.get("/health", (c) =>
  c.json({ ok: true, worker: "thechefos-reflection", version: c.env.WORKER_VERSION })
);

app.post("/api/reflect-now", async (c) => {
  const authErr = requireReflectionKey(c.req.raw, c.env);
  if (authErr) return authErr;

  const url = new URL(c.req.url);
  const weekParam = url.searchParams.get("week");

  if (weekParam !== null && !WEEK_RE.test(weekParam)) {
    return c.json({ ok: false, error: "bad_week_format", expected: "YYYY-Www" }, 400);
  }

  const week = weekParam ?? getCurrentISOWeek();
  const generatedAt = new Date().toISOString();
  const workerVersion = c.env.WORKER_VERSION ?? "0.1.0";

  const inputVolumes: InputVolumes = {
    auto_actions_files: 0,
    ops_board_commits: 0,
    carpenter_runs: 0,
    hunter_baseline_runs: 0,
  };

  const digestMarkdown = buildEmptyDigest(week, generatedAt, workerVersion, inputVolumes);

  const body: ReflectNowResponse = {
    ok: true,
    week,
    generated_at: generatedAt,
    worker_version: workerVersion,
    input_volumes: inputVolumes,
    digest_markdown: digestMarkdown,
    committed: false,
    commit_reason: "scaffold",
    notified: false,
    notify_reason: "scaffold",
    filed_ops_rows: [],
  };

  return c.json(body, 200);
});

app.all("*", (c) => c.json({ ok: false, error: "not_found" }, 404));

export default {
  fetch: app.fetch.bind(app),
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    await handleCronTrigger(event, env, ctx);
  },
};
