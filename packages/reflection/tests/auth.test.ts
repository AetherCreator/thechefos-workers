import { describe, it, expect } from "vitest";
import worker from "../src/index";
import type { Env } from "../src/types";

function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    BRAIN_D1: {} as D1Database,
    REFLECTION_API_SECRET: "correct-secret",
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

describe("auth — X-Reflection-Key", () => {
  it("returns 401 when X-Reflection-Key header is missing", async () => {
    const res = await worker.fetch(
      new Request("http://localhost/api/reflect-now", { method: "POST" }),
      makeEnv(),
      {} as ExecutionContext
    );
    expect(res.status).toBe(401);
    const body = await res.json() as { ok: boolean; error: string };
    expect(body).toEqual({ ok: false, error: "invalid_or_missing_api_key" });
  });

  it("returns 401 when X-Reflection-Key has wrong value", async () => {
    const res = await worker.fetch(
      new Request("http://localhost/api/reflect-now", {
        method: "POST",
        headers: { "X-Reflection-Key": "wrong-secret" },
      }),
      makeEnv(),
      {} as ExecutionContext
    );
    expect(res.status).toBe(401);
    const body = await res.json() as { ok: boolean; error: string };
    expect(body).toEqual({ ok: false, error: "invalid_or_missing_api_key" });
  });

  it("returns 200 when X-Reflection-Key is correct", async () => {
    const res = await worker.fetch(
      new Request("http://localhost/api/reflect-now?week=2026-W21", {
        method: "POST",
        headers: { "X-Reflection-Key": "correct-secret" },
      }),
      makeEnv(),
      {} as ExecutionContext
    );
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean };
    expect(body.ok).toBe(true);
  });
});
