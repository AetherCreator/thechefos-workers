import { Hono } from "hono";
import { requireReflectionKey } from "./auth";
import { handleCronTrigger } from "./cron";
import { buildEmptyDigest } from "./digest/empty";
import { computeReflection } from "./engine/index";
import { queryCarpenterRunsForWeek, queryHunterBaselineForWeek } from "./adapters/d1-queries";
import { readAutoActionsForWeek } from "./adapters/auto-actions";
import { readOpsBoardDeltasForWeek } from "./adapters/ops-board-diff";
import type { Env, InputVolumes, ReflectNowResponse, GithubContext } from "./types";

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

  const github: GithubContext = {
    owner: c.env.GITHUB_OWNER,
    repo: c.env.GITHUB_REPO,
    pat: c.env.GITHUB_REFLECTION_PAT,
  };

  const [carpenterRuns, hunterBaseline, autoActions, opsDeltas] = await Promise.allSettled([
    queryCarpenterRunsForWeek(c.env.BRAIN_D1, week),
    queryHunterBaselineForWeek(c.env.BRAIN_D1, week),
    readAutoActionsForWeek(github, week),
    readOpsBoardDeltasForWeek(github, week),
  ]);

  const inputVolumes: InputVolumes = {
    auto_actions_files:
      autoActions.status === "fulfilled" ? autoActions.value.length : 0,
    ops_board_commits:
      opsDeltas.status === "fulfilled" ? opsDeltas.value.length : 0,
    carpenter_runs:
      carpenterRuns.status === "fulfilled" ? carpenterRuns.value.length : 0,
    hunter_baseline_runs:
      hunterBaseline.status === "fulfilled" ? hunterBaseline.value.length : 0,
  };

  const metrics = await computeReflection(week, {
    BRAIN_D1: c.env.BRAIN_D1,
    GITHUB_REFLECTION_PAT: c.env.GITHUB_REFLECTION_PAT,
    GITHUB_OWNER: c.env.GITHUB_OWNER,
    GITHUB_REPO: c.env.GITHUB_REPO,
    COST_TELEMETRY_URL: undefined,
  });

  const digestMarkdown = buildEmptyDigest(week, generatedAt, workerVersion, inputVolumes, metrics);

  const body: ReflectNowResponse = {
    ok: true,
    week,
    generated_at: generatedAt,
    worker_version: workerVersion,
    input_volumes: inputVolumes,
    digest_markdown: digestMarkdown,
    committed: false,
    commit_reason: "dry-run: commit=false",
    notified: false,
    notify_reason: "dry-run: notify=false",
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
