# Clue 3: PWA Repoint + End-to-End Verify [CODE]

## Objective
Update the MoreWords PWA to call the new Worker URL. Build it. Commit + push. Run the same Comms Test that failed in launch-pad clue 2 — but against the new URL.

## Cross-Repo Note
This clue edits `AetherCreator/more`, NOT `thechefos-workers`. Switch repos explicitly:
```bash
cd /home/yasaisama/more
git pull --quiet origin main
```

## Files to Read First
- `apps/more-words-pwa/src/utils/aiCuration.ts` (the URL needing change)

## Changes

### `apps/more-words-pwa/src/utils/aiCuration.ts`
Change fetch URL from `https://thechefos.com/api/claude` to `https://api.thechefos.app/ai/v1/messages`. Keep `x-product: morewords` and `Content-Type: application/json` headers. Body unchanged. Response parsing unchanged (`response.content[0].text` still valid — adapter returns Anthropic shape).

## Build
```bash
cd /home/yasaisama/more/apps/more-words-pwa
npm install        # only if node_modules missing
npm run build      # output: dist/
```

## Commit + Push
```bash
cd /home/yasaisama/more
git add apps/more-words-pwa/src/utils/aiCuration.ts
git add apps/more-words-pwa/dist  # only if dist is tracked; else skip
git commit -m "morewords: route AI curation through ai-gateway worker"
git push origin main
```

## Verification (must all pass — capture for COMPLETE.md)

```bash
cd /home/yasaisama/more

# Test 1: source confirms new URL
grep "api.thechefos.app/ai/v1/messages" apps/more-words-pwa/src/utils/aiCuration.ts
# Required: 1 match

# Test 2: old URL fully removed from source
! grep -r "thechefos.com/api/claude" apps/more-words-pwa/src 2>/dev/null
# Required: 0 matches

# Test 3: built dist/ contains new URL
grep -l "api.thechefos.app/ai/v1/messages" apps/more-words-pwa/dist/assets/*.js
# Required: at least 1 match

# Test 4: live end-to-end Comms Test (the one that failed before)
curl -sS -o /tmp/e2e.json -w "HTTP=%{http_code}\n" -X POST \
  https://api.thechefos.app/ai/v1/messages \
  -H "Content-Type: application/json" \
  -H "x-product: morewords" \
  -d '{"model":"claude-sonnet-4-6","max_tokens":256,"messages":[{"role":"user","content":"You are a vocabulary curator. Given interests: Nature, Animals, return ONLY a JSON array of 20 word IDs from 1-100 like [1,2,3]."}]}'
cat /tmp/e2e.json | python3 -m json.tool
# Required: HTTP=200 AND .content[0].text matches /\[[\d,\s]+\]/
```

## Done When
- aiCuration.ts source has new URL only
- `npm run build` exits 0
- Commit pushed to origin/main (capture SHA)
- All 4 verification tests pass
- COMPLETE.md captures: SHA, full Test 4 response body, sample of curated word IDs

## Out of Scope
- SuperConci PWA repoint (separate small follow-up commit, not this clue)
- Vercel deploy of MoreWords (deferred to launch-pad clue 3 which is the actual deploy hunt)
- Telemetry / error tracking
