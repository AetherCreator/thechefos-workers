# Clue 1: NIM Adapter [CODE]

## Objective
Create `packages/ai-gateway/src/nim-adapter.ts` translating between Anthropic Messages API shape and OpenAI Chat Completions shape, so a NIM call can serve an Anthropic-style request transparently.

## Files to Create
- `packages/ai-gateway/src/nim-adapter.ts`

## Files to Read First
- `packages/ai-gateway/src/index.ts` (existing types `AnthropicMessage`, `AnthropicRequestBody`)

## Specification

### `anthropicToOpenAI(body: AnthropicRequestBody): OpenAIRequest`
- Flatten `body.system` (string) into a leading `{role:'system', content:body.system}` message if present
- Pass `messages` through, but: if a message has array content (tool blocks etc.), filter to just `{type:'text'}` blocks and join their `.text` with newlines
- Map `max_tokens` → `max_tokens`, `temperature` → `temperature` (default 0.7 if missing)
- Set `model` from a hardcoded const `NIM_MODEL = 'meta/llama-3.3-70b-instruct'` — IGNORE the caller's model field
- Drop everything else (Anthropic-only fields like `tools`, `tool_choice`, `metadata`)

### `openAIToAnthropic(resp: OpenAIResponse, requestedModel: string): AnthropicResponse`
- Wrap `resp.choices[0].message.content` as `{type:'text', text: <content>}` inside `content` array
- Mirror `usage.prompt_tokens` → `input_tokens`, `usage.completion_tokens` → `output_tokens`
- Map `finish_reason`: `'stop'` → `'end_turn'`, `'length'` → `'max_tokens'`, anything else → `'end_turn'`
- Set `id: 'msg_' + resp.id`, `type: 'message'`, `role: 'assistant'`, `model: requestedModel` (echo back what caller asked for, for shape compat)
- Set `stop_sequence: null`

### Inline Test Cases (at bottom of file, runnable via `tsx nim-adapter.ts`)
Three cases, each `console.assert` based:
1. **Round-trip basic:** Anthropic body with system + 1 user message → OpenAI shape has [system, user] in order
2. **Filtering tool blocks:** Anthropic message with `content: [{type:'text',text:'hi'},{type:'tool_use',...}]` → OpenAI message has just 'hi'
3. **Response shape:** mock OpenAI response → Anthropic-shape result has `content[0].text` non-empty, `usage.input_tokens` numeric

## Verification
```bash
cd packages/ai-gateway
npx tsc --noEmit src/nim-adapter.ts
# (test runs are optional — main pass condition is tsc clean)
```

## Pass Condition
- File exists at `packages/ai-gateway/src/nim-adapter.ts`
- `tsc --noEmit` reports zero errors against this file
- Two exported functions: `anthropicToOpenAI`, `openAIToAnthropic`
- Push: `git add packages/ai-gateway/src/nim-adapter.ts && git commit -m "ai-gateway: add NIM adapter (clue 1)" && git push`

## Then Write
`hunts/the-anthropic-key-injection/clue-1/COMPLETE.md` with the commit SHA.
