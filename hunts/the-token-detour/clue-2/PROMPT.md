# Clue 2: Route + Deploy [CODE]

## Objective
Wire the Clue-1 adapters into `packages/ai-gateway/src/index.ts` so POST `/ai/v1/messages` with header `x-product: morewords` (or `superconci`) routes to **Cloudflare Workers AI primary**, with NIM (Nemotron) as fallback. Deploy worker. Verify live HTTP 200 with Anthropic-shape response.

## Why Workers AI primary (changed from initial draft)
- **Zero secrets needed for happy path.** `env.AI` binding is native to the Cloudflare account — no `wrangler secret put` step, no rotation burden.
- **In-network call.** `env.AI.run` stays inside Cloudflare (~30-50ms) vs cross-internet to NIM (~200-300ms).
- **Same model class.** Workers AI runs the same `meta/llama-3.3-70b-instruct` family as NIM.
- **Free tier headroom.** 10K neurons/day = thousands of curation calls. Plenty for kid PWAs at current scale.
- **NIM fallback only matters if Workers AI quota is hit** (rare at our scale). If/when that ever fires, the worker falls through to NIM — but only IF `NVIDIA_API_KEY` is set as a secret. **For this hunt, do NOT set the NIM secret.** The fallback is a code path that only activates if Workers AI returns 429/5xx, and even then only if the env var exists (guard with `if (env.NVIDIA_API_KEY) { ... }`).

## Files to Read First
- `packages/ai-gateway/src/adapters.ts` (Clue 1 output)
- `packages/ai-gateway/src/index.ts` (current Anthropic flow)
- `packages/ai-gateway/wrangler.toml` (current bindings)

## Changes

### `packages/ai-gateway/wrangler.toml`
Add at top level (NOT under `[vars]`):
```toml
[ai]
binding = "AI"
```

### `Env` interface in `index.ts`
Add:
```ts
AI: Ai                          // Workers AI binding (from [ai] in wrangler.toml)
NVIDIA_API_KEY?: string         // Optional fallback only — leave unset for now
```

If TypeScript complains about `Ai` type, ensure `@cloudflare/workers-types` is in `tsconfig.json` `compilerOptions.types` array; if not, add it. Otherwise `Ai` may already be globally available — try without import first.

### Inside the existing `fetch` handler — kid-product branch
After the `isKidProduct` check, BEFORE the gateway proxy fetch, add:

