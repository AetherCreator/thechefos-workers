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
