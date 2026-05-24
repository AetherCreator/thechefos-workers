import type { GithubContext } from "../types";

export async function commitReflectionDigest(
  github: GithubContext,
  path: string,
  content: string,
  commitMsg: string,
  branch: string
): Promise<{ sha: string; url: string }> {
  const headers = {
    Authorization: `Bearer ${github.pat}`,
    "User-Agent": "thechefos-reflection-worker",
    Accept: "application/vnd.github+json",
  };

  // Ensure branch exists (creates from main HEAD if not found — needed for smoke branches)
  if (branch !== "main") {
    await ensureBranchExists(github.owner, github.repo, branch, headers);
  }

  // GET existing file SHA (if exists) for update path
  let existingSha: string | undefined;
  const getResp = await fetch(
    `https://api.github.com/repos/${github.owner}/${github.repo}/contents/${path}?ref=${branch}`,
    { headers }
  );
  if (getResp.ok) {
    existingSha = ((await getResp.json()) as { sha: string }).sha;
  } else if (getResp.status !== 404) {
    throw new Error(`commit precheck failed: ${getResp.status}`);
  }

  // PUT with base64 content + optional sha
  const body: Record<string, unknown> = {
    message: commitMsg,
    content: btoa(unescape(encodeURIComponent(content))),
    branch,
    committer: {
      name: "thechefos-reflection-worker[bot]",
      email: "noreply@thechefos.app",
    },
  };
  if (existingSha) body.sha = existingSha;

  const putResp = await fetch(
    `https://api.github.com/repos/${github.owner}/${github.repo}/contents/${path}`,
    { method: "PUT", headers, body: JSON.stringify(body) }
  );
  if (!putResp.ok) {
    const errText = await putResp.text();
    throw new Error(`commit failed ${putResp.status}: ${errText.slice(0, 200)}`);
  }

  const result = (await putResp.json()) as { commit: { sha: string; html_url: string } };
  return {
    sha: result.commit.sha,
    url: result.commit.html_url,
  };
}

async function ensureBranchExists(
  owner: string,
  repo: string,
  branch: string,
  headers: Record<string, string>
): Promise<void> {
  // Check if branch exists
  const branchResp = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/branches/${encodeURIComponent(branch)}`,
    { headers }
  );
  if (branchResp.ok) return; // already exists

  // Get main HEAD SHA
  const mainResp = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/git/ref/heads/main`,
    { headers }
  );
  if (!mainResp.ok) {
    throw new Error(`could not resolve main HEAD for branch creation: ${mainResp.status}`);
  }
  const mainData = (await mainResp.json()) as { object: { sha: string } };
  const mainSha = mainData.object.sha;

  // Create branch ref
  const createResp = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/git/refs`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: mainSha }),
    }
  );
  if (!createResp.ok) {
    const errText = await createResp.text();
    throw new Error(`branch creation failed ${createResp.status}: ${errText.slice(0, 200)}`);
  }
}
