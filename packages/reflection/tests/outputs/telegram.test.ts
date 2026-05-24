import { describe, it, expect, vi, afterEach } from "vitest";
import { sendReflectionTelegram, escapeMarkdown } from "../../src/outputs/telegram";
import type { TelegramEnv, TelegramDigest } from "../../src/outputs/telegram";

const mockEnv: TelegramEnv = {
  SHIPS_DOCTOR_BOT_TOKEN: "mock-token-123",
  TYLER_CHAT_ID: "6091970994",
};

const mockDigest: TelegramDigest = {
  week: "2026-W21",
  commitUrl: "https://github.com/AetherCreator/SuperClaude/commit/abc123",
  filedOpsRows: ["OPS-REFLECTION-2026-W21-TEST"],
  notableHighlights: ["Carpenter p75 turns=28 (under 32 cap)", "No drift verdicts this week"],
  isSmoke: false,
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("sendReflectionTelegram", () => {
  it("returns ok: true with message_id on success; markdown escaping is correct", async () => {
    let capturedBody: Record<string, unknown> | undefined;

    vi.stubGlobal("fetch", vi.fn().mockImplementationOnce(async (_url: string, opts: RequestInit) => {
      capturedBody = JSON.parse(opts.body as string);
      return {
        ok: true,
        json: async () => ({ ok: true, result: { message_id: 42 } }),
      } as Response;
    }));

    const result = await sendReflectionTelegram(mockEnv, mockDigest);

    expect(result.ok).toBe(true);
    expect(result.message_id).toBe(42);

    // Verify markdown escaping: W21 has no special chars, but filed row ID has hyphens (fine)
    expect(capturedBody?.parse_mode).toBe("Markdown");
    expect(capturedBody?.disable_web_page_preview).toBe(true);
    expect(typeof capturedBody?.text).toBe("string");
    // text should contain the week and commit URL
    expect(capturedBody?.text as string).toContain("2026-W21");
    expect(capturedBody?.text as string).toContain("https://github.com");
  });
});

describe("escapeMarkdown", () => {
  it("escapes Telegram MarkdownV1 special characters", () => {
    expect(escapeMarkdown("hello_world")).toBe("hello\\_world");
    expect(escapeMarkdown("*bold*")).toBe("\\*bold\\*");
    expect(escapeMarkdown("[link](url)")).toBe("\\[link\\]\\(url\\)");
    expect(escapeMarkdown("no special chars")).toBe("no special chars");
  });
});
