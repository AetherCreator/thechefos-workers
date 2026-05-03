# Clue 2: Route + Deploy [CODE]

## Objective
Wire the Clue-1 adapters into `packages/ai-gateway/src/index.ts` so POST `/ai/v1/messages` with header `x-product: morewords` (or `superconci`) routes to NIM (Nemotron) with Workers AI fallback. Deploy worker. Verify live HTTP 200 with Anthropic-shape response.

## Files to Read First
- `packages/ai-gateway/src/adapters.ts` (Clue 1 output)
- `packages/ai-gateway/src/index.ts` (current Anthropic flow)
- `packages/ai-gateway/wrangler.toml` (current secrets/bindings)

## Changes

### `packages/ai-gateway/src/index.ts`
Inside the existing `fetch` handler, after the `isKidProduct` check but BEFORE the gateway proxy fetch, branch on kid-product:
- If `isKidProduct && request.method === 'POST' && url.pathname === '/ai/v1/messages'`:
  - Parse body as `AnthropicRequestBody`
  - Call `anthropicReqToOpenAI(body)` → NIM payload
  - Inject brain context the same way the existing flow does (reuse `searchBrain` + `buildBrainContext` already in the file — prepend to `messages[0]` if it's a system message, else insert one)
  - POST to `https://integrate.api.nvidia.com/v1/chat/completions` with `Authorization: Bearer ${env.NVIDIA_API_KEY}`
  - On HTTP 429 or 5xx → fallback to `env.AI.run('@cf/meta/llama-3.3-70b-instruct-fp8-fast', { messages: openaiBody.messages, max_tokens: openaiBody.max_tokens })`. Workers AI returns `{response: 'text'}` — wrap into synthetic OpenAI shape `{id:'wai-fallback', choices:[{message:{content: response}, finish_reason: 'stop'}], usage: {prompt_tokens: 0, completion_tokens: 0}}` before passing to `openAIRespToAnthropic`.
  - Return `openAIRespToAnthropic(...)` as `Response` with `Content-Type: application/json`
- Else: keep existing Anthropic flow exactly as-is (non-kid products continue to Anthropic Gateway — out of scope for this hunt)

### `packages/ai-gateway/wrangler.toml`
Add at top-level (not under `[vars]`):
```toml
[ai]
binding = "AI"
```

### `Env` interface in `index.ts`
Add:
```ts
NVIDIA_API_KEY: string
AI: Ai  // import Ai from '@cloudflare/workers-types' if needed
```

### Set the secret
```bash
cd packages/ai-gateway
echo "$(cat /opt/secrets/nvidia-api-key)" | npx wrangler secret put NVIDIA_API_KEY
```
(Existing CF_API_TOKEN and CF_ACCOUNT_ID secrets unchanged.)

## Deploy
```bash
cd packages/ai-gateway
npx wrangler deploy
```

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

# Test 2: non-kid route still hits Anthropic (regression)
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
- Commit + push to origin/main: `the-token-detour: clue-2 wire NIM route + deploy`

## Out of Scope
- PWA repoint (Clue 3)
- Streaming
- Per-product rate limits
- Cost tracking dashboard
