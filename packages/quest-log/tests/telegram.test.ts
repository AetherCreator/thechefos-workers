import { describe, it, expect, afterEach } from "vitest";
import app from "../src/index";
import type { Env } from "../src/index";

const API_SECRET = "api-secret-test";

function makeMockKV() {
  const store = new Map<string, string>();
  return {
    get: async (key: string, type?: string) => {
      const val = store.get(key);
      if (val === undefined) return null;
      if (type === "json") {
        try {
          return JSON.parse(val);
        } catch {
          return null;
        }
      }
      return val;
    },
    put: async (key: string, value: string) => {
      store.set(key, value);
    },
    delete: async (key: string) => {
      store.delete(key);
    },
    list: async () => ({ keys: [], list_complete: true, cursor: undefined }),
    getWithMetadata: async () => ({ value: null, metadata: null }),
    __store: store,
  } as unknown as KVNamespace;
}

function makeMockDB(runs = 7): D1Database {
  return {
    prepare: () => ({
      bind: () => ({
        all: async () => ({ results: [{ runs }] }),
        first: async () => ({ runs }),
        run: async () => ({ success: true }),
      }),
    }),
  } as unknown as D1Database;
}

function envFixture(): Env {
  return {
    QUEST_LOG_STATE: makeMockKV(),
    DB: makeMockDB(),
    QUEST_LOG_API_SECRET: API_SECRET,
    QUEST_LOG_DASHBOARD_SECRET: "dash-secret-test",
    GITHUB_TOKEN: "gh-fake",
    GITHUB_OWNER: "AetherCreator",
    GITHUB_REPO_SUPERCLAUDE: "SuperClaude",
  };
}

const originalFetch = globalThis.fetch;

function stubGithub() {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    if (url.includes("ACTIVE-STATE.md")) {
      return new Response(
        "## 2026-05-24 ~01:30 — top block\n\nAdventure narrative paragraph.\n\nMore lines.\n\n---\n\nOmitted",
        { status: 200 }
      );
    }
    if (url.includes("OPS-BOARD.md")) {
      return new Response(
        [
          "## 🚨 URGENT",
          "| OPS-001 | token rotation | URGENT |",
          "## 🟢 ACTIVE",
          "| OPS-ACTIVE-1 | active row | ACTIVE |",
          "## ✅ COMPLETED",
          "| OPS-WON | victory row | 2026-05-24 |",
        ].join("\n"),
        { status: 200 }
      );
    }
    return new Response("", { status: 404 });
  }) as typeof fetch;
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("POST /api/telegram-quests", () => {
  it("returns 401 when X-Quest-Log-Key header is missing", async () => {
    const env = envFixture();
    const req = new Request("https://x.invalid/api/telegram-quests", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: 1, user_id: 6091970994 }),
    });
    const res = await app.fetch(req, env);
    expect(res.status).toBe(401);
  });

  it("returns 401 when X-Quest-Log-Key header is wrong", async () => {
    const env = envFixture();
    const req = new Request("https://x.invalid/api/telegram-quests", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-quest-log-key": "BOGUS",
      },
      body: JSON.stringify({ chat_id: 1, user_id: 6091970994 }),
    });
    const res = await app.fetch(req, env);
    expect(res.status).toBe(401);
  });

  it("returns 400 when user_id is missing", async () => {
    const env = envFixture();
    const req = new Request("https://x.invalid/api/telegram-quests", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-quest-log-key": API_SECRET,
      },
      body: JSON.stringify({ chat_id: 1 }),
    });
    const res = await app.fetch(req, env);
    expect(res.status).toBe(400);
  });

  it("returns 400 on bad JSON body", async () => {
    const env = envFixture();
    const req = new Request("https://x.invalid/api/telegram-quests", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-quest-log-key": API_SECRET,
      },
      body: "this is not json {{{",
    });
    const res = await app.fetch(req, env);
    expect(res.status).toBe(400);
  });

  it("returns 200 + 'Tyler-only' refusal for non-Tyler user_id", async () => {
    const env = envFixture();
    const req = new Request("https://x.invalid/api/telegram-quests", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-quest-log-key": API_SECRET,
      },
      body: JSON.stringify({ chat_id: 1, user_id: 999999 }),
    });
    const res = await app.fetch(req, env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; markdown: string };
    expect(body.ok).toBe(true);
    expect(body.markdown).toContain("Tyler-only");
  });

  it("returns markdown digest with all 4 section headers for Tyler", async () => {
    stubGithub();
    const env = envFixture();
    const req = new Request("https://x.invalid/api/telegram-quests", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-quest-log-key": API_SECRET,
      },
      body: JSON.stringify({
        chat_id: 1,
        user_id: 6091970994,
        username: "tyler",
      }),
    });
    const res = await app.fetch(req, env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; markdown: string };
    expect(body.ok).toBe(true);
    expect(body.markdown).toContain("CURRENT ADVENTURE");
    expect(body.markdown).toContain("OPEN QUESTS");
    expect(body.markdown).toContain("RECENT VICTORIES");
    expect(body.markdown).toContain("COST LEDGER");
    expect(body.markdown).toContain("Quest Log");
  });
});
