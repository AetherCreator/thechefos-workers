import type { InputVolumes } from "../types";
import type { ComputedMetrics } from "./schema";
import { writeReflectionMarkdown } from "./writer";

export function buildEmptyDigest(
  week: string,
  generatedAt: string,
  workerVersion: string,
  inputVolumes: InputVolumes,
  metrics?: ComputedMetrics
): string {
  if (metrics !== undefined) {
    return writeReflectionMarkdown(week, generatedAt, workerVersion, inputVolumes, metrics);
  }

  const fm = [
    "---",
    `week_iso: ${week}`,
    `generated_at: ${generatedAt}`,
    `worker_version: ${workerVersion}`,
    "input_volumes:",
    `  auto_actions_files: ${inputVolumes.auto_actions_files}`,
    `  ops_board_commits: ${inputVolumes.ops_board_commits}`,
    `  carpenter_runs: ${inputVolumes.carpenter_runs}`,
    `  hunter_baseline_runs: ${inputVolumes.hunter_baseline_runs}`,
    "---",
  ].join("\n");

  return `${fm}

# Weekly Reflection — ${week}

> Scaffold emission from C1. C2 fills the live metrics. C4 fires the first real run.

## 1. Auto-action accuracy

_C2: compute applied vs blocked_* verdicts from auto-actions/_

## 2. Carpenter run stats

_C2: turn-count distribution, exit_reason histogram, work_commit null rate_

## 3. OPS-BOARD churn

_C2: ACTIVE→COMPLETED → reverted, BACKLOG fall-off, new URGENT rows_

## 4. H3 dry-run signal

_C2: complete_validator verdicts on hunts/*/clue-*/COMPLETE.md pushes_

## 5. Cost trajectory

> ⏸️ **Ships with OPS-COST-TELEMETRY-ROLLUPS.**
> Requires cost-telemetry rollup pipeline. carpenter_runs.cost_usd is the seed.

## 6. Council judge calibration

> ⏸️ **Ships with OPS-COUNCIL-PERSIST-VERDICTS.**
> Council Worker live but verdicts not persisted to brain/ or D1.

## 7. P1 false-positive rate

> ⏸️ **Ships with P1 (Locke changelog-watcher).**

## 8. P2 voyage success rate

> ⏸️ **Ships with P2 (Voyage Worker).**

## 9. Crew XP / Spirit Level

> ⏸️ **Ships with P5 (RPG mechanic).**

## Appendix — raw inputs

(empty in scaffold)`;
}
