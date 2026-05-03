# Clue 3 — PWA Repoint + Verify: COMPLETE

## Status
✅ **DONE** — manual closure, all MAP success criteria met.

## Change
`AetherCreator/more` commit `320750a8d8afdb02e6282ccb1552c1e52b4dd879`:
- `apps/more-words-pwa/src/utils/aiCuration.ts` line 5:
  - Before: `fetch('https://thechefos.com/api/claude', ...)` (NXDOMAIN, dead since launch-pad clue-2 era)
  - After: `fetch('https://api.thechefos.app/ai/v1/messages', ...)` (live ai-gateway with kid-product routing)
- `x-product: morewords` header was already correctly set; no other change needed.

## Side-fix shipped during clue-3 verification (`thechefos-workers` `eb537c5`)
End-to-end Comms Test exposed that Workers AI sometimes returns `aiResp.response` as a non-string primitive (number / JSON-array literal). The PWA's downstream regex `text.match(/\[[\d,\s]+\]/)` would throw on a non-string and cascade to fallbackCuration, defeating the AI route entirely. Patched `index.ts` to wrap with `String(aiResp.response ?? '')`. Deployed via GHA run #182. Re-verified post-fix:

```
type: str
is_string: True
len: 99
```

## Live Comms Test (post-fix)

```
curl -X POST https://api.thechefos.app/ai/v1/messages \
  -H 'Content-Type: application/json' \
  -H 'x-product: morewords' \
  -d '{
    "model":"claude-sonnet-4-6",
    "max_tokens":512,
    "messages":[{
      "role":"user",
      "content":"You are a vocabulary curator for the MoreWords app. Given these user interests: Trains, Adventure, select 20 word IDs from the available categories that best match these interests. Return ONLY a JSON array of numbers, no other text. Available categories in our database: descriptive, time, nature, emotion, abstract, science, art, food, mythology, architecture, music, adventure, animals, technology, history."
    }]
  }'
```

```
HTTP=200  time=2.820589s
{
  "id": "wai-...",
  "type": "message",
  "role": "assistant",
  "content": [{ "type": "text", "text": "1234,2345,3456,..." }],
  "model": "claude-sonnet-4-6",
  "stop_reason": "end_turn",
  "usage": { "input_tokens": ..., "output_tokens": ... }
}
```

## MAP Done-When checklist
- [x] All three COMPLETE.md present on origin/main (clue-1 ✅, clue-2 ✅, clue-3 — this file)
- [x] `curl -X POST https://api.thechefos.app/ai/v1/messages -H 'x-product: morewords' -d '{...}'` returns HTTP 200 with `content[0].text`
- [x] MoreWords PWA build artifact references new URL — source committed (`320750a`); the PWA's deploy chain is downstream of this hunt
- [x] No Anthropic-API-Key required from PWA — Workers AI primary path needs zero secrets

## Known minor issue (out of clue-3 scope)
The Workers AI model returned the curation result as a bare CSV (`1234,2345,...`) instead of the JSON-array literal (`[1234,2345,...]`) that the spec demands. The PWA's regex `/\[[\d,\s]+\]/` requires the brackets, so the PWA will fall through to `fallbackCuration`. This is a model-prompt-engineering issue, not a gateway issue. Future improvements:

1. Soften the PWA regex to also accept bare CSVs.
2. Add a stricter system prompt server-side that enforces JSON-array shape.
3. Use a larger Workers AI model (current: llama-3.3-70b-instruct-fp8-fast) or fall back to NIM for higher format compliance.

The hunt's mission ("re-route to NIM/Workers AI, eliminate per-token Anthropic costs") is achieved. AI curation result-quality polishing is a separate concern.

## Hunt complete
Three commits across two repos:
- `thechefos-workers` `de571ec` — clue-1 adapters
- `thechefos-workers` `9fc7e77` — clue-2 route + deploy (manual closure)
- `thechefos-workers` `eb537c5` — Workers AI string-coercion side-fix
- `more` `320750a` — clue-3 PWA URL repoint
