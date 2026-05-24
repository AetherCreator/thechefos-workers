import { Hono } from "hono";
import { requireApiKey } from "./auth";
import { getSessionState, putSessionState } from "./handlers/session-state";
import { getDashboard, getManifest } from "./handlers/dashboard";
import { postTelegramQuests } from "./handlers/telegram";
import { getHealth } from "./handlers/health";

export interface Env {
  QUEST_LOG_STATE: KVNamespace;
  DB: D1Database;
  QUEST_LOG_API_SECRET: string;
  QUEST_LOG_DASHBOARD_SECRET: string;
  GITHUB_TOKEN: string;
  GITHUB_OWNER: string;
  GITHUB_REPO_SUPERCLAUDE: string;
}

// Hand-rolled via Hono (house style from brain-write) — URL.pathname switch
// without itty-router, keeps bundle tight.
const app = new Hono<{ Bindings: Env }>();

app.get("/health", getHealth);

app.get("/api/session/state", async (c) => {
  const authErr = requireApiKey(c.req.raw, c.env);
  if (authErr) return authErr;
  return getSessionState(c);
});

app.put("/api/session/state", async (c) => {
  const authErr = requireApiKey(c.req.raw, c.env);
  if (authErr) return authErr;
  return putSessionState(c);
});

app.get("/dashboard", getDashboard);

app.get("/manifest.json", getManifest);

app.post("/api/telegram-quests", postTelegramQuests);

app.all("*", (c) => c.json({ ok: false, error: "not_found" }, 404));

export default app;
