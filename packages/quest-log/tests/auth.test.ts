import { describe, it, expect } from "vitest";
import app from "../src/index";
import type { Env } from "../src/index";

function makeMockKV() {
  const store = new Map<string, string>();
  return {
    get: async (key: string, _type?: string) => store.get(key) ?? null,
    put: async (key: string, value: string, _opts?: unknown) => { store.set(key, value); },
    delete: async (key: string) => { store.delete(key); },
    list: async () => ({ keys: [], list_complete: true, cursor: undefined }),
    getWithMetadata: async () => ({ value: null, metadata: null }),
  } as unknown as KVNamespace;
}

function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    QUEST_LOG_STATE: makeMockKV(),
    DB: {} as D1Database,
    QUEST_LOG_API_SECRET: "correct-secret",
    QUEST_LOG_DASHBOARD_SECRET: "dash-secret",
    GITHUB_TOKEN: "gh-token",
    GITHUB_OWNER: "AetherCreator",
    GITHUB_REPO_SUPERCLAUDE: "SuperClaude",
    ...overrides,
  };
}

describe("auth middleware — X-Quest-Log-Key", () => {
  it("returns 401 when X-Quest-Log-Key header is missing", async () => {
    const res = await app.fetch(
      new Request("http://localhost/api/session/state"),
      makeEnv()
    );
    expect(res.status).toBe(401);
    const body = await res.json() as { ok: boolean; error: string };
    expect(body).toEqual({ ok: false, error: "unauthorized" });
  });

  it("returns 401 when X-Quest-Log-Key header has wrong value", async () => {
    const res = await app.fetch(
      new Request("http://localhost/api/session/state", {
        headers: { "X-Quest-Log-Key": "bogus-key" },
      }),
      makeEnv()
    );
    expect(res.status).toBe(401);
    const body = await res.json() as { ok: boolean; error: string };
    expect(body).toEqual({ ok: false, error: "unauthorized" });
  });

  it("passes through to handler when X-Quest-Log-Key is correct", async () => {
    const res = await app.fetch(
      new Request("http://localhost/api/session/state", {
        headers: { "X-Quest-Log-Key": "correct-secret" },
      }),
      makeEnv()
    );
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  it("returns 401 on PUT with missing key", async () => {
    const res = await app.fetch(
      new Request("http://localhost/api/session/state", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      }),
      makeEnv()
    );
    expect(res.status).toBe(401);
  });
});
