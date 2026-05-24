import { describe, it, expect, vi, afterEach } from "vitest";
import { fileOpsRowViaGitHub } from "../../src/outputs/ops-filing";
import type { SystemImprovementRow } from "../../src/outputs/ops-filing";
import type { GithubContext } from "../../src/types";

const mockGithub: GithubContext = { owner: "AetherCreator", repo: "SuperClaude", pat: "mock-pat" };

const mockRow: SystemImprovementRow = {
  id: "OPS-REFLECTION-2026-W21-TEST-ROW",
  priority: "Normal",
  category: "meta",
  title: "Test OPS row",
  body: "Test body for OPS row filing",
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("fileOpsRowViaGitHub", () => {
  it("returns ok: true with board_sha on successful POST", async () => {
    const mockCurrentContent = "# OPS-BOARD\n\n## BACKLOG\n| ID | Category | Title | Notes |\n|---|---|---|---|\n";
    const mockGetBody = {
      sha: "existing-sha-123",
      content: btoa(mockCurrentContent),
    };
    const mockPutResult = {
      content: { sha: "new-file-sha-456" },
    };

    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => mockGetBody } as Response)
      .mockResolvedValueOnce({ ok: true, json: async () => mockPutResult } as Response)
    );

    const result = await fileOpsRowViaGitHub(mockGithub, mockRow);

    expect(result.ok).toBe(true);
    expect(result.board_sha).toBe("new-file-sha-456");
    expect(result.path_used).toBe("github-contents");
  });

  it("returns ok: false with error string on 4xx response without throwing", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 403,
        text: async () => "Forbidden",
      } as unknown as Response)
    );

    const result = await fileOpsRowViaGitHub(mockGithub, mockRow);

    expect(result.ok).toBe(false);
    expect(result.error).toContain("403");
    expect(result.path_used).toBe("github-contents");
  });
});
