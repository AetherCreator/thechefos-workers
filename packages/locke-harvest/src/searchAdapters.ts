// searchAdapters.ts — Locke search adapter system (2026-05-11 evening pivot).
//
// Replaces SearXNG meta-search with a sovereign-friendly hybrid:
//   - Reddit native search.json (free, no auth, 60/min anon)
//   - HN Algolia Search API (free, generous limits, the canonical HN search)
//   - Brave Search API fallback (free tier: 1/sec, 2,000/mo)
//
// Why: SearXNG is a scraper of services that bot-block scrapers. Burst-loading
// `site:reddit.com` queries through Brave/Google/Bing/DDG/Mojeek/Startpage
// (SearXNG's underlying engines) triggers each engine's bot-detection. Recovery
// is hours-to-days per engine. Validated 2026-05-11: 3 iterative manual fires
// burned 6/6 engines through CAPTCHA + suspension. Locke is designed for weekly
// cron not interactive smoke; even cron-cadence is fragile when shared with
// other consumers.
//
// Cost: weekly cron × 20 queries × 4 fires/month ≈ 80 queries/month. Reddit + HN
// are free. Brave free-tier ceiling is 2,000/mo — 25x headroom.
//
// Subrequest cost: 1 subreq per query (same as SearXNG). Combined with batched
// intel_log in index.ts, total Locke /run subreq count drops from ~50 to ~28,
// well under the CF 50-subreq cap (OPS-COUNCIL-SUBREQUEST-BATCHING).
//
// Sovereignty: Brave Search API is a single named service, not a platform.
// Spirit Test posture: net-negative vendor dependency (SearXNG transitively
// depended on Brave + Google + Bing + DDG + Mojeek + Startpage's good will;
// hybrid depends explicitly on Reddit + HN + Brave only).

export interface SearchResult {
  url: string;
  title: string;
  content: string;
  engine?: string;
}

interface AdapterEnv {
  BRAVE_SEARCH_API_KEY?: string;
}

export interface SearchAdapter {
  name: string;
  matches(query: string): boolean;
  search(query: string, env: AdapterEnv): Promise<SearchResult[]>;
}

// Strip `site:host[/path]` operators from a query, returning the keyword remainder
function stripSiteOperator(q: string, hostRegex: RegExp): string {
  return q.replace(hostRegex, '').replace(/\s+/g, ' ').trim();
}

// ============================================================================
// Reddit adapter — handles `site:reddit.com` and `site:reddit.com/r/<sub>`
// API: https://www.reddit.com/search.json | /r/X/search.json
// Auth: none (anon, 60/min). User-Agent required by Reddit's API policy.
// ============================================================================
export const redditAdapter: SearchAdapter = {
  name: 'reddit',
  matches: (q) => /\bsite:reddit\.com\b/i.test(q),
  search: async (q) => {
    const subMatch = q.match(/\bsite:reddit\.com\/r\/(\w+)\b/i);
    const subreddit = subMatch ? subMatch[1] : null;
    const keywords = stripSiteOperator(q, /\bsite:reddit\.com(\/r\/\w+)?\b/gi);
    const base = subreddit
      ? `https://www.reddit.com/r/${subreddit}/search.json`
      : `https://www.reddit.com/search.json`;
    const url = new URL(base);
    url.searchParams.set('q', keywords);
    url.searchParams.set('limit', '10');
    url.searchParams.set('sort', 'relevance');
    if (subreddit) url.searchParams.set('restrict_sr', 'on');
    const r = await fetch(url.toString(), {
      headers: { 'User-Agent': 'locke-harvest/2.0 (by /u/AetherCreator)' }
    });
    if (!r.ok) throw new Error(`Reddit ${r.status}`);
    const data: any = await r.json();
    const kids = data?.data?.children || [];
    return kids.slice(0, 10).map((c: any) => ({
      url: c.data.permalink ? `https://www.reddit.com${c.data.permalink}` : (c.data.url || ''),
      title: c.data.title || '',
      content: (c.data.selftext || '').slice(0, 500),
      engine: 'reddit'
    }));
  }
};

