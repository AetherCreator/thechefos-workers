import type { GithubContext } from "../types";

export interface OpsBoardDelta {
  commit_sha: string;
  commit_date: string;
  movement: "urgent_add" | "backlog_add" | "claim" | "complete" | "revert" | "remove" | "other";
  row_id?: string;
  before_status?: string;
  after_status?: string;
}

// C2 implements the real walk via GitHub commits API filtering brain/OPS-BOARD.md touches.
export async function readOpsBoardDeltasForWeek(
  _github: GithubContext,
  _isoWeek: string
): Promise<OpsBoardDelta[]> {
  // TODO(C2): call GET /repos/{owner}/{repo}/commits?path=brain/OPS-BOARD.md&since=&until=
  // for the ISO week range, then diff adjacent commit content to classify movement.
  return [];
}
