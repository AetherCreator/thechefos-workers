// packages/mcp-server/src/enrich.ts
// Sidecar Brain — enriches MCP tool responses with relevant brain context from brain-search
// Improvement #4: Proactive Context Push — prepended BRAIN CONTEXT block, 500ms timeout, top-3 results

const BRAIN_SEARCH_URL =
  "https://api.thechefos.app/api/brain/search";

// 500ms — fail fast, never block tool response
const BRAIN_SEARCH_TIMEOUT_MS = 500;

const NOISE_WORDS = new Set([
  "get", "set", "list", "put", "delete", "create", "update", "read",
  "file", "api", "index", "src", "the", "a", "an", "of", "in", "to",
  "for", "and", "from", "with", "by", "is", "on", "at", "as", "or",
  "its", "be", "this", "that", "it", "all", "not", "but", "are",
  "was", "were", "been", "has", "have", "had", "do", "does", "did",
  "will", "would", "should", "could", "may", "might", "shall",
  "md", "ts", "js", "json", "txt", "gd", "default", "main",
]);

// Map common path segments to meaningful domain keywords
const PATH_DOMAIN_MAP: Record<string, string> = {
  "chef": "chef",
  "recipe": "recipe",
  "levain": "chef levain",
  "baking": "chef baking",
  "battle": "game battle",
  "scripts": "game",
  "aether-chronicles": "aether game",
  "superconci": "kids learning",
  "morewords": "vocabulary",
  "brain": "brain knowledge",
  "professional": "professional",
  "personal": "personal",
  "projects": "projects",
  "patterns": "patterns",
  "session": "session",
  "skills": "skills",
};

/** Tools that should NOT get brain enrichment (already brain-aware, meta, or write ops) */
export const SKIP_ENRICHMENT = new Set([
  "get_active_state",
  "get_ops_board",
  "get_brain_node",
  "list_skills",
  "get_skill",
  "cf_kv_get",
  "cf_kv_set",
  "cf_kv_list",
  "cf_secret_set",
  "preload_context", // brain-search tool itself — no recursive enrichment
]);

// ── Keyword Extraction Engine ─────────────────────────────────────────────

/**
 * Extracts meaningful search keywords from an MCP tool call.
 * Returns a 3-8 word query suitable for semantic search.
 */
export function extractKeywords(
  toolName: string,
  params: Record<string, unknown>,
  response: string,
): string {
  const parts: string[] = [];

  // 1. Extract from tool name — split on underscores, drop noise
  const nameTokens = toolName
    .split("_")
    .filter((w) => !NOISE_WORDS.has(w.toLowerCase()));
  parts.push(...nameTokens);

  // 2. Extract from params — grab high-value fields
  const paramKeys = ["repo", "path", "skill_name", "key", "sql", "q", "query", "summary"];
  for (const k of paramKeys) {
    const val = params[k];
    if (typeof val === "string" && val.length > 0) {
      parts.push(...extractFromValue(k, val));
    }
  }

  // 3. Extract from response (first 500 chars) — domain-specific nouns
  if (response.length > 0) {
    const snippet = response.slice(0, 500);
    const responseTokens = extractDomainTokens(snippet);
    parts.push(...responseTokens.slice(0, 3));
  }

  // Deduplicate, strip noise, and limit to 3-8 words
  const cleaned = [...new Set(
    parts
      .flatMap((p) => p.split(/[\s/\\._-]+/))
      .map((w) => w.toLowerCase().replace(/[^a-z0-9]/g, ""))
      .filter((w) => w.length > 1 && !NOISE_WORDS.has(w)),
  )];

  return cleaned.slice(0, 8).join(" ");
}

/** Extract meaningful tokens from a parameter value */
function extractFromValue(key: string, value: string): string[] {
  const tokens: string[] = [];

  if (key === "path") {
    const segments = value.split(/[/\\]/);
    for (const seg of segments) {
      const lower = seg.toLowerCase().replace(/\.[^.]+$/, "");
      if (PATH_DOMAIN_MAP[lower]) {
        tokens.push(PATH_DOMAIN_MAP[lower]);
      } else if (lower.length > 2 && !NOISE_WORDS.has(lower)) {
        tokens.push(
          ...lower
            .replace(/([a-z])([A-Z])/g, "$1 $2")
            .split(/[-_\s]+/)
            .filter((w) => w.length > 2 && !NOISE_WORDS.has(w)),
        );
      }
    }
  } else if (key === "sql") {
    const tableMatch = value.match(/(?:FROM|INTO|UPDATE|JOIN)\s+(\w+)/gi);
    if (tableMatch) {
      for (const m of tableMatch) {
        const table = m.split(/\s+/).pop()!;
        if (!NOISE_WORDS.has(table.toLowerCase())) tokens.push(table);
      }
    }
    const whereMatch = value.match(/(?:domain|type|category)\s*=\s*'([^']+)'/gi);
    if (whereMatch) {
      for (const m of whereMatch) {
        const val = m.split("'")[1];
        if (val) tokens.push(val);
      }
    }
  } else if (key === "repo") {
    tokens.push(value.toLowerCase().replace(/[^a-z0-9-]/g, ""));
  } else {
    tokens.push(
      ...value
        .split(/[\s/\\._-]+/)
        .filter((w) => w.length > 2 && !NOISE_WORDS.has(w.toLowerCase())),
    );
  }

  return tokens;
}

