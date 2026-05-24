import { z } from "zod";

export interface Env {
  BRAIN_D1: D1Database;
  REFLECTION_API_SECRET: string;
  GITHUB_REFLECTION_PAT: string;
  BRAIN_WRITE_API_SECRET: string;
  SHIPS_DOCTOR_BOT_TOKEN: string;
  TYLER_CHAT_ID: string;
  WORKER_VERSION: string;
  GITHUB_OWNER: string;
  GITHUB_REPO: string;
  BRAIN_WRITE_BASE: string;
}

export const ReflectNowQuerySchema = z.object({
  week: z.string().optional(),
  dry: z.enum(["true", "false"]).optional(),
  commit: z.enum(["true", "false"]).optional(),
  notify: z.enum(["true", "false"]).optional(),
});

export interface InputVolumes {
  auto_actions_files: number;
  ops_board_commits: number;
  carpenter_runs: number;
  hunter_baseline_runs: number;
}

export interface ReflectNowResponse {
  ok: true;
  week: string;
  generated_at: string;
  worker_version: string;
  input_volumes: InputVolumes;
  digest_markdown: string;
  committed: boolean;
  commit_reason?: string;
  notified: boolean;
  notify_reason?: string;
  filed_ops_rows: unknown[];
}

export interface GithubContext {
  owner: string;
  repo: string;
  pat: string;
}