```ts
if (isKidProduct && request.method === 'POST' && url.pathname === '/ai/v1/messages') {
  try {
    const bodyText = await request.text()
    const body: AnthropicRequestBody = JSON.parse(bodyText)
    
    // Brain context injection (reuse existing functions)
    const query = extractUserQuery(body.messages ?? [])
    const brainResults = query ? await searchBrain(query) : []
    const brainContext = buildBrainContext(brainResults)
    if (brainContext) {
      body.system = body.system 
        ? `${brainContext}\n\n${body.system}`
        : brainContext
    }
    
    // Convert Anthropic → OpenAI shape
    const openaiBody = anthropicReqToOpenAI(body)
    
    // ============ PRIMARY: Workers AI ============
    try {
      console.log('workers_ai_primary', { product })
      const aiResp = await env.AI.run('@cf/meta/llama-3.3-70b-instruct-fp8-fast', {
        messages: openaiBody.messages,
        max_tokens: openaiBody.max_tokens ?? 512,
      }) as { response?: string; usage?: { prompt_tokens?: number; completion_tokens?: number } }
      
      // Wrap Workers-AI response into OpenAI shape so adapter can translate
      const openaiShape = {
        id: `wai-${crypto.randomUUID()}`,
        choices: [{ 
          index: 0,
          message: { role: 'assistant' as const, content: aiResp.response ?? '' },
          finish_reason: 'stop' as const,
        }],
        usage: {
          prompt_tokens: aiResp.usage?.prompt_tokens ?? 0,
          completion_tokens: aiResp.usage?.completion_tokens ?? 0,
        },
      }
      const anthropicResp = openAIRespToAnthropic(openaiShape)
      return new Response(JSON.stringify(anthropicResp), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    } catch (waiErr) {
      console.log('workers_ai_failed_trying_nim', String(waiErr))
      
      // ============ FALLBACK: NIM ============
      // Only if NVIDIA_API_KEY is set. If not, surface the WAI error.
      if (!env.NVIDIA_API_KEY) {
        return new Response(JSON.stringify({
          type: 'error',
          error: { type: 'api_error', message: 'Workers AI failed and no NIM fallback configured' },
        }), { status: 502, headers: { 'Content-Type': 'application/json' } })
      }
      
      const nimResp = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${env.NVIDIA_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'meta/llama-3.3-70b-instruct',
          messages: openaiBody.messages,
          max_tokens: openaiBody.max_tokens ?? 512,
          temperature: openaiBody.temperature ?? 0.7,
        }),
      })
      
      if (!nimResp.ok) {
        return new Response(JSON.stringify({
          type: 'error',
          error: { type: 'api_error', message: `Both routes failed: WAI(err) NIM(${nimResp.status})` },
        }), { status: 502, headers: { 'Content-Type': 'application/json' } })
      }
      
      const nimJson = await nimResp.json()
      const anthropicResp = openAIRespToAnthropic(nimJson)
      return new Response(JSON.stringify(anthropicResp), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }
  } catch (parseErr) {
    console.log('kid_product_route_parse_error', String(parseErr))
    return new Response(JSON.stringify({
      type: 'error',
      error: { type: 'invalid_request_error', message: 'Could not parse request body' },
    }), { status: 400, headers: { 'Content-Type': 'application/json' } })
  }
}
// Non-kid products fall through to existing Anthropic flow below (unchanged)
```

### Imports at top of `index.ts`
```ts
import { anthropicReqToOpenAI, openAIRespToAnthropic } from './adapters'
```

## Deploy
```bash
cd packages/ai-gateway
# No secrets needed — [ai] binding is native to CF account
npx wrangler deploy
```
Capture last ~5 lines of deploy output (URL + bindings list).

If `wrangler whoami` reports "not authenticated", surface that as a STUCK condition — do not attempt to authenticate non-interactively.

## Verification (must all pass — capture for COMPLETE.md)

```bash
# Test 1: kid-product route returns 200 + Anthropic shape
curl -sS -o /tmp/v1.json -w "HTTP=%{http_code}\n" -X POST \
  https://api.thechefos.app/ai/v1/messages \
  -H "Content-Type: application/json" \
  -H "x-product: morewords" \
  -d '{"model":"claude-sonnet-4-6","max_tokens":32,"messages":[{"role":"user","content":"Reply with the digit 1, nothing else."}]}'
cat /tmp/v1.json | python3 -m json.tool
# Required: HTTP=200 AND .content[0].text contains "1"

# Test 2: non-kid route still hits Anthropic gateway (regression)
curl -sS -o /dev/null -w "HTTP=%{http_code}\n" -X POST \
  https://api.thechefos.app/ai/v1/messages \
  -H "Content-Type: application/json" \
  -d '{"model":"claude-sonnet-4-6","max_tokens":32,"messages":[{"role":"user","content":"hi"}]}'
# Required: HTTP=401 (proves non-kid path unchanged)
```

## Done When
- Worker deployed (wrangler deploy exit 0; capture deployment URL)
- Test 1: HTTP 200 with valid `content[0].text`
- Test 2: HTTP 401 (regression-clean)
- COMPLETE.md captures: deploy output (last 5 lines), Test 1 full body, Test 2 status
- Commit + push to origin/main: `the-token-detour: clue-2 wire WAI-primary route + deploy`

## Out of Scope
- Setting NIM secret (deferred until/unless WAI quota becomes a real problem)
- PWA repoint (Clue 3)
- Streaming
- Per-product rate limits
- Cost tracking dashboard
