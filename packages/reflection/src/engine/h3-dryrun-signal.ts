import type { AutoActionEntry } from "../adapters/auto-actions";
import type { H3DryRunSignal } from "../digest/schema";

function verdictToH3Key(verdict: string): "would_apply" | "would_block_schema" | "would_block_evidence" | "would_block_push_unverified" | null {
  switch (verdict) {
    case "applied": return "would_apply";
    case "blocked_schema": return "would_block_schema";
    case "blocked_verifier": return "would_block_evidence";
    case "blocked_push_unverified": return "would_block_push_unverified";
    default: return null;
  }
}

export function computeH3DryRunSignal(
  allEntries: AutoActionEntry[],
  recentDays: number = 7
): H3DryRunSignal {
  const entries = allEntries.filter((e) => e.action === "complete_validator");
  const total = entries.length;
  const verdicts = {
    would_apply: 0,
    would_block_schema: 0,
    would_block_evidence: 0,
    would_block_push_unverified: 0,
  };
  const blocked_complete_mds: Array<{ source_path: string; verdict: string; audit_commit: string }> = [];
  const notable: string[] = [];

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - recentDays);

  for (const e of entries) {
    const key = verdictToH3Key(e.verdict);
    if (key === "would_apply") {
      verdicts.would_apply++;
    } else if (key !== null) {
      verdicts[key]++;
      const auditCommit =
        Array.isArray(e.evidence_urls) && e.evidence_urls.length > 0
          ? (e.evidence_urls[0] as string)
          : "";
      blocked_complete_mds.push({
        source_path: e.source_path ?? "",
        verdict: e.verdict,
        audit_commit: auditCommit,
      });
    }
  }

  for (const b of blocked_complete_mds) {
    notable.push(
      `blocked COMPLETE.md: ${b.source_path} — verdict=${b.verdict} — see OPS-H3-PRE-FLIP-AUDIT-INVESTIGATION (URGENT, due 2026-05-28)`
    );
  }

  let recommendation: H3DryRunSignal["pre_flip_recommendation"] = "flip_safe";

  if (total === 0) {
    recommendation = "flip_safe";
  } else {
    const apply_ratio = verdicts.would_apply / total;

    if (apply_ratio >= 0.85) {
      recommendation = "flip_safe";
    } else if (apply_ratio < 0.7) {
      recommendation = "extend_grace";
    } else {
      // 0.7 <= ratio < 0.85: investigate if blocked entries have audit commits (real shipped work)
      const withAuditCommit = blocked_complete_mds.filter((b) => b.audit_commit !== "");
      if (withAuditCommit.length > 0) {
        recommendation = "investigate";
        notable.push(
          `investigate: ${withAuditCommit.length} blocked COMPLETE.md(s) with audit commits in ambiguous range — real shipped work may be affected`
        );
      } else {
        recommendation = "extend_grace";
      }
    }
  }

  return {
    total_complete_md_pushes: total,
    verdicts,
    blocked_complete_mds,
    pre_flip_recommendation: recommendation,
    notable,
  };
}
