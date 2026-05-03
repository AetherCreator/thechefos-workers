# Clue 1: Adapter Functions [CODE]

## Objective
Create `packages/ai-gateway/src/adapters.ts` with two pure functions that translate between Anthropic Messages API shape and OpenAI Chat Completions shape (NIM-compat). Add vitest tests. No worker deploy. No external network.

## Files to Write
- `packages/ai-gateway/src/adapters.ts` — the adapter functions
- `packages/ai-gateway/src/adapters.test.ts` — vitest unit tests
- `packages/ai-gateway/vitest.config.ts` — minimal vitest config (only if not present)
- `packages/ai-gateway/package.json` — add `vitest` to devDependencies, add `test` script

## Files to Read First
- `packages/ai-gateway/src/index.ts` (understand current Anthropic flow + `AnthropicRequestBody` interface — reuse it)
- `packages/ai-gateway/package.json` (current dep shape)

## Adapter Specs

### `anthropicReqToOpenAI(body: AnthropicRequestBody): OpenAIRequestBody`
Map:
- `body.model` → `out.model = 'nvidia/llama-3.3-nemotron-super-49b-v1'` (hardcode for now; ignore caller's model)
- `body.max_tokens` → `out.max_tokens` (default 512 if missing)
- `body.system` (string) → prepend as `{role:'system', content: body.system}` to messages
- `body.messages` → `out.messages`, mapping each:
  - `role` passes through (`user`, `assistant`)
  - `content` if string → pass through
  - `content` if array → join `text`-type blocks with `\n\n`, ignore other block types

### `openAIRespToAnthropic(resp: OpenAIResponse): AnthropicResponse`
Map:
- `resp.choices[0].message.content` → `out.content = [{type:'text', text: <that content>}]`
- `resp.choices[0].finish_reason` → `out.stop_reason` (`stop` → `end_turn`, `length` → `max_tokens`, else passthrough)
- `resp.usage.prompt_tokens` → `out.usage.input_tokens`
- `resp.usage.completion_tokens` → `out.usage.output_tokens`
- `out.id = resp.id`
- `out.model = 'claude-sonnet-4-6'` (lie consistently — PWA expects this shape, doesn't care about backend)
- `out.role = 'assistant'`
- `out.type = 'message'`

## Test Cases (must all pass)
1. **PWA canonical payload**: input model `claude-sonnet-4-6`, max_tokens 512, single user message about word curation. Verify converted body has system+user roles, max_tokens 512, NIM model name.
2. **System prompt injection**: input has `body.system = "You are X"`. Verify output `messages[0]` is `{role:'system', content:'You are X'}`.
3. **Multi-turn**: input has 3 messages alternating user/assistant. Verify all 3 carry through with roles preserved.
4. **Content array → string**: input message has `content: [{type:'text', text:'A'}, {type:'image', ...}, {type:'text', text:'B'}]`. Verify output is `"A\n\nB"`.
5. **Response shape**: synthetic NIM-style response → adapter returns `{type:'message', role:'assistant', content:[{type:'text', text:...}], stop_reason:'end_turn', usage:{input_tokens, output_tokens}}`.
6. **Round-trip text fidelity**: anthropicReqToOpenAI(req) then synthetic NIM response with same text → openAIRespToAnthropic(resp).content[0].text equals original.

## Run Tests
```bash
cd packages/ai-gateway
npm install
npm test -- --run
```

## Done When
- `packages/ai-gateway/src/adapters.ts` exports both functions
- All 6 vitest tests pass
- TypeScript compiles clean: `npx tsc --noEmit`
- COMPLETE.md captures test output (last `Tests N passed` line) + exports list
- Commit + push to origin/main with message `the-token-detour: clue-1 adapters`

## Out of Scope
- Worker deploy (Clue 2)
- PWA changes (Clue 3)
- Wiring adapter into index.ts (Clue 2)
- Streaming responses
