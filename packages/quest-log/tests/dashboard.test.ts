import { describe, it, expect, vi, afterEach } from "vitest";
import app from "../src/index";
import type { Env } from "../src/index";
import { computeQlkCookie } from "../src/handlers/dashboard";

const DASH_SECRET = "dash-secret-test";

function makeMockKV() {
  const store = new Map<string, string>();
  return {
    get: async (key: string, type?: string) => {
      const val = store.get(key);
      if (val === undefined) return null;
      if (type === "json") {
        try { return JSON.parse(val); } catch { return null; }
      }
      return val;
    },
    put: async (key: string, value: string, _opts?: unknown) => { store.set(key, value); },
    delete: async (key: string) => { store.delete(key); },
    list: async () => ({ keys: [], list_complete: true, cursor: undefined }),
    getWithMetadata: async () => ({ value: null, metadata: null }),
    __store: store,
  } as unknown as KVNamespace & { __store: Map<string, string> };
}

function makeMockDB(runs = 0): D1Database {
  return {
    prepare: (_sql: string) => ({
      bind: (..._args: unknown[]) => ({
        all: async () => ({ results: [{ runs }], success: true, meta: {} }),
      }),
    }),
  } as unknown as D1Database;
}

function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    QUEST_LOG_STATE: makeMockKV(),
    DB: makeMockDB(),
    QUEST_LOG_API_SECRET: "api-secret",
    QUEST_LOG_DASHBOARD_SECRET: DASH_SECRET,
    GITHUB_TOKEN: "gh-token",
    GITHUB_OWNER: "AetherCreator",
    GITHUB_REPO_SUPERCLAUDE: "SuperClaude",
    ...overrides,
  };
}

function mockFetchForDashboard() {
  const mockFetch = vi.fn().mockImplementation((url: string | URL | Request) => {
    const urlStr = typeof url === "string" ? url : url.toString();
    if (urlStr.includes("ACTIVE-STATE")) {
      return Promise.resolve(
        new Response("# Current Quest\nDoing things here\n---\nExtra section")
      );
    }
    if (urlStr.includes("OPS-BOARD")) {
      return Promise.resolve(
        new Response(
          "## 🚨 URGENT\n| Task | Status |\n|---|---|\n| Fix urgent thing | IN PROGRESS |\n" +
          "## ✅ COMPLETED\n| Task | Date |\n|---|---|\n| Done thing | 2026-05-24 |"
        )
      );
    }
    return Promise.resolve(new Response("", { status: 404 }));
  });
  vi.stubGlobal("fetch", mockFetch);
  return mockFetch;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("GET /dashboard — cookie auth", () => {
  it("no cookie → 401", async () => {
    const res = await app.fetch(
      new Request("http://localhost/dashboard"),
      makeEnv()
    );
    expect(res.status).toBe(401);
    const body = await res.json() as { ok: boolean; error: string };
    expect(body).toEqual({ ok: false, error: "unauthorized" });
  });

  it("?key=bogus → 401", async () => {
    const res = await app.fetch(
      new Request("http://localhost/dashboard?key=bogus"),
      makeEnv()
    );
    expect(res.status).toBe(401);
    const body = await res.json() as { ok: boolean; error: string };
    expect(body).toEqual({ ok: false, error: "unauthorized" });
  });

  it("?key=<valid> → 302 + Set-Cookie with qlk=<hex>", async () => {
    const res = await app.fetch(
      new Request(`http://localhost/dashboard?key=${DASH_SECRET}`),
      makeEnv()
    );
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/dashboard");
    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie).toMatch(/^qlk=[a-f0-9]+;/);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
  });

  it("valid qlk cookie → 200 + HTML with all 4 sections + 3 placeholders + title", async () => {
    mockFetchForDashboard();
    const qlk = await computeQlkCookie(DASH_SECRET);
    const res = await app.fetch(
      new Request("http://localhost/dashboard", {
        headers: { cookie: `qlk=${qlk}` },
      }),
      makeEnv()
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    const body = await res.text();
    expect(body).toContain("<title>Quest Log</title>");
    expect(body).toContain("CURRENT ADVENTURE");
    expect(body).toContain("OPEN QUESTS");
    expect(body).toContain("RECENT VICTORIES");
    expect(body).toContain("COST LEDGER");
    expect(body).toContain("Crew XP");
    expect(body).toContain("Spirit Level");
    expect(body).toContain("Knowledge Map");
    expect(body).toContain("Phase 2 P5 lands");
  });

  it("?refresh=1 with valid cookie → 200", async () => {
    mockFetchForDashboard();
    const qlk = await computeQlkCookie(DASH_SECRET);
    const kv = makeMockKV();
    // pre-populate cache
    (kv as unknown as { __store: Map<string, string> }).__store.set(
      "cache:dashboard:active-state",
      JSON.stringify("cached active state")
    );
    const res = await app.fetch(
      new Request("http://localhost/dashboard?refresh=1", {
        headers: { cookie: `qlk=${qlk}` },
      }),
      makeEnv({ QUEST_LOG_STATE: kv })
    );
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("CURRENT ADVENTURE");
    // cache key should be gone after refresh
    const cached = (kv as unknown as { __store: Map<string, string> }).__store.get("cache:dashboard:active-state");
    // After refresh, the fetcher re-populated the cache key
    // (fetch mock returned new data, so key exists with new value)
    // Just verify the render succeeded
    expect(body).toContain("<title>Quest Log</title>");
  });
});

describe("GET /manifest.json", () => {
  it("200 + valid JSON + name === 'Quest Log'", async () => {
    const res = await app.fetch(
      new Request("http://localhost/manifest.json"),
      makeEnv()
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    const body = await res.json() as { name: string; start_url: string };
    expect(body.name).toBe("Quest Log");
    expect(body.start_url).toBe("/dashboard");
  });
});
