import { computeReflection } from "./engine/index";
import { writeReflectionMarkdown } from "./digest/writer";
import { buildEmptyDigest } from "./digest/empty";
import { commitReflectionDigest } from "./adapters/github-commit";
import { fileOpsRowViaGitHub, type SystemImprovementRow } from "./outputs/ops-filing";
import { sendReflectionTelegram } from "./outputs/telegram";
import { applySpiritDrift, computeDriftDelta, type SpiritDriftResult } from "./outputs/spirit-drift";
import { queryXpHotCold, renderXpDigestSection } from "./digest/xp-section";
import type { Env, InputVolumes } from "./types";
import type { ComputedMetrics } from "./digest/schema";
import { isSectionError } from "./digest/schema";
import type { AutoActionAccuracy, CarpenterStats, OpsBoardChurn, H3DryRunSignal } from "./digest/schema";

export interface FlowParams {
  week: string;
  commit: boolean;
  notify: boolean;
  smoke: boolean;
  env: Env;
}

export interface FlowResult {
  week: string;
  generated_at: string;
  digest_markdown: string;
  computed: ComputedMetrics;
  input_volumes: InputVolumes;
  committed: boolean;
  commit_url?: string;
  commit_sha?: string;
  filed_ops_rows: string[];
  notified: boolean;
  notify_message_id?: number;
  warnings: string[];
  spirit_drift?: SpiritDriftResult;
}

const MAX_OPS_ROWS = 3;

export async function runReflectionFlow(params: FlowParams): Promise<FlowResult> {
  const { week, commit, notify, smoke, env } = params;
  const generatedAt = new Date().toISOString();
  const workerVersion = env.WORKER_VERSION ?? "0.1.0";
  const warnings: string[] = [];

  // Step 1: Compute metrics
  const computed = await computeReflection(week, {
    BRAIN_D1: env.BRAIN_D1,
    GITHUB_REFLECTION_PAT: env.GITHUB_REFLECTION_PAT,
    GITHUB_OWNER: env.GITHUB_OWNER,
    GITHUB_REPO: env.GITHUB_REPO,
    COST_TELEMETRY_URL: undefined,
  });

  // Step 2: Write digest markdown
  const inputVolumes: InputVolumes = deriveInputVolumes(computed);
  const baseDigest = writeReflectionMarkdown(week, generatedAt, workerVersion, inputVolumes, computed);

  // Step P3: Brain XP hot/cold digest section (read-only, fire-and-forget touch for cited nodes)
  let xpSection = "";
  try {
    const { hot, cold } = await queryXpHotCold(env.BRAIN_D1, 5, 5);
    xpSection = renderXpDigestSection(hot, cold);

    const cited = [...hot, ...cold].map((n) => n.path);
    for (const path of cited) {
      fetch(`${env.BRAIN_WRITE_BASE}/api/brain/xp-touch`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-brain-write-secret": env.BRAIN_WRITE_API_SECRET,
        },
        body: JSON.stringify({ path, source: "reflection" }),
      }).catch(() => undefined);
    }
  } catch (err) {
    warnings.push(`xp-digest: ${String(err)}`);
  }

  const digestMarkdown = xpSection ? `${baseDigest}\n${xpSection}` : baseDigest;

  const result: FlowResult = {
    week,
    generated_at: generatedAt,
    digest_markdown: digestMarkdown,
    computed,
    input_volumes: inputVolumes,
    committed: false,
    filed_ops_rows: [],
    notified: false,
    warnings,
  };

  // Step 3: Commit (if requested)
  if (commit) {
    const branch = smoke
      ? `_smoke/reflection-c3-${dateSuffix()}`
      : "main";
    const path = `brain/06-meta/reflection/${week}.md`;
    const commitMsg = smoke
      ? `[smoke] reflection digest ${week}`
      : `reflection: weekly digest ${week}`;

    const github = {
      owner: env.GITHUB_OWNER,
      repo: env.GITHUB_REPO,
      pat: env.GITHUB_REFLECTION_PAT,
    };

    try {
      const commitResult = await commitReflectionDigest(github, path, digestMarkdown, commitMsg, branch);
      result.committed = true;
      result.commit_sha = commitResult.sha;
      result.commit_url = commitResult.url;
    } catch (err) {
      // Stop here — Telegram references commit URL
      warnings.push(`commit failed: ${String(err)}`);
      return result;
    }
  }

  // Step 4: File OPS rows (only if commit succeeded and we have a commit URL)
  if (result.committed && result.commit_url) {
    const candidates = extractOpsRowCandidates(week, computed);
    const toFile = candidates.slice(0, MAX_OPS_ROWS);
    const surplus = candidates.slice(MAX_OPS_ROWS);
    if (surplus.length > 0) {
      warnings.push(`ops-row surplus: ${surplus.length} findings skipped (cap=${MAX_OPS_ROWS}); rendered in digest text only`);
    }

    const github = {
      owner: env.GITHUB_OWNER,
      repo: env.GITHUB_REPO,
      pat: env.GITHUB_REFLECTION_PAT,
    };

    // brain-write /api/ops/file absent — use GitHub Contents API direct edit of OPS-BOARD.md
    warnings.push("ops-filing: brain-write /api/ops/file absent; using github-contents direct path on brain/OPS-BOARD.md");

    for (const row of toFile) {
      try {
        const filed = await fileOpsRowViaGitHub(github, row);
        if (filed.ok) {
          result.filed_ops_rows.push(row.id);
        } else {
          warnings.push(`ops-row ${row.id} filing failed: ${filed.error ?? "unknown"}`);
        }
      } catch (err) {
        warnings.push(`ops-row ${row.id} exception: ${String(err)}`);
      }
    }
  }

  // Step 5: Notify via Telegram (if requested and commit succeeded)
  if (notify) {
    if (!result.committed || !result.commit_url) {
      warnings.push("notify skipped: commit did not succeed (no commit URL)");
    } else {
      const notableHighlights = extractNotableHighlights(computed);
      try {
        const tgResult = await sendReflectionTelegram(
          {
            SHIPS_DOCTOR_BOT_TOKEN: env.SHIPS_DOCTOR_BOT_TOKEN,
            TYLER_CHAT_ID: env.TYLER_CHAT_ID,
          },
          {
            week,
            commitUrl: result.commit_url,
            filedOpsRows: result.filed_ops_rows,
            notableHighlights,
            isSmoke: smoke,
          }
        );
        if (tgResult.ok) {
          result.notified = true;
          result.notify_message_id = tgResult.message_id;
        } else {
          warnings.push(`telegram failed: ${tgResult.error ?? "unknown"}`);
        }
      } catch (err) {
        warnings.push(`telegram exception: ${String(err)}`);
      }
    }
  }

  // Step 6: Spirit Level drift (Pb — weekly auto-drift, ±1/week, soft-degrades; skipped on smoke)
  try {
    if (smoke) {
      const { delta, reason } = computeDriftDelta(computed);
      result.spirit_drift = { attempted: false, delta, reason: `[smoke-dry] ${reason}`, applied: false };
    } else {
      result.spirit_drift = await applySpiritDrift(
        { BRAIN_WRITE_BASE: env.BRAIN_WRITE_BASE, BRAIN_WRITE_API_SECRET: env.BRAIN_WRITE_API_SECRET },
        computed
      );
      if (result.spirit_drift.error) warnings.push(`spirit drift: ${result.spirit_drift.error}`);
    }
  } catch (err) {
    warnings.push(`spirit drift exception: ${String(err)}`);
  }

  return result;
}

