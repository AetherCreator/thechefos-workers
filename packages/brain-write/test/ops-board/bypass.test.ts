// C5 bypass tests. Validator-aware + paper-design dispatch + regression
// guard for the non-bypass case (which must still route to Guard Layer
// health_probe verifier in production).

import { describe, it, expect } from 'vitest'
import { http, HttpResponse } from 'msw'
import {
  resolveBypass,
  parseHuntClueFromNotes,
  isPaperDesignFlag,
  findValidatorApplied,
} from '../../src/ops-board/bypass'
import { server } from '../complete-validator/msw-setup'

const env = { GITHUB_TOKEN: 'test-msw-mocked' }

describe('C5 bypass — parseHuntClueFromNotes', () => {
  it('extracts hunt + clue from typical Carpenter Notes', () => {
    expect(
      parseHuntClueFromNotes('hunt: carpenter-foundation, clue: 1, status: complete'),
    ).toEqual({ hunt: 'carpenter-foundation', clue: 1 })
  })

  it('handles slug variants (hyphens, digits, underscores)', () => {
    expect(parseHuntClueFromNotes('hunt: gamma-v1, clue: 2')).toEqual({
      hunt: 'gamma-v1',
      clue: 2,
    })
    expect(parseHuntClueFromNotes('hunt: aether_battle_v3, clue: 12')).toEqual({
      hunt: 'aether_battle_v3',
      clue: 12,
    })
  })

  it('returns null for non-hunt-clue Notes (e.g. token rotation row)', () => {
    expect(parseHuntClueFromNotes('GitHub token rotation, URGENT')).toBeNull()
    expect(parseHuntClueFromNotes('')).toBeNull()
  })
})

describe('C5 bypass — isPaperDesignFlag', () => {
  it('detects paper_design: true (snake_case)', () => {
    expect(isPaperDesignFlag('paper_design: true')).toBe(true)
  })

  it('detects paper-design: true (kebab-case)', () => {
    expect(isPaperDesignFlag('paper-design: true')).toBe(true)
  })

  it('detects Paper Design : true (capitalized + spaced)', () => {
    expect(isPaperDesignFlag('Paper Design : true')).toBe(true)
  })

  it('rejects paper_design: false', () => {
    expect(isPaperDesignFlag('paper_design: false')).toBe(false)
  })

  it('rejects partial-match value like "paper_design: trueish"', () => {
    expect(isPaperDesignFlag('paper_design: trueish')).toBe(false)
  })

  it('rejects unrelated Notes (regression guard)', () => {
    expect(isPaperDesignFlag('GitHub token rotation, URGENT')).toBe(false)
    expect(isPaperDesignFlag('')).toBe(false)
  })
})

