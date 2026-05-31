import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import worker from "../src/index";
import type { Env } from "../src/types";

function makeMockD1(): D1Database {
  return {
    prepare: (_sql: string) => ({
      bind: (..._args: unknown[]) => ({
        all: async () => ({ results: [], success: true, meta: {} }),
      }),
    }),
  } as unknown as D1Database;
}

function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    BRAIN_D1: makeMockD1(),
    REFLECTION_API_SECRET: "test-secret",
    GITHUB_REFLECTION_PAT: "gh-pat",
    BRAIN_WRITE_API_SECRET: "bw-secret",
    SHIPS_DOCTOR_BOT_TOKEN: "bot-token",
    TYLER_CHAT_ID: "12345",
    WORKER_VERSION: "0.1.0",
    GITHUB_OWNER: "AetherCreator",
    GITHUB_REPO: "SuperClaude",
    BRAIN_WRITE_BASE: "https://thechefos-brain-write.tveg-baking.workers.dev",
    ...overrides,
  };
}

function authedRequest(path: string): Request {
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { "X-Reflection-Key": "test-secret" },
  });
}

function stubFetchEmpty(): void {
  vi.stubGlobal("fetch", async () => ({
    ok: false,
    status: 404,
    statusText: "Not Found",
    json: async () => ({}),
  }));
}

describe("POST /api/reflect-now — week param validation", () => {
  it("returns 400 with bad_week_format when week is malformed (2026-21)", async () => {
    const res = await worker.fetch(
      authedRequest("/api/reflect-now?week=2026-21"),
      makeEnv(),
      {} as ExecutionContext
    );
    expect(res.status).toBe(400);
    const body = await res.json() as { ok: boolean; error: string; expected: string };
    expect(body.ok).toBe(false);
    expect(body.error).toBe("bad_week_format");
    expect(body.expected).toBe("YYYY-Www");
  });

  it("returns 400 for plain number week format", async () => {
    const res = await worker.fetch(
      authedRequest("/api/reflect-now?week=202621"),
      makeEnv(),
      {} as ExecutionContext
    );
    expect(res.status).toBe(400);
  });

  it("returns 200 with computed digest for ?week=2026-W21 + valid key", async () => {
    stubFetchEmpty();
    const res = await worker.fetch(
      authedRequest("/api/reflect-now?week=2026-W21"),
      makeEnv(),
      {} as ExecutionContext
    );
    vi.unstubAllGlobals();
    expect(res.status).toBe(200);
    const body = await res.json() as {
      ok: boolean;
      week: string;
      generated_at: string;
      worker_version: string;
      input_volumes: Record<string, number>;
      digest_markdown: string;
      committed: boolean;
      commit_reason: string;
      notified: boolean;
      notify_reason: string;
      filed_ops_rows: unknown[];
    };
    expect(body.ok).toBe(true);
    expect(body.week).toBe("2026-W21");
    expect(body.worker_version).toBe("0.1.0");
    expect(body.input_volumes).toEqual({
      auto_actions_files: 0,
      ops_board_commits: 0,
      carpenter_runs: 0,
      hunter_baseline_runs: 0,
    });
    expect(body.committed).toBe(false);
    expect(body.notified).toBe(false);
    expect(Array.isArray(body.filed_ops_rows)).toBe(true);
    expect(body.filed_ops_rows).toHaveLength(0);
    expect(body.digest_markdown).toContain("week_iso: 2026-W21");
    expect(body.digest_markdown).toContain("# Weekly Reflection — 2026-W21");
    expect(body.digest_markdown).toContain("## 1. Auto-action accuracy");
  });
});

describe("Cron handler (C2 — fires reflection)", () => {
  it("runs runReflectionFlow for the current week and resolves", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await expect(
      worker.scheduled(
        { scheduledTime: Date.now(), cron: "0 22 * * SUN" } as unknown as ScheduledEvent,
        makeEnv(),
        {} as ExecutionContext
      )
    ).resolves.toBeUndefined();
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("[cron] reflection firing for"));
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("[cron] reflection done:"));
    consoleSpy.mockRestore();
  });
});