// ============================================================================
// Hacker News adapter — Algolia HN Search API
// API: https://hn.algolia.com/api/v1/search?query=X&tags=story
// Auth: none. Generous limits (~10k/day reported by community).
// ============================================================================
export const hnAdapter: SearchAdapter = {
  name: 'hn',
  matches: (q) => /\bsite:news\.ycombinator\.com\b/i.test(q),
  search: async (q) => {
    const keywords = stripSiteOperator(q, /\bsite:news\.ycombinator\.com\b/gi);
    const url = new URL('https://hn.algolia.com/api/v1/search');
    url.searchParams.set('query', keywords);
    url.searchParams.set('tags', 'story');
    url.searchParams.set('hitsPerPage', '10');
    const r = await fetch(url.toString(), {
      headers: { 'User-Agent': 'locke-harvest/2.0' }
    });
    if (!r.ok) throw new Error(`HN ${r.status}`);
    const data: any = await r.json();
    return (data.hits || []).slice(0, 10).map((h: any) => ({
      url: h.url || `https://news.ycombinator.com/item?id=${h.objectID}`,
      title: h.title || '',
      content: (h.story_text || '').slice(0, 500),
      engine: 'hn'
    }));
  }
};

// ============================================================================
// Brave Search API fallback — catches everything not above
// (site:lobste.rs, site:indiehackers.com, and any future targets)
// API: https://api.search.brave.com/res/v1/web/search
// Auth: X-Subscription-Token header (Worker secret BRAVE_SEARCH_API_KEY)
// Free tier: 1 query/sec, 2,000 queries/month. Locke usage ≪ ceiling.
// ============================================================================
export const braveAdapter: SearchAdapter = {
  name: 'brave',
  matches: () => true, // catch-all; must be LAST in ADAPTERS chain
  search: async (q, env) => {
    if (!env.BRAVE_SEARCH_API_KEY) {
      throw new Error('Brave: BRAVE_SEARCH_API_KEY not set');
    }
    const url = new URL('https://api.search.brave.com/res/v1/web/search');
    url.searchParams.set('q', q);
    url.searchParams.set('count', '10');
    const r = await fetch(url.toString(), {
      headers: {
        'Accept': 'application/json',
        'X-Subscription-Token': env.BRAVE_SEARCH_API_KEY,
        'User-Agent': 'locke-harvest/2.0'
      }
    });
    if (!r.ok) {
      const body = await r.text().catch(() => '');
      throw new Error(`Brave ${r.status}: ${body.slice(0, 200)}`);
    }
    const data: any = await r.json();
    const results = data?.web?.results || [];
    return results.slice(0, 10).map((res: any) => ({
      url: res.url || '',
      title: res.title || '',
      content: (res.description || '').slice(0, 500),
      engine: 'brave'
    }));
  }
};

// ============================================================================
// Adapter chain — first-match-wins. Reddit + HN only (Z3 free-coverage path,
// 2026-05-11 evening). braveAdapter still exported above as opt-in fallback if
// Tyler ever wants paid-tier coverage; removed from active chain to keep the
// system 100% free.
//
// HUNT_CLUSTERS query distribution (post-Z3 reshape):
//   - site:reddit.com[/r/X]:       15 queries → redditAdapter
//   - site:news.ycombinator.com:    5 queries → hnAdapter
// = 20/20 queries on free direct APIs (Reddit anon 60/min + HN Algolia generous).
// 7 queries replaced lobsters/indiehackers targets with reddit subreddit
// equivalents (r/sysadmin, r/Entrepreneur, r/SideProject, r/webdev,
// r/smallbusiness, r/SideProject, r/buildinpublic) — distinct subreddits count
// as distinct communities per LOCKE-OUTPUT-SCHEMA §2, so cross-community
// diversity for `pattern_type: repeated` is preserved.
// ============================================================================
const ADAPTERS: SearchAdapter[] = [redditAdapter, hnAdapter];

/**
 * Search dispatcher. Picks the first matching adapter, runs it.
 * Re-throws with adapter name prefix so caller's catch can log which adapter
 * failed without inspecting error internals.
 */
export async function search(query: string, env: AdapterEnv): Promise<SearchResult[]> {
  for (const adapter of ADAPTERS) {
    if (adapter.matches(query)) {
      try {
        return await adapter.search(query, env);
      } catch (e: any) {
        const msg = e?.message ?? String(e);
        throw new Error(`${adapter.name}: ${msg}`);
      }
    }
  }
  return [];
}

/** Exported for telemetry — which adapter would handle this query string. */
export function routeFor(query: string): string {
  for (const a of ADAPTERS) if (a.matches(query)) return a.name;
  return 'none';
}