describe('C5 bypass — resolveBypass dispatch', () => {
  it('returns kind=validator when audit trail has applied verdict', async () => {
    server.use(
      http.get(
        'https://api.github.com/repos/AetherCreator/SuperClaude/contents/brain/06-meta/auto-actions/*',
        () =>
          HttpResponse.json([
            { name: 'run-1.json', download_url: 'https://raw.example.com/run-1.json' },
          ]),
      ),
      http.get('https://raw.example.com/run-1.json', () =>
        HttpResponse.json({
          type: 'complete_validator',
          hunt: 'carpenter-foundation',
          clue: 1,
          verdict: 'applied',
          run_id: 'rid-1',
          timestamp: new Date().toISOString(),
          file: 'hunts/carpenter-foundation/clue-1/COMPLETE.md',
        }),
      ),
    )
    const r = await resolveBypass('hunt: carpenter-foundation, clue: 1', env)
    expect(r.kind).toBe('validator')
    if (r.kind === 'validator') {
      expect(r.entry.run_id).toBe('rid-1')
    }
  })

  it('returns kind=paper_design when flag present (no validator audit)', async () => {
    server.use(
      http.get(
        'https://api.github.com/repos/AetherCreator/SuperClaude/contents/brain/06-meta/auto-actions/*',
        () => new HttpResponse(null, { status: 404 }),
      ),
    )
    const r = await resolveBypass('Paper design epic, paper_design: true', env)
    expect(r.kind).toBe('paper_design')
  })

  it('returns kind=none when neither bypass condition matches (regression guard)', async () => {
    server.use(
      http.get(
        'https://api.github.com/repos/AetherCreator/SuperClaude/contents/brain/06-meta/auto-actions/*',
        () => new HttpResponse(null, { status: 404 }),
      ),
    )
    const r = await resolveBypass('GitHub token rotation, URGENT', env)
    expect(r.kind).toBe('none')
  })

  it('validator bypass takes priority over paper-design when both could apply', async () => {
    server.use(
      http.get(
        'https://api.github.com/repos/AetherCreator/SuperClaude/contents/brain/06-meta/auto-actions/*',
        () =>
          HttpResponse.json([
            { name: 'run-2.json', download_url: 'https://raw.example.com/run-2.json' },
          ]),
      ),
      http.get('https://raw.example.com/run-2.json', () =>
        HttpResponse.json({
          type: 'complete_validator',
          hunt: 'hunt-x',
          clue: 1,
          verdict: 'applied',
          run_id: 'rid-priority',
          timestamp: new Date().toISOString(),
          file: 'hunts/hunt-x/clue-1/COMPLETE.md',
        }),
      ),
    )
    const r = await resolveBypass('hunt: hunt-x, clue: 1, paper_design: true', env)
    expect(r.kind).toBe('validator')
  })

  it('validator audit with blocked_* verdict does NOT trigger validator bypass (only applied counts)', async () => {
    server.use(
      http.get(
        'https://api.github.com/repos/AetherCreator/SuperClaude/contents/brain/06-meta/auto-actions/*',
        () =>
          HttpResponse.json([
            { name: 'run-3.json', download_url: 'https://raw.example.com/run-3.json' },
          ]),
      ),
      http.get('https://raw.example.com/run-3.json', () =>
        HttpResponse.json({
          type: 'complete_validator',
          hunt: 'hunt-y',
          clue: 1,
          verdict: 'blocked_placeholder',
          run_id: 'rid-blocked',
          timestamp: new Date().toISOString(),
          file: 'hunts/hunt-y/clue-1/COMPLETE.md',
        }),
      ),
    )
    const r = await resolveBypass('hunt: hunt-y, clue: 1', env)
    expect(r.kind).toBe('none') // not applied -> no bypass
  })

  it('audit-trail listing 404 (no partition yet) -> validator bypass skipped, falls through', async () => {
    server.use(
      http.get(
        'https://api.github.com/repos/AetherCreator/SuperClaude/contents/brain/06-meta/auto-actions/*',
        () => new HttpResponse(null, { status: 404 }),
      ),
    )
    const r = await resolveBypass('hunt: hunt-z, clue: 1', env)
    expect(r.kind).toBe('none') // no audit listing -> no bypass
  })

  it('null/undefined Notes does not crash; returns kind=none', async () => {
    const r1 = await resolveBypass(null, env)
    const r2 = await resolveBypass(undefined, env)
    expect(r1.kind).toBe('none')
    expect(r2.kind).toBe('none')
  })
})

describe('C5 bypass — findValidatorApplied edge cases', () => {
  it('matches against today partition first, then yesterday', async () => {
    let todayHits = 0
    let yesterdayHits = 0
    server.use(
      http.get(
        'https://api.github.com/repos/AetherCreator/SuperClaude/contents/brain/06-meta/auto-actions/:date',
        ({ params }) => {
          const today = new Date().toISOString().slice(0, 10)
          if (params.date === today) {
            todayHits++
            return new HttpResponse(null, { status: 404 })
          }
          yesterdayHits++
          return HttpResponse.json([
            { name: 'run-y.json', download_url: 'https://raw.example.com/run-y.json' },
          ])
        },
      ),
      http.get('https://raw.example.com/run-y.json', () =>
        HttpResponse.json({
          type: 'complete_validator',
          hunt: 'hunt-yesterday',
          clue: 1,
          verdict: 'applied',
          run_id: 'rid-yesterday',
          timestamp: new Date().toISOString(),
          file: 'hunts/hunt-yesterday/clue-1/COMPLETE.md',
        }),
      ),
    )
    const entry = await findValidatorApplied('hunt-yesterday', 1, env)
    expect(entry).not.toBeNull()
    expect(todayHits).toBe(1)
    expect(yesterdayHits).toBe(1)
  })
})
