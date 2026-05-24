import { describe, it, expect } from "vitest";
import { writeReflectionMarkdown } from "../../src/digest/writer";
import { DigestFrontmatterSchema } from "../../src/digest/schema";
import type { ComputedMetrics } from "../../src/digest/schema";
import type { InputVolumes } from "../../src/types";

function makeEmptyMetrics(): ComputedMetrics {
  return {
    auto_action_accuracy: { total: 0, by_verdict: {}, by_action: {}, flagged_drift: [], notable: [] },
    carpenter_stats: {
      total_runs: 0,
      by_exit_reason: {},
      turn_count_distribution: { min: 0, p25: 0, median: 0, p75: 0, max: 0, over_max_turns_count: 0 },
      work_commit_null_rate: 0,
      cost_summary: { total_usd: 0, avg_per_run: 0, null_cost_rows: 0 },
      variant_breakdown: {},
      notable: [],
    },
    ops_board_churn: {
      total_commits_touching_board: 0,
      movements: { urgent_add: 0, backlog_add: 0, claim: 0, complete: 0, revert: 0, remove: 0 },
      velocity: { completes_per_day: 0, urgent_aging: 0 },
      notable: [],
    },
    h3_dryrun_signal: {
      total_complete_md_pushes: 0,
      verdicts: { would_apply: 0, would_block_schema: 0, would_block_evidence: 0, would_block_push_unverified: 0 },
      blocked_complete_mds: [],
      pre_flip_recommendation: "flip_safe",
      notable: [],
    },
    cost_trajectory: { section: "cost_trajectory", error: "test-mode: no fetch" },
  };
}

const inputVolumes: InputVolumes = {
  auto_actions_files: 0,
  ops_board_commits: 0,
  carpenter_runs: 0,
  hunter_baseline_runs: 0,
};

describe("writeReflectionMarkdown", () => {
  it("empty metrics → digest parses as markdown with valid frontmatter", () => {
    const md = writeReflectionMarkdown(
      "2026-W21",
      "2026-05-24T22:00:00.000Z",
      "0.1.0",
      inputVolumes,
      makeEmptyMetrics()
    );

    expect(md.startsWith("---\n")).toBe(true);
    expect(md).toContain("week_iso: 2026-W21");
    expect(md).toContain("generated_at: 2026-05-24T22:00:00.000Z");
    expect(md).toContain("worker_version: 0.1.0");
    expect(md).toContain("# Weekly Reflection — 2026-W21");

    const fmMatch = md.match(/^---\n([\s\S]*?)\n---/);
    expect(fmMatch).not.toBeNull();

    const yamlLines = fmMatch![1];
    const parsed = Object.fromEntries(
      yamlLines
        .split("\n")
        .filter((l) => l.includes(": ") && !l.startsWith(" "))
        .map((l) => {
          const idx = l.indexOf(": ");
          return [l.slice(0, idx), l.slice(idx + 2)];
        })
    );
    const nested = {
      week_iso: parsed["week_iso"],
      generated_at: parsed["generated_at"],
      worker_version: parsed["worker_version"],
      input_volumes: {
        auto_actions_files: 0,
        ops_board_commits: 0,
        carpenter_runs: 0,
        hunter_baseline_runs: 0,
      },
    };
    const validation = DigestFrontmatterSchema.safeParse(nested);
    expect(validation.success).toBe(true);
  });

  it("full metrics → digest contains all 4 live sections + 5 placeholders + appendix", () => {
    const metrics = makeEmptyMetrics();
    metrics.auto_action_accuracy = {
      total: 25,
      by_verdict: { applied: 17, blocked_schema: 5, blocked_verifier: 3 },
      by_action: { complete_validator: { applied: 15, blocked: 3, ratio: 0.83 } },
      flagged_drift: [],
      notable: ["test notable"],
    };
    metrics.carpenter_stats = {
      total_runs: 6,
      by_exit_reason: { complete: 4, max_turns: 1, error: 1 },
      turn_count_distribution: { min: 5, p25: 15, median: 20, p75: 25, max: 30, over_max_turns_count: 1 },
      work_commit_null_rate: 0.33,
      cost_summary: { total_usd: 0.3, avg_per_run: 0.06, null_cost_rows: 1 },
      variant_breakdown: { "claude-sonnet-4-6": { runs: 5, completes: 4 } },
      notable: [],
    };

    const md = writeReflectionMarkdown("2026-W21", "2026-05-24T22:00:00.000Z", "0.1.0", inputVolumes, metrics);

    expect(md).toContain("## 1. Auto-action accuracy");
    expect(md).toContain("## 2. Carpenter run stats");
    expect(md).toContain("## 3. OPS-BOARD churn");
    expect(md).toContain("## 4. H3 dry-run signal");
    expect(md).toContain("## 5. Cost trajectory");
    expect(md).toContain("## 6. Council judge calibration");
    expect(md).toContain("## 7. P1 false-positive rate");
    expect(md).toContain("## 8. P2 voyage success rate");
    expect(md).toContain("## 9. Crew XP / Spirit Level");
    expect(md).toContain("## Appendix — raw inputs");
  });
});
