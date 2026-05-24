import { Hono } from "hono";
import { requireReflectionKey } from "./auth";
import { handleCronTrigger } from "./cron";
import { runReflectionFlow } from "./flow";
import type { Env } from "./types";

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
  const commit = url.searchParams.get("commit") === "true";
  const notify = url.searchParams.get("notify") === "true";
  const smoke = url.searchParams.get("smoke") === "true";

  const result = await runReflectionFlow({ week, commit, notify, smoke, env: c.env });

  return c.json({
    ok: true,
    week: result.week,
    generated_at: result.generated_at,
    worker_version: c.env.WORKER_VERSION ?? "0.1.0",
    input_volumes: result.input_volumes,
    digest_markdown: result.digest_markdown,
    committed: result.committed,
    commit_url: result.commit_url,
    commit_sha: result.commit_sha,
    filed_ops_rows: result.filed_ops_rows,
    notified: result.notified,
    notify_message_id: result.notify_message_id,
    warnings: result.warnings,
  }, 200);
});

app.all("*", (c) => c.json({ ok: false, error: "not_found" }, 404));

export default {
  fetch: app.fetch.bind(app),
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    await handleCronTrigger(event, env, ctx);
  },
};
