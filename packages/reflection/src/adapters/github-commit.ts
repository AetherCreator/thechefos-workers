import type { GithubContext } from "../types";

// C3 implements real GitHub Contents PUT. C1 stubs to avoid deploy-time GitHub calls.
export async function commitReflectionDigest(
  _github: GithubContext,
  _path: string,
  _content: string,
  _commitMsg: string,
  _branch: string
): Promise<{ sha: string; url: string }> {
  return { sha: "scaffold", url: "scaffold" };
}
