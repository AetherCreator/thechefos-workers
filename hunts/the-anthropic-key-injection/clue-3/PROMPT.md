# Clue 3: Repoint Kid PWAs [CODE]

## Objective
Update MoreWords and SuperConci PWAs to use the new gateway endpoint. Both must build clean and the network call must return 200 against the deployed gateway.

## Repos to Edit
- `AetherCreator/more` — change in `apps/more-words-pwa/src/utils/aiCuration.ts`
- `AetherCreator/SuperConci` — search for stale URLs first, edit any matches

## Files to Read First
- `more/apps/more-words-pwa/src/utils/aiCuration.ts`
- In SuperConci, run: `grep -rn "thechefos.com\|api/claude" --include="*.ts" --include="*.tsx" --include="*.js" .`

## Changes (both PWAs, identical pattern)

### URL change
```ts
// OLD
'https://thechefos.com/api/claude'
// NEW  
'https://api.thechefos.app/ai/v1/messages'
```

### Headers
Ensure these are present:
```ts
'Content-Type': 'application/json',
'anthropic-version': '2023-06-01',
'x-product': 'morewords',  // or 'superconci' depending on repo
```

### Body
Leave unchanged — Anthropic Messages API shape. Adapter handles translation server-side.

## Build + Verify (per repo)
```bash
cd <pwa-dir>
npm run build
# verify dist exists and is non-empty
ls -la dist/
```

## Network smoke test (run from this hunt environment)
```bash
curl -sS -X POST "https://api.thechefos.app/ai/v1/messages" \
  -H "Content-Type: application/json" \
  -H "x-product: morewords" \
  -H "anthropic-version: 2023-06-01" \
  -d '{"model":"claude-sonnet-4-5","max_tokens":80,"messages":[{"role":"user","content":"You are a vocab curator. From: art,nature,science. Return ONLY a JSON array of 3 numbers between 1 and 100."}]}'
```
Confirm 200 + `content[0].text` contains a JSON array.

## Pass Condition
- Both PWAs built clean (no tsc/build errors)
- Both repos: commit + push to `main`
- Smoke test returns 200 with valid array in response text

## Then Write
`hunts/the-anthropic-key-injection/clue-3/COMPLETE.md` with both PWA commit SHAs and smoke test response sample.

## Hunt-Level Done
After clue-3 COMPLETE.md is pushed, write `hunts/the-anthropic-key-injection/COMPLETE.md` summarizing:
- gateway deploy URL
- both PWA commit SHAs
- smoke test response
- **Per-call cost: $0 (NIM Build tier)**

This unblocks `the-launch-pad clue-2` retry.
