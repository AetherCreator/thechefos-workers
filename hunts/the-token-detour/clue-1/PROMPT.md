# Clue 1: Adapter Functions [CODE]

## Objective
Create `packages/ai-gateway/src/adapters.ts` with two pure functions that translate between Anthropic Messages API shape and OpenAI Chat Completions shape (NIM-compat). Add vitest tests. No worker deploy. No external network.

## Setup (run before writing files)
```bash
cd packages/ai-gateway
npm install --save-dev typescript vitest @types/node
```
This guarantees `tsc` and `vitest` are real binaries in `node_modules/.bin/`. Do not skip — `npx tsc` without this resolves to a broken stub package.

## Files to Read First
- `packages/ai-gateway/src/index.ts` — already declares `interface AnthropicRequestBody`. Reuse it via `import type { AnthropicRequestBody } from './index'`. Do not redefine.

## Files to Write
- `packages/ai-gateway/src/adapters.ts` — the two adapter functions + small local interfaces (`OpenAIRequestBody`, `OpenAIResponse`, `AnthropicResponse`)
- `packages/ai-gateway/src/adapters.test.ts` — vitest unit tests
- `packages/ai-gateway/vitest.config.ts` — only if not already present (minimal: `import {defineConfig} from 'vitest/config'; export default defineConfig({})`)
- `packages/ai-gateway/tsconfig.json` — only if not already present (minimal: `{"compilerOptions":{"target":"ES2022","module":"ES2022","moduleResolution":"bundler","strict":true,"skipLibCheck":true,"types":["node"]},"include":["src/**/*.ts"]}`)
- `packages/ai-gateway/package.json` — add `"test": "vitest run"` to `scripts` block. Setup step already added vitest+typescript+@types/node to devDependencies.

## Adapter Specs

### `anthropicReqToOpenAI(body: AnthropicRequestBody): OpenAIRequestBody`
Where `OpenAIRequestBody = { model: string; messages: { role: string; content: string }[]; max_tokens?: number; temperature?: number }`.

Mapping:
- `out.model = 'nvidia/llama-3.3-nemotron-super-49b-v1'` — hardcoded NIM model id; caller's `body.model` is the PWA-facing identifier and is not relevant to the NIM backend
- `out.max_tokens = body.max_tokens ?? 512`
- If `body.system` is a non-empty string, prepend `{ role: 'system', content: body.system }` to the output messages array
- For each `body.messages[i]`:
  - `role` passes through (`'user'` | `'assistant'`)
  - `content` if string → pass through
  - `content` if array of blocks → join `block.type === 'text'` blocks with `'\n\n'` (ignore non-text block types)

### `openAIRespToAnthropic(resp: OpenAIResponse, requestedModel?: string): AnthropicResponse`
Where:
- `OpenAIResponse = { id: string; choices: [{ message: { role: string; content: string }; finish_reason: string }]; usage: { prompt_tokens: number; completion_tokens: number } }`
- `AnthropicResponse = { id: string; type: 'message'; role: 'assistant'; content: [{ type: 'text'; text: string }]; model: string; stop_reason: string; usage: { input_tokens: number; output_tokens: number } }`

Mapping:
- `out.id = resp.id`
- `out.type = 'message'`, `out.role = 'assistant'`
- `out.content = [{ type: 'text', text: resp.choices[0].message.content }]`
- `out.model = requestedModel ?? 'claude-sonnet-4-6'` — echoes the caller's PWA-facing model id when provided. Default keeps the existing PWA contract working without breaking clue-2 call sites that don't pass the second arg.
- `out.stop_reason`: map `'stop' → 'end_turn'`, `'length' → 'max_tokens'`, otherwise passthrough
- `out.usage.input_tokens = resp.usage.prompt_tokens`
- `out.usage.output_tokens = resp.usage.completion_tokens`

## Test Cases (must all pass — exactly 6, no more, no fewer)
Use `describe`/`it`/`expect` from `vitest`.

1. **PWA payload → NIM shape**: input model `'claude-sonnet-4-6'`, `max_tokens: 512`, one user message. Assert output `model === 'nvidia/llama-3.3-nemotron-super-49b-v1'`, `max_tokens === 512`, `messages.length === 1`, `messages[0].role === 'user'`.
2. **System prompt prepended**: input has `body.system = 'You are X'`. Assert output `messages[0]` is `{ role: 'system', content: 'You are X' }` and the original user message follows at `messages[1]`.
3. **Multi-turn passthrough**: 3 alternating user/assistant messages. Assert all 3 carry through with roles preserved in order.
4. **Content blocks → joined string**: input message `content: [{type:'text',text:'A'},{type:'image',source:{}},{type:'text',text:'B'}]`. Assert output `messages[0].content === 'A\n\nB'`.
5. **NIM response → Anthropic shape**: synthetic OpenAI-style response with `finish_reason: 'stop'`, `prompt_tokens: 10`, `completion_tokens: 7`. Assert output: `type === 'message'`, `role === 'assistant'`, `content[0].text` matches input text, `stop_reason === 'end_turn'`, `usage.input_tokens === 10`, `usage.output_tokens === 7`.
6. **Round-trip + model echo**: build a request → call `anthropicReqToOpenAI` → fabricate OpenAI response with `choices[0].message.content` set to a known string → call `openAIRespToAnthropic(resp, 'claude-haiku-4-5')`. Assert `output.content[0].text` equals the known string AND `output.model === 'claude-haiku-4-5'`. Then call `openAIRespToAnthropic(resp)` (no second arg). Assert `output.model === 'claude-sonnet-4-6'`.

## Done When (in order, no skipping)
1. Setup step ran successfully (verified by `node_modules/.bin/tsc --version` and `node_modules/.bin/vitest --version` both succeeding).
2. All listed files written.
3. `npm test -- --run` exits 0 with all 6 tests reported as passed.
4. `npx tsc --noEmit` exits 0 (no type errors).
5. Commit + push via `tool_git_commit_push` with message `the-token-detour: clue-1 adapters` succeeds (returns a `commit_sha`).
6. Write `hunts/the-token-detour/clue-1/COMPLETE.md` via `tool_file_write` capturing: vitest summary line, tsc output (empty on clean), commit SHA, list of exported symbols from adapters.ts.
7. Call `tool_hunt_complete`.

## STOP When Done
After step 7, **do not run any further tool calls**. No `bash_exec` for `ls`, `cat`, or any verification beyond steps 1–7. The hunt is complete; the run terminates.

## Anti-Patterns (refusal rules)
- **No editorial comments in code.** Comments describe behavior. Do not write comments like `// lie`, `// hack`, `// temporary`, or other subjective phrasing — even if the surrounding spec uses informal language. Reword as factual behavior description.
- **No exploration loops.** If a Done-When step succeeds, advance to the next. If it fails, read the actual error output and address the root cause — do not run `ls -la`, `cat`, or repeat-the-same-command waiting for a different signal.
- **No skipping Setup.** `npx tsc` without first installing typescript will resolve to a stub `tsc@2.0.4` package and produce confusing output. Always run the Setup step first.
- **No silent regression of clue-2 contract.** `openAIRespToAnthropic`'s second arg must be optional with the documented default — clue-2 call sites do not pass it.

## Out of Scope
- Worker deploy / wrangler config (clue-2)
- PWA repoint (clue-3)
- Wiring adapter into `index.ts` (clue-2)
- Streaming responses, multi-modal blocks beyond text, tool/function calling
