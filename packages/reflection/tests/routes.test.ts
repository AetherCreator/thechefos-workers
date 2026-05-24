import { describe, it, expect, vi } from "vitest";
import worker from "../src/index";
import type { Env } from "../src/types";

function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    BRAIN_D1: {} as D1Database,
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

  it("returns 200 with valid skeleton for ?week=2026-W21 + valid key", async () => {
    const res = await worker.fetch(
      authedRequest("/api/reflect-now?week=2026-W21"),
      makeEnv(),
      {} as ExecutionContext
    );
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
    expect(body.commit_reason).toBe("scaffold");
    expect(body.notified).toBe(false);
    expect(body.notify_reason).toBe("scaffold");
    expect(Array.isArray(body.filed_ops_rows)).toBe(true);
    expect(body.filed_ops_rows).toHaveLength(0);
    expect(body.digest_markdown).toContain("week_iso: 2026-W21");
    expect(body.digest_markdown).toContain("# Weekly Reflection — 2026-W21");
    expect(body.digest_markdown).toContain("Scaffold emission from C1");
  });
});

describe("Cron handler stub", () => {
  it("logs without throwing", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await expect(
      worker.scheduled(
        { scheduledTime: Date.now(), cron: "0 22 * * 0" } as ScheduledEvent,
        makeEnv(),
        {} as ExecutionContext
      )
    ).resolves.toBeUndefined();
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("[cron] reflection fired at"));
    consoleSpy.mockRestore();
  });
});
