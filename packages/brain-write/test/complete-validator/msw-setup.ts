// MSW server + handlers for the complete-validator test suite.
//
// Real-SHA discipline: handlers respond 200 for SHAs that actually resolve on
// origin (H1 C1 substrate, aether-chronicles main HEAD). Synthetic / fake SHAs
// fall through to the catch-all 404, matching production GitHub behavior.
//
// Per-test overrides via `server.use(...)` (e.g. d1-sha-mismatch.test, reproduce.test).

import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'

// Real H1 C1 commit on AetherCreator/SuperClaude
// (`git rev-parse b56bc8e` on a SuperClaude clone, 2026-05-22).
export const REAL_SC_SHA = 'b56bc8e79fea8cf152ea438bc1c4a3f9908cc4b3'

// aether-chronicles main HEAD at time of C2 authoring (2026-05-22).
export const REAL_AETHER_SHA = 'e45967fc47608632b5acf7e29f1d6194f2393e52'

// grok-verify-harness C1 work commit (fixture-0-truthful control SHA).
export const GVH_C1_SHA = '630fe4a2b7791b7ef4278ebc1ca0382ba6755552'

// Fake SHA — well-formed 40-char hex, no commit on origin. Catch-all 404s it.
export const FAKE_SHA = '1234567890abcdef1234567890abcdef12345678'

export const handlers = [
  // GitHub commit lookup: known-good SHAs → 200
  http.get(`https://api.github.com/repos/:owner/:repo/git/commits/${REAL_SC_SHA}`, () =>
    HttpResponse.json({ sha: REAL_SC_SHA, message: 'fixture: H1 C1' }, { status: 200 }),
  ),
  http.get(
    `https://api.github.com/repos/:owner/:repo/git/commits/${REAL_AETHER_SHA}`,
    () =>
      HttpResponse.json(
        { sha: REAL_AETHER_SHA, message: 'fixture: aether main' },
        { status: 200 },
      ),
  ),
  http.get(
    `https://api.github.com/repos/:owner/:repo/git/commits/${GVH_C1_SHA}`,
    () =>
      HttpResponse.json(
        { sha: GVH_C1_SHA, message: 'fixture: gvh C1 work commit' },
        { status: 200 },
      ),
  ),

  // GitHub commit lookup: anything else → 404 (matches production behavior)
  http.get('https://api.github.com/repos/:owner/:repo/git/commits/:sha', () =>
    HttpResponse.json({ message: 'Not Found' }, { status: 404 }),
  ),

  // GitHub contents API: catch-all → 404 (tests that need specific files use server.use overrides)
  http.get('https://api.github.com/repos/:owner/:repo/contents/*', () =>
    HttpResponse.json({ message: 'Not Found' }, { status: 404 }),
  ),

  // D1 carpenter_runs query: default = no rows (soft-skip)
  http.post(
    'https://api.cloudflare.com/client/v4/accounts/:acct/d1/database/:dbid/query',
    () => HttpResponse.json({ result: [{ results: [] }] }),
  ),
]

export const server = setupServer(...handlers)
