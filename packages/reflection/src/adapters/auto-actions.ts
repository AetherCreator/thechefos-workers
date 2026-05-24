import type { GithubContext } from "../types";

export interface AutoActionEntry {
  run_id: string;
  date: string;
  verdict: "applied" | "blocked_schema" | "blocked_verifier" | "blocked_push_unverified" | string;
  action: string;
  source_path?: string;
  evidence_urls?: string[];
  flags?: string[];
  [key: string]: unknown;
}

// C2 implements the real walk through brain/06-meta/auto-actions/{date}/*.json for the ISO week.
export async function readAutoActionsForWeek(
  _github: GithubContext,
  _isoWeek: string
): Promise<AutoActionEntry[]> {
  // TODO(C2): list GitHub tree for brain/06-meta/auto-actions/{date}/ for each date in the week,
  // fetch each *.json file, defensively parse into AutoActionEntry, collect and return.
  return [];
}

export function parseAutoActionEntry(raw: unknown): AutoActionEntry {
  if (typeof raw !== "object" || raw === null) {
    throw new TypeError("expected object");
  }
  const obj = raw as Record<string, unknown>;
  const verdict = typeof obj["verdict"] === "string" ? obj["verdict"] : "other";
  return {
    run_id: typeof obj["run_id"] === "string" ? obj["run_id"] : "",
    date: typeof obj["date"] === "string" ? obj["date"] : "",
    verdict,
    action: typeof obj["action"] === "string" ? obj["action"] : "",
    source_path: typeof obj["source_path"] === "string" ? obj["source_path"] : undefined,
    evidence_urls: Array.isArray(obj["evidence_urls"]) ? obj["evidence_urls"] as string[] : undefined,
    flags: Array.isArray(obj["flags"]) ? obj["flags"] as string[] : undefined,
    ...Object.fromEntries(
      Object.entries(obj).filter(
        ([k]) => !["run_id", "date", "verdict", "action", "source_path", "evidence_urls", "flags"].includes(k)
      )
    ),
  };
}

// Parse "YYYY-Www" to {start, end} in ISO 8601 date strings (Monday..Sunday).
export function isoWeekToDateRange(isoWeek: string): { start: string; end: string } {
  const m = isoWeek.match(/^(\d{4})-W(\d{2})$/);
  if (!m) throw new Error(`invalid ISO week: ${isoWeek}`);
  const year = parseInt(m[1], 10);
  const week = parseInt(m[2], 10);
  const monday = isoWeekToMonday(year, week);
  const sunday = new Date(monday.getTime() + 6 * 86400000);
  return {
    start: monday.toISOString().slice(0, 10),
    end: sunday.toISOString().slice(0, 10),
  };
}

function isoWeekToMonday(year: number, week: number): Date {
  // Jan 4 is always in ISO week 1
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const dow = jan4.getUTCDay() || 7; // Mon=1..Sun=7
  const week1Monday = new Date(jan4.getTime() - (dow - 1) * 86400000);
  return new Date(week1Monday.getTime() + (week - 1) * 7 * 86400000);
}
