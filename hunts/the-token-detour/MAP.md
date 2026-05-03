# the-token-detour — MAP

## Mission
Re-route the `ai-gateway` Worker to use NVIDIA NIM (Nemotron) instead of Anthropic when `x-product` is `morewords` or `superconci`. Eliminate per-token API costs for kid-product AI curation. PWA contract (Anthropic response shape) stays unchanged — adapter handles translation.

## Why
- Anthropic API costs scale per-call; would conflict with Tyler's $100/mo budget cap
- NIM key is already on the box, hunters use it daily, free under Build tier
- Cloudflare Workers AI is free safety-net (10k neurons/day) on same account
- Brain-context injection (already in worker) keeps working — only model backend changes

## Key Surfaces
- Worker: `packages/ai-gateway/src/index.ts` (single-file currently)
- Worker config: `packages/ai-gateway/wrangler.toml`
- Worker live: `https://api.thechefos.app/ai/v1/messages` (returns 401 today, will return 200 post-hunt)
- Test surface: NIM at `https://integrate.api.nvidia.com/v1/chat/completions` (OpenAI-compat)
- Fallback: `env.AI.run('@cf/meta/llama-3.3-70b-instruct-fp8-fast')` (Workers AI binding)

## Pre-Hunt Checklist
- [x] Quartermaster verified by file reads, not memory
- [x] All clues [CODE] [Nemotron-120B] — no chat design needed
- [x] Push step in every clue's pass condition
- [x] Slim PROMPT.md format applied

## Parallelism Graph

```
Clue 1 ── Clue 2 ── Clue 3
```

Sequential by design — each clue's output is the next clue's precondition.

```json
{
  "hunt": "the-token-detour",
  "clues": {
    "1": { "deps": [], "model": "nemotron-120b" },
    "2": { "deps": ["1"], "model": "nemotron-120b" },
    "3": { "deps": ["2"], "model": "nemotron-120b" }
  }
}
```

### Conductor-Resolver DAG (flat format)
```json
{
  "deps": {
    "1": [],
    "2": ["1"],
    "3": ["2"]
  }
}
```

## Clues

### Clue 1 — `[CODE]` Adapter
Build `packages/ai-gateway/src/adapters.ts`. Two pure functions: `anthropicReqToOpenAI(body)` and `openAIRespToAnthropic(resp)`. Vitest unit tests for round-trip equivalence on canonical PWA payload. No deploy.

### Clue 2 — `[CODE]` Route + Deploy
Edit `index.ts`: when `x-product ∈ {morewords, superconci}` AND request is POST `/ai/v1/messages`, route to NIM via adapter. On NIM 429/5xx, fallback to `env.AI.run(...)` (Workers AI binding). Add `NVIDIA_API_KEY` secret + `AI` binding to `wrangler.toml`. Deploy. Verify `curl POST /ai/v1/messages` with `x-product: morewords` returns 200 + Anthropic-shape `content[0].text`.

### Clue 3 — `[CODE]` PWA Repoint + Verify
Edit `apps/more-words-pwa/src/utils/aiCuration.ts` in `AetherCreator/more` repo: change URL to `https://api.thechefos.app/ai/v1/messages`. Build (`npm run build`). Commit + push. Re-run the original Comms Test from launch-pad clue 2 spec. COMPLETE includes the live HTTP 200 response + content snippet.

## Dead End Protocol
3 failures on the same clue → STUCK.md, surface immediately.
Pre-identified stuck scenarios:
- Clue 1: vitest install fails, type errors in adapter
- Clue 2: wrangler deploy fails (auth, syntax), NIM 401 (key wrong), Workers AI binding rejected
- Clue 3: build fails, push fails, end-to-end test returns non-200

## Done When
- All three COMPLETE.md present on origin/main
- `curl -X POST https://api.thechefos.app/ai/v1/messages -H 'x-product: morewords' -d '{...}'` returns HTTP 200 with `content[0].text`
- MoreWords PWA build artifact references new URL
- No Anthropic-API-Key required from PWA (server-side NIM call only)

## Out of Scope
- Auth/HMAC on the gateway (separate hardening hunt)
- Rate-limiting per `x-product` (separate)
- Telemetry / cost tracking (future)
- SuperConci PWA repoint — same fix but tracked as follow-up; this hunt unblocks MoreWords specifically