function dateSuffix(): string {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  const d = String(now.getUTCDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}

function deriveInputVolumes(computed: ComputedMetrics): InputVolumes {
  return {
    auto_actions_files: 0,
    ops_board_commits: isSectionError(computed.ops_board_churn)
      ? 0
      : (computed.ops_board_churn as OpsBoardChurn).total_commits_touching_board,
    carpenter_runs: isSectionError(computed.carpenter_stats)
      ? 0
      : (computed.carpenter_stats as CarpenterStats).total_runs,
    hunter_baseline_runs: 0,
  };
}

function extractNotableHighlights(computed: ComputedMetrics): string[] {
  const highlights: string[] = [];
  const sections: Array<{ notables?: string[] }> = [
    isSectionError(computed.auto_action_accuracy) ? {} : { notables: (computed.auto_action_accuracy as AutoActionAccuracy).notable },
    isSectionError(computed.carpenter_stats) ? {} : { notables: (computed.carpenter_stats as CarpenterStats).notable },
    isSectionError(computed.ops_board_churn) ? {} : { notables: (computed.ops_board_churn as OpsBoardChurn).notable },
    isSectionError(computed.h3_dryrun_signal) ? {} : { notables: (computed.h3_dryrun_signal as H3DryRunSignal).notable },
  ];
  for (const s of sections) {
    if (s.notables) highlights.push(...s.notables);
    if (highlights.length >= 5) break;
  }
  return highlights.slice(0, 5);
}

function extractOpsRowCandidates(week: string, computed: ComputedMetrics): SystemImprovementRow[] {
  const rows: SystemImprovementRow[] = [];
  const weekTag = week.replace("-", "-").toUpperCase();

  // Carpenter: over_max_turns is a tuning signal
  if (!isSectionError(computed.carpenter_stats)) {
    const cs = computed.carpenter_stats as CarpenterStats;
    if (cs.turn_count_distribution.over_max_turns_count > 0) {
      rows.push({
        id: `OPS-REFLECTION-${weekTag}-CARPENTER-MAX-TURNS-TUNING-FOLLOWUP`,
        priority: "Normal",
        category: "ops",
        title: `Carpenter max-turns overshoot: ${cs.turn_count_distribution.over_max_turns_count} runs`,
        body: `Week ${week}: ${cs.turn_count_distribution.over_max_turns_count} carpenter runs hit max-turns limit (p75=${cs.turn_count_distribution.p75}). Review prompt or limit config.`,
      });
    }
  }

  // Auto-action drift
  if (!isSectionError(computed.auto_action_accuracy)) {
    const aa = computed.auto_action_accuracy as AutoActionAccuracy;
    if (aa.flagged_drift.length > 0) {
      rows.push({
        id: `OPS-REFLECTION-${weekTag}-AUTO-ACTION-DRIFT-REVIEW`,
        priority: "High",
        category: "eval-rig",
        title: `Auto-action drift verdicts detected: ${aa.flagged_drift.join(", ")}`,
        body: `Week ${week}: flagged drift verdicts found in auto-actions. Investigate consistency of verdict labeling.`,
      });
    }
  }

  // H3 dry-run: investigate recommendation
  if (!isSectionError(computed.h3_dryrun_signal)) {
    const h3 = computed.h3_dryrun_signal as H3DryRunSignal;
    if (h3.pre_flip_recommendation === "investigate") {
      rows.push({
        id: `OPS-REFLECTION-${weekTag}-H3-FLIP-INVESTIGATE`,
        priority: "High",
        category: "meta",
        title: `H3 dry-run recommends investigate before flip`,
        body: `Week ${week}: H3 validator returned pre_flip_recommendation=investigate. ${h3.blocked_complete_mds.length} blocked COMPLETE.mds. Review before enabling H3 live path.`,
      });
    }
  }

  return rows;
}
