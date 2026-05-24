import { z } from "zod";

export const DigestFrontmatterSchema = z.object({
  week_iso: z.string().regex(/^\d{4}-W\d{2}$/),
  generated_at: z.string().datetime(),
  worker_version: z.string(),
  input_volumes: z.object({
    auto_actions_files: z.number().int().nonnegative(),
    ops_board_commits: z.number().int().nonnegative(),
    carpenter_runs: z.number().int().nonnegative(),
    hunter_baseline_runs: z.number().int().nonnegative(),
  }),
});

export type DigestFrontmatter = z.infer<typeof DigestFrontmatterSchema>;

export interface DigestSection {
  heading: string;
  body: string;
  deferred?: string;
}

export interface AutoActionAccuracy {
  total: number;
  by_verdict: Record<string, number>;
  by_action: Record<string, { applied: number; blocked: number; ratio: number }>;
  flagged_drift: string[];
  notable: string[];
}

export interface CarpenterStats {
  total_runs: number;
  by_exit_reason: Record<string, number>;
  turn_count_distribution: {
    min: number;
    p25: number;
    median: number;
    p75: number;
    max: number;
    over_max_turns_count: number;
  };
  work_commit_null_rate: number;
  cost_summary: {
    total_usd: number;
    avg_per_run: number;
    null_cost_rows: number;
  };
  variant_breakdown: Record<string, { runs: number; completes: number }>;
  notable: string[];
}

export interface OpsBoardChurn {
  total_commits_touching_board: number;
  movements: {
    urgent_add: number;
    backlog_add: number;
    claim: number;
    complete: number;
    revert: number;
    remove: number;
  };
  velocity: {
    completes_per_day: number;
    urgent_aging: number;
  };
  notable: string[];
}

export interface H3DryRunSignal {
  total_complete_md_pushes: number;
  verdicts: {
    would_apply: number;
    would_block_schema: number;
    would_block_evidence: number;
    would_block_push_unverified: number;
  };
  blocked_complete_mds: Array<{
    source_path: string;
    verdict: string;
    audit_commit: string;
  }>;
  pre_flip_recommendation: "flip_safe" | "extend_grace" | "investigate";
  notable: string[];
}

export interface CostTrajectory {
  current_week_neurons_used: number;
  current_week_neurons_cap: number;
  traffic_light: "green" | "yellow" | "red" | "depleted";
  by_persona: Record<string, { used: number; cap: number; percent: number }>;
  previous_week_neurons_used: number | null;
  week_over_week_delta_percent: number | null;
  notable: string[];
}

export interface SectionError {
  section: string;
  error: string;
}

export interface ComputedMetrics {
  auto_action_accuracy: AutoActionAccuracy | SectionError;
  carpenter_stats: CarpenterStats | SectionError;
  ops_board_churn: OpsBoardChurn | SectionError;
  h3_dryrun_signal: H3DryRunSignal | SectionError;
  cost_trajectory: CostTrajectory | SectionError;
}

export function isSectionError(v: unknown): v is SectionError {
  return typeof v === "object" && v !== null && "section" in v && "error" in v;
}
