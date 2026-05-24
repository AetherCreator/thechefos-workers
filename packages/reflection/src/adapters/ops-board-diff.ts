import type { GithubContext } from "../types";
import { isoWeekToDateRange } from "./auto-actions";

export interface OpsBoardDelta {
  commit_sha: string;
  commit_date: string;
  movement: "urgent_add" | "backlog_add" | "claim" | "complete" | "revert" | "remove" | "other";
  row_id?: string;
  before_status?: string;
  after_status?: string;
}

interface GhCommit {
  sha: string;
  commit: { author: { date: string } };
}

const SECTION_RE = /^##\s+(URGENT|ACTIVE|BACKLOG|COMPLETED|Removed)/m;
const ROW_RE = /^\|\s*(OPS-[A-Z0-9_-]+)/;

function extractRows(markdown: string): Map<string, string> {
  const rows = new Map<string, string>();
  let currentSection = "UNKNOWN";
  for (const line of markdown.split("\n")) {
    const sectionMatch = SECTION_RE.exec(line);
    if (sectionMatch) {
      currentSection = sectionMatch[1].toUpperCase();
      continue;
    }
    const rowMatch = ROW_RE.exec(line);
    if (rowMatch) {
      rows.set(rowMatch[1], currentSection);
    }
  }
  return rows;
}

function classifyMovement(
  before: Map<string, string>,
  after: Map<string, string>
): OpsBoardDelta[] {
  const deltas: OpsBoardDelta[] = [];
  const allIds = new Set([...before.keys(), ...after.keys()]);

  for (const rowId of allIds) {
    const prev = before.get(rowId);
    const curr = after.get(rowId);

    if (!prev && curr) {
      // new row added
      const movement: OpsBoardDelta["movement"] =
        curr === "URGENT" ? "urgent_add" : curr === "BACKLOG" ? "backlog_add" : "other";
      deltas.push({ commit_sha: "", commit_date: "", movement, row_id: rowId, after_status: curr });
    } else if (prev && !curr) {
      deltas.push({ commit_sha: "", commit_date: "", movement: "remove", row_id: rowId, before_status: prev });
    } else if (prev && curr && prev !== curr) {
      let movement: OpsBoardDelta["movement"] = "other";
      if (curr === "ACTIVE" && (prev === "BACKLOG" || prev === "URGENT")) {
        movement = "claim";
      } else if (curr === "COMPLETED") {
        movement = "complete";
      } else if ((curr === "ACTIVE" || curr === "BACKLOG") && prev === "COMPLETED") {
        movement = "revert";
      } else if (curr === "REMOVED") {
        movement = "remove";
      }
      deltas.push({
        commit_sha: "",
        commit_date: "",
        movement,
        row_id: rowId,
        before_status: prev,
        after_status: curr,
      });
    }
  }
  return deltas;
}

async function fetchFileAtCommit(
  github: GithubContext,
  sha: string,
  path: string
): Promise<string | null> {
  const url = `https://api.github.com/repos/${github.owner}/${github.repo}/contents/${path}?ref=${sha}`;
  try {
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${github.pat}`,
        Accept: "application/vnd.github.v3+json",
        "User-Agent": "thechefos-reflection/0.1.0",
      },
    });
    if (!res.ok) return null;
    const data = await res.json() as { content?: string; encoding?: string };
    if (data.encoding === "base64" && data.content) {
      return atob(data.content.replace(/\n/g, ""));
    }
    return null;
  } catch {
    return null;
  }
}

export async function readOpsBoardDeltasForWeek(
  github: GithubContext,
  isoWeek: string
): Promise<OpsBoardDelta[]> {
  const { start, end } = isoWeekToDateRange(isoWeek);
  const endExclusive = new Date(end + "T00:00:00Z");
  endExclusive.setUTCDate(endExclusive.getUTCDate() + 1);

  const commitsUrl =
    `https://api.github.com/repos/${github.owner}/${github.repo}/commits` +
    `?path=brain/OPS-BOARD.md&since=${start}T00:00:00Z&until=${endExclusive.toISOString()}`;

  let commits: GhCommit[];
  try {
    const res = await fetch(commitsUrl, {
      headers: {
        Authorization: `Bearer ${github.pat}`,
        Accept: "application/vnd.github.v3+json",
        "User-Agent": "thechefos-reflection/0.1.0",
      },
    });
    if (!res.ok) return [];
    commits = (await res.json()) as GhCommit[];
  } catch {
    return [];
  }

  if (commits.length === 0) return [];

  // Process commits oldest-first (API returns newest-first)
  commits.reverse();

  const allDeltas: OpsBoardDelta[] = [];

  for (let i = 0; i < commits.length; i++) {
    const commit = commits[i];
    const prevSha = i > 0 ? commits[i - 1].sha : `${commit.sha}~1`;

    const [before, after] = await Promise.all([
      fetchFileAtCommit(github, prevSha, "brain/OPS-BOARD.md"),
      fetchFileAtCommit(github, commit.sha, "brain/OPS-BOARD.md"),
    ]);

    const beforeRows = extractRows(before ?? "");
    const afterRows = extractRows(after ?? "");
    const deltas = classifyMovement(beforeRows, afterRows);

    for (const d of deltas) {
      d.commit_sha = commit.sha;
      d.commit_date = commit.commit.author.date;
    }

    if (deltas.length === 0) {
      allDeltas.push({
        commit_sha: commit.sha,
        commit_date: commit.commit.author.date,
        movement: "other",
      });
    } else {
      allDeltas.push(...deltas);
    }
  }

  return allDeltas;
}
