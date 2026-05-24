import type { GithubContext } from "../types";

export interface SystemImprovementRow {
  id: string;
  priority: "Urgent" | "High" | "Normal" | "Low";
  category: string;
  title: string;
  body: string;
}

export interface OpsFilingEnv {
  BRAIN_WRITE_BASE: string;
  BRAIN_WRITE_API_SECRET: string;
}

export async function fileSystemImprovementRow(
  env: OpsFilingEnv,
  row: SystemImprovementRow
): Promise<{ ok: boolean; board_sha?: string; error?: string; path_used?: string }> {
  // brain-write /api/ops/file does not exist — use GitHub Contents API direct edit of OPS-BOARD.md
  return { ok: false, error: "brain-write /api/ops/file absent — use fileOpsRowViaGitHub", path_used: "none" };
}

// Fallback: append OPS row to brain/OPS-BOARD.md via GitHub Contents API.
// brain-write /api/ops/file does not exist; this is the active path.
export async function fileOpsRowViaGitHub(
  github: GithubContext,
  row: SystemImprovementRow
): Promise<{ ok: boolean; board_sha?: string; error?: string; path_used: string }> {
  const PATH = "brain/OPS-BOARD.md";
  const headers = {
    Authorization: `Bearer ${github.pat}`,
    "User-Agent": "thechefos-reflection-worker",
    Accept: "application/vnd.github+json",
  };

  // Fetch current OPS-BOARD.md
  const getResp = await fetch(
    `https://api.github.com/repos/${github.owner}/${github.repo}/contents/${PATH}?ref=main`,
    { headers }
  );

  if (!getResp.ok) {
    const errText = await getResp.text();
    return { ok: false, error: `ops-board fetch failed ${getResp.status}: ${errText.slice(0, 200)}`, path_used: "github-contents" };
  }

  const fileData = (await getResp.json()) as { sha: string; content: string };
  const existingSha = fileData.sha;
  const currentContent = decodeBase64Utf8(fileData.content);

  const newRow = buildOpsRow(row);
  const updatedContent = insertOpsRow(currentContent, row.priority, newRow);

  const putBody = {
    message: `ops: file ${row.id} [reflection-worker]`,
    content: btoa(unescape(encodeURIComponent(updatedContent))),
    sha: existingSha,
    branch: "main",
    committer: {
      name: "thechefos-reflection-worker[bot]",
      email: "noreply@thechefos.app",
    },
  };

  const putResp = await fetch(
    `https://api.github.com/repos/${github.owner}/${github.repo}/contents/${PATH}`,
    { method: "PUT", headers, body: JSON.stringify(putBody) }
  );

  if (!putResp.ok) {
    const errText = await putResp.text();
    return { ok: false, error: `ops-board update failed ${putResp.status}: ${errText.slice(0, 200)}`, path_used: "github-contents" };
  }

  const result = (await putResp.json()) as { content: { sha: string } };
  return { ok: true, board_sha: result.content.sha, path_used: "github-contents" };
}

function decodeBase64Utf8(b64: string): string {
  // GitHub returns base64 with newlines — strip them
  const clean = b64.replace(/\n/g, "");
  return decodeURIComponent(escape(atob(clean)));
}

function buildOpsRow(row: SystemImprovementRow): string {
  const priorityMap: Record<string, string> = { Urgent: "🔴", High: "🟠", Normal: "🟡", Low: "🟢" };
  const dot = priorityMap[row.priority] ?? "⚪";
  return `| ${dot} **${row.id}** | ${row.category} | ${row.title} | ${row.body.replace(/\|/g, "\\|").split("\n")[0]} |`;
}

function insertOpsRow(board: string, priority: string, newRow: string): string {
  // Insert under the appropriate priority section header, or at end of BACKLOG table if section not found
  const sectionKeyword = priority === "Urgent" ? "## 🔴 URGENT" : "## BACKLOG";
  const sectionIdx = board.indexOf(sectionKeyword);
  if (sectionIdx === -1) {
    // Append at end
    return board.trimEnd() + "\n" + newRow + "\n";
  }

  // Find the table separator line after the section header, then insert after it
  const afterSection = board.slice(sectionIdx);
  const separatorMatch = afterSection.match(/\|[-| :]+\|\n/);
  if (!separatorMatch || separatorMatch.index === undefined) {
    return board.trimEnd() + "\n" + newRow + "\n";
  }

  const insertionPoint = sectionIdx + separatorMatch.index + separatorMatch[0].length;
  return board.slice(0, insertionPoint) + newRow + "\n" + board.slice(insertionPoint);
}
