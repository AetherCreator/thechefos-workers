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
    __store: store,
  } as unknown as KVNamespace & { __store: Map<string, string> };
}

const API_SECRET = "test-api-secret";

function makeEnv(kv?: KVNamespace & { __store?: Map<string, string> }): Env {
  return {
    QUEST_LOG_STATE: kv ?? makeMockKV(),
    DB: {} as D1Database,
    QUEST_LOG_API_SECRET: API_SECRET,
    QUEST_LOG_DASHBOARD_SECRET: "dash-secret",
    GITHUB_TOKEN: "gh-token",
    GITHUB_OWNER: "AetherCreator",
    GITHUB_REPO_SUPERCLAUDE: "SuperClaude",
  };
}

const authHeaders = { "X-Quest-Log-Key": API_SECRET };

const validState = {
  session_id: "01927e3a-0000-7000-a000-000000000001",
  started_at: "2026-05-24T20:00:00Z",
  surface: "chat" as const,
  last_updated_at: "2026-05-24T20:00:00Z",
};

describe("GET /api/session/state", () => {
  it("returns {ok:true, state:null} when KV is empty", async () => {
    const res = await app.fetch(
      new Request("http://localhost/api/session/state", { headers: authHeaders }),
      makeEnv()
    );
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean; state: unknown };
    expect(body).toEqual({ ok: true, state: null });
  });

  it("returns 401 for missing auth on GET", async () => {
    const res = await app.fetch(
      new Request("http://localhost/api/session/state"),
      makeEnv()
    );
    expect(res.status).toBe(401);
  });
});

describe("PUT /api/session/state", () => {
  it("stores valid SessionState and returns {ok:true}", async () => {
    const kv = makeMockKV();
    const env = makeEnv(kv);

    const res = await app.fetch(
      new Request("http://localhost/api/session/state", {
        method: "PUT",
        headers: { ...authHeaders, "Content-Type": "application/json" },
        body: JSON.stringify(validState),
      }),
      env
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    const stored = kv.__store.get("current");
    expect(stored).toBeDefined();
    expect(JSON.parse(stored!)).toMatchObject(validState);
  });

  it("returns 400 with zod issues when session_id is missing", async () => {
    const { session_id: _omit, ...invalid } = validState;
    const res = await app.fetch(
      new Request("http://localhost/api/session/state", {
        method: "PUT",
        headers: { ...authHeaders, "Content-Type": "application/json" },
        body: JSON.stringify(invalid),
      }),
      makeEnv()
    );
    expect(res.status).toBe(400);
    const body = await res.json() as { ok: boolean; error: string; issues: unknown[] };
    expect(body.ok).toBe(false);
    expect(body.error).toBe("validation");
    expect(Array.isArray(body.issues)).toBe(true);
    expect(body.issues.length).toBeGreaterThan(0);
  });

  it("returns 400 for non-JSON body", async () => {
    const res = await app.fetch(
      new Request("http://localhost/api/session/state", {
        method: "PUT",
        headers: { ...authHeaders, "Content-Type": "application/json" },
        body: "not valid json {{{",
      }),
      makeEnv()
    );
    expect(res.status).toBe(400);
    const body = await res.json() as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(body.error).toBe("validation");
  });

  it("returns 401 for missing auth on PUT", async () => {
    const res = await app.fetch(
      new Request("http://localhost/api/session/state", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validState),
      }),
      makeEnv()
    );
    expect(res.status).toBe(401);
  });
});

describe("GET /api/session/state after PUT", () => {
  it("returns stored state with correct shape after PUT", async () => {
    const kv = makeMockKV();
    const env = makeEnv(kv);

    await app.fetch(
      new Request("http://localhost/api/session/state", {
        method: "PUT",
        headers: { ...authHeaders, "Content-Type": "application/json" },
        body: JSON.stringify(validState),
      }),
      env
    );

    const res = await app.fetch(
      new Request("http://localhost/api/session/state", { headers: authHeaders }),
      env
    );
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean; state: typeof validState };
    expect(body.ok).toBe(true);
    expect(body.state).toMatchObject(validState);
  });
});

describe("404 for unknown routes", () => {
  it("returns 404 for unknown path", async () => {
    const res = await app.fetch(
      new Request("http://localhost/api/unknown-route"),
      makeEnv()
    );
    expect(res.status).toBe(404);
    const body = await res.json() as { ok: boolean; error: string };
    expect(body).toEqual({ ok: false, error: "not_found" });
  });
});
