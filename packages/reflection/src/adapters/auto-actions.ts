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

export async function readAutoActionsForWeek(
  github: GithubContext,
  isoWeek: string
): Promise<AutoActionEntry[]> {
  const { start, end } = isoWeekToDateRange(isoWeek);
  const dates = dateRange(start, end);
  const entries: AutoActionEntry[] = [];

  for (const date of dates) {
    const dirPath = `brain/06-meta/auto-actions/${date}`;
    const dirUrl = `https://api.github.com/repos/${github.owner}/${github.repo}/contents/${dirPath}`;

    let files: Array<{ name: string; type: string; download_url: string }>;
    try {
      const res = await fetch(dirUrl, {
        headers: {
          Authorization: `Bearer ${github.pat}`,
          Accept: "application/vnd.github.v3+json",
          "User-Agent": "thechefos-reflection/0.1.0",
        },
      });
      if (res.status === 404) continue;
      if (!res.ok) {
        console.warn(`[auto-actions] ${date}: ${res.status} ${res.statusText}`);
        continue;
      }
      files = await res.json() as Array<{ name: string; type: string; download_url: string }>;
    } catch (e) {
      console.warn(`[auto-actions] fetch failed for ${date}: ${e}`);
      continue;
    }

    for (const file of files) {
      if (file.type !== "file" || !file.name.endsWith(".json")) continue;
      try {
        const raw = await fetch(file.download_url, {
          headers: { "User-Agent": "thechefos-reflection/0.1.0" },
        });
        if (!raw.ok) continue;
        const data = await raw.json();
        if (Array.isArray(data)) {
          for (const item of data) entries.push(parseAutoActionEntry(item));
        } else {
          entries.push(parseAutoActionEntry(data));
        }
      } catch (e) {
        console.warn(`[auto-actions] parse failed for ${file.name}: ${e}`);
      }
    }
  }

  return entries;
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
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const dow = jan4.getUTCDay() || 7;
  const week1Monday = new Date(jan4.getTime() - (dow - 1) * 86400000);
  return new Date(week1Monday.getTime() + (week - 1) * 7 * 86400000);
}

function dateRange(start: string, end: string): string[] {
  const dates: string[] = [];
  const cur = new Date(start + "T00:00:00Z");
  const endDate = new Date(end + "T00:00:00Z");
  while (cur <= endDate) {
    dates.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return dates;
}
