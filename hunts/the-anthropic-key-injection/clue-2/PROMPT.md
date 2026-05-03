# Clue 2: NIM Route in Gateway [CODE]

## Objective
Wire the NIM adapter from clue-1 into the gateway worker. When `x-product` header is `morewords` or `superconci`, route to NIM. Otherwise, existing Anthropic path. Deploy and smoke-test.

## Files to Edit
- `packages/ai-gateway/src/index.ts`
- `packages/ai-gateway/wrangler.toml` (env var documentation only — secret set via wrangler CLI)

## Files to Read First
- `packages/ai-gateway/src/index.ts` (current routing logic in `fetch` handler)
- `packages/ai-gateway/src/nim-adapter.ts` (from clue 1)

## Specification

### Add to `Env` interface in `index.ts`
```ts
NVIDIA_API_KEY: string  // wrangler secret put NVIDIA_API_KEY
```

### Add new function `handleNIM(request, env, body)` in `index.ts`
- Convert `body` (Anthropic shape) → OpenAI shape via `anthropicToOpenAI(body)`
- POST to `https://integrate.api.nvidia.com/v1/chat/completions`
  - `Authorization: Bearer ${env.NVIDIA_API_KEY}`
  - `Content-Type: application/json`
- On success: convert via `openAIToAnthropic(nim_response, body.model || 'claude-sonnet-4-5')`, return as `Response` with status 200
- On 429 or 5xx: log `console.log('nim_route fallback', status)` then fall through to existing Anthropic gateway path
- Single retry max — no loops

### Modify the existing `fetch` handler
At the top of the Anthropic-route branch (after `isKidProduct` is computed, before the existing gateway forward):
```ts
if (isKidProduct && request.method === 'POST') {
  try {
    const bodyText = await request.text()
    const body: AnthropicRequestBody = JSON.parse(bodyText)
    // Brain context injection still happens (existing logic)
    const query = extractUserQuery(body.messages ?? [])
    const brainResults = query ? await searchBrain(query) : []
    const brainContext = buildBrainContext(brainResults)
    if (brainContext) {
      body.system = body.system ? `${brainContext}\n\n${body.system}` : brainContext
    }
    const nimResponse = await handleNIM(request, env, body)
    if (nimResponse.status === 200) {
      console.log('nim_route success', { product })
      return nimResponse
    }
    // fall through to gateway on non-200
    console.log('nim_route fallback to gateway', { status: nimResponse.status })
    // reconstruct request body for downstream
    request = new Request(request.url, { method: 'POST', headers: request.headers, body: JSON.stringify(body) })
  } catch (e) {
    console.log('nim_route error, falling through', e)
  }
}
// ...existing Anthropic gateway code below unchanged
```

### `wrangler.toml` update
Add comment under `[vars]`:
```
# NVIDIA_API_KEY set via: wrangler secret put NVIDIA_API_KEY
```

## Deploy
```bash
cd packages/ai-gateway
# (assume secret already set; if not, the test request will fall through to gateway and 401 — that's the diagnostic signal)
npx wrangler deploy
```

## Smoke Test (must pass)
```bash
curl -sS -X POST "https://api.thechefos.app/ai/v1/messages" \
  -H "Content-Type: application/json" \
  -H "x-product: morewords" \
  -H "anthropic-version: 2023-06-01" \
  -d '{"model":"claude-sonnet-4-5","max_tokens":50,"messages":[{"role":"user","content":"reply with the JSON array [1,2,3] and nothing else"}]}'
```
Expected: HTTP 200, body has `content[0].text` containing `[1,2,3]` (or similar — model decides).

## Pass Condition
- Wrangler deploy succeeds
- Smoke test returns 200 with valid Anthropic-shape body
- Commit + push deploy artifact + code

## Then Write
`hunts/the-anthropic-key-injection/clue-2/COMPLETE.md` with deploy URL, smoke-test response sample, commit SHA.
