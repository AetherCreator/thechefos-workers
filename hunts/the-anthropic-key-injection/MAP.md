# Hunt: the-anthropic-key-injection

## Why
PWA kid products (MoreWords, SuperConci) currently hit `thechefos.com/api/claude` (NXDOMAIN) for AI curation. Real proxy at `api.thechefos.app/ai/v1/messages` returns 401 — Anthropic key not injected server-side. Adding Anthropic to the gateway costs per-token; hard constraint is **zero cost outside Tyler's $100/mo Claude Max**.

## Solution
Route kid-product traffic to NIM (NVIDIA's free Build tier — already in production for hunter swarm) instead of Anthropic. PWA stays unchanged in shape; only URL changes. Adapter translates OpenAI ↔ Anthropic responses so caller code is identical.

## Constraints
- No Anthropic API key in this path. Ever.
- No keys in browser code.
- Response shape must match Anthropic Messages API (PWAs already parse `content[0].text`).
- NIM rate-limit fallback: degrade to Cloudflare Workers AI (`env.AI` binding, also free).

## Clue Map
1. **[CODE] Adapter** — write `nim-adapter.ts` (Anthropic↔OpenAI shape translation, inline tests, tsc clean)
2. **[CODE] NIM Route** — wire `handleNIM` into `ai-gateway/src/index.ts` triggered by `x-product`, deploy worker, smoke-test 200
3. **[CODE] Repoint PWAs** — change endpoint URL in MoreWords + SuperConci, build, push

## Done When
- `curl POST https://api.thechefos.app/ai/v1/messages -H 'x-product: morewords' ...` returns 200 with valid `content[0].text`
- Both PWA repos build clean with new URL
- Per-call cost: $0 (NIM Build tier)

## Refs
OPS-052 (this hunt), OPS-051 (parent: launch-pad clue-2 STUCK), OPS-046/047 (recent parser+babysitter fixes that make this hunt safely autonomous)
