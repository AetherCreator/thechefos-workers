import type { Env } from './types';

export interface TrackedDep {
  name: string;
  feed: string;
  criticality: 'high' | 'medium' | 'low';
}

const CACHE_KEY = '_deps_cache';
const CACHE_TTL_SECONDS = 3600;
const VALID_CRITICALITY = new Set(['high', 'medium', 'low']);

export async function loadTrackedDeps(env: Env): Promise<TrackedDep[]> {
  const cached = await env.CHANGELOG_SEEN.get(CACHE_KEY);
  if (cached) {
    return JSON.parse(cached) as TrackedDep[];
  }

  const resp = await fetch(
    'https://api.github.com/repos/AetherCreator/SuperClaude/contents/brain/06-meta/tracked-dependencies.yml',
    {
      headers: {
        Authorization: `Bearer ${env.GITHUB_TOKEN}`,
        Accept: 'application/vnd.github.v3+json',
        'User-Agent': 'locke-changelog-watcher/1.0'
      }
    }
  );

  if (!resp.ok) {
    throw new Error(`loadTrackedDeps: ${resp.status} fetching tracked-dependencies.yml`);
  }

  const json = (await resp.json()) as { content: string; encoding: string };
  if (json.encoding !== 'base64') {
    throw new Error(`loadTrackedDeps: unexpected encoding ${json.encoding}`);
  }

  const yaml = atob(json.content.replace(/\n/g, ''));
  const deps = parseTrackedDepsYaml(yaml);

  await env.CHANGELOG_SEEN.put(CACHE_KEY, JSON.stringify(deps), {
    expirationTtl: CACHE_TTL_SECONDS
  });

  return deps;
}

export function parseTrackedDepsYaml(yaml: string): TrackedDep[] {
  const result: TrackedDep[] = [];

  // Split on entry markers — each dep block starts with "  - name:"
  const parts = yaml.split(/^  - name:/m);

  for (let i = 1; i < parts.length; i++) {
    const block = parts[i];
    const name = block.split('\n')[0].trim();
    if (!name) continue;

    const feedMatch = /^    feed:\s*(.+)$/m.exec(block);
    const critMatch = /^    criticality:\s*(.+)$/m.exec(block);

    const feed = feedMatch?.[1]?.trim() ?? '';
    const criticality = critMatch?.[1]?.trim() ?? '';

    if (!feed || !criticality) continue;

    // Skip tbd feeds
    if (feed === 'tbd') continue;

    if (!VALID_CRITICALITY.has(criticality)) {
      throw new Error(`loadTrackedDeps: invalid criticality '${criticality}' for dep '${name}'`);
    }

    result.push({ name, feed, criticality: criticality as TrackedDep['criticality'] });
  }

  return result;
}
