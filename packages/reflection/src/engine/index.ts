import { readAutoActionsForWeek } from "../adapters/auto-actions";
import { queryCarpenterRunsForWeek } from "../adapters/d1-queries";
import { readOpsBoardDeltasForWeek } from "../adapters/ops-board-diff";
import { fetchCostTrajectory } from "../adapters/cost-telemetry";
import type { GithubContext } from "../types";
import type { ComputedMetrics } from "../digest/schema";
import { computeAutoActionAccuracy } from "./auto-action-accuracy";
import { computeCarpenterStats } from "./carpenter-stats";
import { computeOpsBoardChurn } from "./ops-board-churn";
import { computeH3DryRunSignal } from "./h3-dryrun-signal";

interface EngineEnv {
  BRAIN_D1: D1Database;
  GITHUB_REFLECTION_PAT: string;
  GITHUB_OWNER: string;
  GITHUB_REPO: string;
  COST_TELEMETRY_URL?: string;
}

export async function computeReflection(
  week: string,
  env: EngineEnv
): Promise<ComputedMetrics> {
  const github: GithubContext = {
    owner: env.GITHUB_OWNER,
    repo: env.GITHUB_REPO,
    pat: env.GITHUB_REFLECTION_PAT,
  };

  const [autoActionsResult, carpenterResult, opsBoardResult, costResult] = await Promise.allSettled([
    readAutoActionsForWeek(github, week),
    queryCarpenterRunsForWeek(env.BRAIN_D1, week),
    readOpsBoardDeltasForWeek(github, week),
    fetchCostTrajectory(env.COST_TELEMETRY_URL),
  ]);

  const auto_action_accuracy = autoActionsResult.status === "fulfilled"
    ? computeAutoActionAccuracy(autoActionsResult.value)
    : { section: "auto_action_accuracy", error: String((autoActionsResult as PromiseRejectedResult).reason) };

  const carpenter_stats = carpenterResult.status === "fulfilled"
    ? computeCarpenterStats(carpenterResult.value)
    : { section: "carpenter_stats", error: String((carpenterResult as PromiseRejectedResult).reason) };

  const ops_board_churn = opsBoardResult.status === "fulfilled"
    ? computeOpsBoardChurn(opsBoardResult.value)
    : { section: "ops_board_churn", error: String((opsBoardResult as PromiseRejectedResult).reason) };

  const h3_dryrun_signal = autoActionsResult.status === "fulfilled"
    ? computeH3DryRunSignal(autoActionsResult.value)
    : { section: "h3_dryrun_signal", error: "auto_actions fetch failed" };

  const cost_trajectory = costResult.status === "fulfilled"
    ? costResult.value
    : { section: "cost_trajectory", error: String((costResult as PromiseRejectedResult).reason) };

  return {
    auto_action_accuracy,
    carpenter_stats,
    ops_board_churn,
    h3_dryrun_signal,
    cost_trajectory,
  };
}