/** Extract domain-specific tokens from a text snippet */
function extractDomainTokens(text: string): string[] {
  const capitalWords = text.match(/\b[A-Z][a-z]{2,}\b/g) || [];
  const domainHits: string[] = [];
  const lower = text.toLowerCase();
  for (const [key, domain] of Object.entries(PATH_DOMAIN_MAP)) {
    if (lower.includes(key)) domainHits.push(domain);
  }

  return [
    ...domainHits,
    ...capitalWords
      .map((w) => w.toLowerCase())
      .filter((w) => !NOISE_WORDS.has(w)),
  ];
}

// ── Brain Search Integration ──────────────────────────────────────────────

export interface BrainContext {
  path: string;
  score: number;
  preview: string;
}

/**
 * Queries the brain-search endpoint for relevant brain nodes.
 * Returns top-3 results or empty array on failure/timeout.
 * Hard 500ms timeout — never blocks the parent tool response.
 */
export async function searchBrain(
  query: string,
  limit: number = 3,
): Promise<BrainContext[]> {
  if (!query || query.trim().length === 0) return [];

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), BRAIN_SEARCH_TIMEOUT_MS);

    const res = await fetch(BRAIN_SEARCH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, limit }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!res.ok) return [];

    const data = (await res.json()) as {
      results?: Array<{ path?: string; score?: number; preview?: string }>;
    };

    if (!data.results || !Array.isArray(data.results)) return [];

    return data.results
      .filter((r) => typeof r.score === "number" && r.score > 50)
      .slice(0, limit)
      .map((r) => ({
        path: r.path || "unknown",
        score: r.score!,
        preview: (r.preview || "").slice(0, 250),
      }));
  } catch {
    return [];
  }
}

// ── Enrichment Wrapper ────────────────────────────────────────────────────

type McpToolResult = {
  content: Array<{ type: "text"; text: string }>;
};

/**
 * Formats brain context results into a BRAIN CONTEXT block.
 * Prepended before tool output so Claude sees context first.
 */
export function formatBrainContext(results: BrainContext[]): string {
  if (results.length === 0) return "";
  const lines = results.map(
    (r) => `  [${r.path}] (score: ${r.score})\n  ${r.preview}`,
  );
  return `--- BRAIN CONTEXT (top ${results.length} relevant nodes) ---\n${lines.join("\n\n")}\n--- END BRAIN CONTEXT ---`;
}

/**
 * Creates an enriched proxy call function that wraps the standard proxyCall.
 * Searches the brain using keywords extracted from the tool call params,
 * then PREPENDS the BRAIN CONTEXT block before the tool result.
 * If brain search fails or times out (500ms), proceeds without context.
 */
export function createEnrichedProxyCall(
  proxyCall: (
    service: string,
    operation: string,
    params: Record<string, unknown>,
  ) => Promise<McpToolResult>,
) {
  return async function enrichedProxyCall(
    toolName: string,
    service: string,
    operation: string,
    params: Record<string, unknown>,
  ): Promise<McpToolResult> {
    // 1. Extract keywords from params BEFORE the proxy call (proactive)
    const keywords = extractKeywords(toolName, params, "");

    // 2. Fire brain search and proxy call concurrently — 500ms cap on brain search
    const [result, brainResults] = await Promise.all([
      proxyCall(service, operation, params),
      keywords ? searchBrain(keywords, 3) : Promise.resolve([]),
    ]);

    // 3. No brain context found — return result as-is
    if (brainResults.length === 0) return result;

    // 4. PREPEND brain context before the tool result (proactive context push)
    const brainText = formatBrainContext(brainResults);
    return {
      content: [
        { type: "text" as const, text: brainText },
        ...result.content,
      ],
    };
  };
}
