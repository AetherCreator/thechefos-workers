import { describe, it, expect, vi, afterEach } from "vitest";
import { runReflectionFlow } from "../src/flow";
import type { FlowParams } from "../src/flow";
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
    TYLER_CHAT_ID: "6091970994",
    WORKER_VERSION: "0.1.0",
    GITHUB_OWNER: "AetherCreator",
    GITHUB_REPO: "SuperClaude",
    BRAIN_WRITE_BASE: "https://thechefos-brain-write.tveg-baking.workers.dev",
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("runReflectionFlow — full flow with mocks", () => {
  it("compute → write → commit → file → notify: returns valid FlowResult, all flags set", async () => {
    const mockOpsBoard = "# OPS-BOARD\n\n## BACKLOG\n| ID | Cat | Title | Notes |\n|---|---|---|---|\n";

    // URL-based routing to avoid position-dependency issues
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async (url: string, opts?: RequestInit) => {
      const u = typeof url === "string" ? url : "";
      const method = opts?.method ?? "GET";

      // Telegram POST
      if (u.includes("api.telegram.org")) {
        return {
          ok: true,
          json: async () => ({ ok: true, result: { message_id: 99 } }),
        } as unknown as Response;
      }

      // OPS-BOARD: GET → return mock content
      if (u.includes("contents/brain/OPS-BOARD.md") && method === "GET") {
        return {
          ok: true,
          json: async () => ({
            sha: "ops-sha-123",
            content: btoa(mockOpsBoard),
          }),
        } as unknown as Response;
      }

      // OPS-BOARD: PUT → success
      if (u.includes("contents/brain/OPS-BOARD.md") && method === "PUT") {
        return {
          ok: true,
          json: async () => ({ content: { sha: "new-ops-sha-456" } }),
        } as unknown as Response;
      }

      // Branch existence check: GET branches/... → 404 (branch does not exist)
      if (u.includes("/branches/") && method === "GET") {
        return { ok: false, status: 404 } as unknown as Response;
      }

      // Main HEAD ref: GET git/ref/heads/main → return sha
      if (u.includes("/git/ref/heads/main") && method === "GET") {
        return {
          ok: true,
          json: async () => ({ object: { sha: "main-sha-xyz" } }),
        } as unknown as Response;
      }

      // Branch creation: POST git/refs → success
      if (u.includes("/git/refs") && method === "POST") {
        return {
          ok: true,
          json: async () => ({ ref: "refs/heads/_smoke/reflection-c3-20260524" }),
        } as unknown as Response;
      }

      // Commit: GET existing file on branch → 404 (first write)
      if (u.includes("contents/brain/06-meta/reflection") && method === "GET") {
        return { ok: false, status: 404 } as unknown as Response;
      }

      // Commit: PUT file → success
      if (u.includes("contents/brain/06-meta/reflection") && method === "PUT") {
        return {
          ok: true,
          json: async () => ({
            commit: {
              sha: "commit-sha-abc",
              html_url: "https://github.com/AetherCreator/SuperClaude/commit/commit-sha-abc",
            },
          }),
        } as unknown as Response;
      }

      // Default: 404 for all other fetches (adapters that need GitHub data)
      return {
        ok: false,
        status: 404,
        statusText: "Not Found",
        json: async () => ({}),
      } as unknown as Response;
    }));

    const params: FlowParams = {
      week: "2026-W21",
      commit: true,
      notify: true,
      smoke: true,
      env: makeEnv(),
    };

    const result = await runReflectionFlow(params);

    expect(result.week).toBe("2026-W21");
    expect(typeof result.generated_at).toBe("string");
    expect(result.committed).toBe(true);
    expect(result.commit_sha).toBe("commit-sha-abc");
    expect(result.commit_url).toContain("commit-sha-abc");
    expect(result.notified).toBe(true);
    expect(result.notify_message_id).toBe(99);
    expect(typeof result.digest_markdown).toBe("string");
    expect(result.digest_markdown).toContain("week_iso: 2026-W21");
    expect(Array.isArray(result.filed_ops_rows)).toBe(true);
    expect(Array.isArray(result.warnings)).toBe(true);
    // warnings may include "brain-write /api/ops/file absent" note — that's expected
    const noFatalWarnings = result.warnings.every(
      (w) => !w.startsWith("commit failed") && !w.startsWith("telegram failed")
    );
    expect(noFatalWarnings).toBe(true);
  });
});
