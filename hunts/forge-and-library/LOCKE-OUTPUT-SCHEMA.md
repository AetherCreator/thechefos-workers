# LOCKE-OUTPUT-SCHEMA.md — Lead JSON Contract

**Status:** v1.0 (locked at C2, synthesis from `LOCKE-LAMORA-SOUL.md` §"What You Send to the Council" + `prompts/HUNTER.md` §"Phase 3" Gemini user prompt)
**Storage:** `brain/05-leads/{YYYY-MM-DD}/{lead_id}.json` (one file per lead, immutable on creation; updates via merge per `LIBRARIAN-SCHEMA.md` §7)
**Producers:** `packages/locke-harvest/` Worker (built C3)
**Consumers:** Council Worker (built C6); future Foundry Schemer (built C7)
**Schema version pinning:** `schema_version: "locke-1.0"` — Council rejects mismatched versions

---

## 1. Field-by-Field Specification

| Field | Type | Required | Constraints | Description |
|---|---|---|---|---|
| `schema_version` | string | yes | exact: `"locke-1.0"` | Version pin. Council rejects non-matching. |
| `lead_id` | string | yes | regex `^[a-z0-9][a-z0-9-]{2,63}$` | Slug. Locke proposes; merge logic preserves first-emit slug. |
| `persona` | string | yes | exact: `"locke-lamora"` | Identifies hunter agent (future personas use their own value). |
| `harvest_session_id` | string | yes | UUID v4 | FK back to `_sessions/` report. |
| `harvested_at` | string | yes | ISO 8601 UTC | When Locke emitted this lead. |
| `source_threads` | array<ThreadRef> | yes | min 1, max 10 | Where the signal came from. |
| `mark_profile` | string | yes | 20-200 chars | Who's hurting + budget signal. |
| `pain_statement` | string | yes | 30-300 chars | Specific manual / painful action. |
| `pain_frequency` | enum | yes | `daily`, `weekly`, `monthly`, `once` | How often the pain hits. |
| `pain_intensity` | enum | yes | `annoying`, `painful`, `critical` | Severity. |
| `existing_solutions` | array<Solution> | no | max 10 | Known competitors + why they fail. |
| `angle` | string | yes | 30-400 chars | What a simple product would look like. |
| `estimated_price` | string | yes | regex `^\$\d+(\.\d{1,2})?(\/(mo\|yr))?$` | Price-point hypothesis. |
| `market_size_signal` | enum | yes | `niche`, `solid`, `large` | Locke's read on TAM. |
| `confidence` | enum | yes | `low`, `medium`, `high`, `dead_certain` | Locke's confidence; only `medium`+ go to Council. |
| `pattern_type` | enum | yes | `single_signal`, `repeated`, `long_con` | Cross-thread pattern strength. |
| `thread_count` | int | yes | ≥1 | Number of distinct threads supporting the lead. |
| `total_upvotes` | int | yes | ≥0 | Sum across source_threads. |
| `related_leads` | array<string> | no | max 10 | Other lead_ids in the same Long Con cluster. |
| `locke_notes` | string | yes | 30-300 chars | Locke's voice — one-line take in character. |

### `ThreadRef` sub-schema

```
{
  "url": string,                 // canonical URL, no tracking params
  "platform": "reddit" | "hackernews" | "indie_forum" | "rss" | "other",
  "title": string,               // <= 200 chars
  "upvotes": int,                // >= 0
  "comment_count": int,          // >= 0
  "harvested_at": string         // ISO 8601 UTC
}
```

### `Solution` sub-schema

```
{
  "name": string,                // 1-80 chars
  "url": string?,                // optional canonical site
  "weakness": string,            // 20-200 chars — why it fails
  "signals": array<string>       // verbatim quotes from threads, max 5
}
```

## 2. Validation Rules

The Worker MUST reject a lead emit if any of the following hold. Validation library: `zod` schema in `packages/locke-harvest/src/schema.ts`, generated from this document.

- Any required field missing
- Any enum value not in allowed list
- Any length constraint violated
- `confidence == "low"` AND target dir is `brain/05-leads/{date}/` — low routes to `_drafts/` only
- `lead_id` collides with `_skiplist.json`
- `source_threads.length < 1`
- `mark_profile` matches generic patterns: `/^(everyone|all (developers|users|people)|most (people|users))/i` — too unspecific, fails Locke's Rule 2 ("Profile the mark")
- `total_upvotes` lower than `sum(source_threads[].upvotes)` — math must check out
- `pattern_type == "long_con"` AND `thread_count < 2` — Long Cons require multi-source by definition
- `related_leads` contains a non-existent lead_id (validated via brain-write Worker pre-check)

Validation failure → discard + log `validation_error` with field-level diff. NEVER write malformed JSON to brain/.

## 3. Example Leads

### Example A — High confidence, Long Con (canonical)

```json
{
  "schema_version": "locke-1.0",
  "lead_id": "freelancer-invoice-chase-monthly",
  "persona": "locke-lamora",
  "harvest_session_id": "8a7e1d3c-0c20-4b3a-92f1-c2b8a1d3f0e7",
  "harvested_at": "2026-05-11T00:14:33Z",
  "source_threads": [
    {
      "url": "https://reddit.com/r/freelance/comments/abc123",
      "platform": "reddit",
      "title": "Spending hours every month chasing invoices — what do you all do?",
      "upvotes": 247,
      "comment_count": 89,
      "harvested_at": "2026-05-11T00:08:12Z"
    },
    {
      "url": "https://reddit.com/r/smallbusiness/comments/def456",
      "platform": "reddit",
      "title": "What's your invoice follow-up process? Mine is killing me.",
      "upvotes": 158,
      "comment_count": 64,
      "harvested_at": "2026-05-11T00:09:41Z"
    },
    {
      "url": "https://news.ycombinator.com/item?id=42819273",
      "platform": "hackernews",
      "title": "Show HN: I built a one-button invoice reminder because I was tired of chasing",
      "upvotes": 207,
      "comment_count": 53,
      "harvested_at": "2026-05-11T00:11:08Z"
    }
  ],
  "mark_profile": "Solo freelancers, 1-5 active clients, $2k-$15k MRR, non-technical to lightly-technical",
  "pain_statement": "Spending 2-4 hours every month manually chasing unpaid invoices via email and Slack DM",
  "pain_frequency": "monthly",
  "pain_intensity": "painful",
  "existing_solutions": [
    {
      "name": "QuickBooks",
      "url": "https://quickbooks.intuit.com",
      "weakness": "Buried feature; assumes you're already a QB user; overkill for solo",
      "signals": ["QB reminders are buried three menus deep", "I just want one button, not a whole accounting suite"]
    },
    {
      "name": "InvoiceNinja",
      "url": "https://invoiceninja.com",
      "weakness": "Overengineered; setup overhead measured in hours; clients confused by complex follow-up emails",
      "signals": ["Too many features I'll never use", "My clients keep asking what platform this is"]
    }
  ],
  "angle": "Single-screen tool: paste invoice details, set reminder cadence (3-day / weekly / monthly), one button to send. No accounting, no clients DB, no expansion. Stripe-paid invoice link goes straight in the reminder body.",
  "estimated_price": "$4.99/mo",
  "market_size_signal": "solid",
  "confidence": "high",
  "pattern_type": "long_con",
  "thread_count": 3,
  "total_upvotes": 612,
  "related_leads": ["late-payment-fee-calculator", "freelancer-cash-flow-forecast"],
  "locke_notes": "Three taverns, same wound. The tools exist but they're all trying to be everything. The play is radical simplicity."
}
```

### Example B — Medium confidence, repeated pattern

```json
{
  "schema_version": "locke-1.0",
  "lead_id": "podcast-show-notes-extractor",
  "persona": "locke-lamora",
  "harvest_session_id": "b2f4d8e1-7a6c-49f3-a012-c3e5b8d4f2a9",
  "harvested_at": "2026-05-11T00:17:02Z",
  "source_threads": [
    {
      "url": "https://reddit.com/r/podcasting/comments/xyz789",
      "platform": "reddit",
      "title": "How long does writing show notes take you? Mine is brutal.",
      "upvotes": 84,
      "comment_count": 41,
      "harvested_at": "2026-05-11T00:13:55Z"
    },
    {
      "url": "https://reddit.com/r/podcasting/comments/uvw012",
      "platform": "reddit",
      "title": "Tools for show notes that don't suck?",
      "upvotes": 47,
      "comment_count": 23,
      "harvested_at": "2026-05-11T00:15:30Z"
    }
  ],
  "mark_profile": "Solo / duo podcasters, 100-5,000 downloads/episode, no editor on staff",
  "pain_statement": "Spending 45-90 minutes per episode writing show notes by hand from a 60-min audio source",
  "pain_frequency": "weekly",
  "pain_intensity": "painful",
  "existing_solutions": [
    {
      "name": "Descript",
      "url": "https://descript.com",
      "weakness": "Transcript-heavy workflow; show-note generation is a side feature requiring manual passes",
      "signals": ["Descript transcripts are great but the show-note step is still all me"]
    }
  ],
  "angle": "Upload audio or paste transcript → choose template (timestamps + chapters / TLDR / quote highlights) → one-click formatted show notes ready to paste into Apple Podcasts, Spotify, Buzzsprout. Stop at the output; do not try to be a CMS.",
  "estimated_price": "$9.00/mo",
  "market_size_signal": "niche",
  "confidence": "medium",
  "pattern_type": "repeated",
  "thread_count": 2,
  "total_upvotes": 131,
  "related_leads": [],
  "locke_notes": "Smaller crowd than the freelancers but the pain is sharper — they do it weekly, not monthly. Worth a sketch."
}
```

### Example C — Low confidence (lands in `_drafts/`)

```json
{
  "schema_version": "locke-1.0",
  "lead_id": "obsidian-graph-aesthetic-themes",
  "persona": "locke-lamora",
  "harvest_session_id": "c1e3a5d7-9b8f-4d2c-b1a0-d4e2f6a8c0b3",
  "harvested_at": "2026-05-11T00:19:41Z",
  "source_threads": [
    {
      "url": "https://reddit.com/r/ObsidianMD/comments/lmn345",
      "platform": "reddit",
      "title": "Wish there was a marketplace for graph view themes",
      "upvotes": 22,
      "comment_count": 8,
      "harvested_at": "2026-05-11T00:18:14Z"
    }
  ],
  "mark_profile": "Obsidian enthusiasts who already pay for Sync ($10/mo) and have aesthetic preferences",
  "pain_statement": "Manually editing CSS to customize graph view appearance",
  "pain_frequency": "once",
  "pain_intensity": "annoying",
  "existing_solutions": [
    {
      "name": "Obsidian community CSS snippets",
      "weakness": "Free, decentralized; no marketplace polish; install friction",
      "signals": ["I just want to click and apply"]
    }
  ],
  "angle": "Curated theme marketplace; one-click install via plugin. Theme creators take 70%, platform 30%.",
  "estimated_price": "$2.99/theme",
  "market_size_signal": "niche",
  "confidence": "low",
  "pattern_type": "single_signal",
  "thread_count": 1,
  "total_upvotes": 22,
  "related_leads": [],
  "locke_notes": "One thread, one mark. Aesthetic ask, low intensity. Filed but not played."
}
```

## 4. Versioning Policy

`schema_version` is bumped (e.g., `locke-1.0` → `locke-1.1`) when:

- Required field added (breaking)
- Enum tightened — value removed (breaking)
- Field semantic meaning changes (breaking)
- Validation rule tightened in a way that would reject previously-valid leads (breaking)

NOT bumped for:

- Optional field added
- Enum widened (new allowed value)
- Documentation clarifications
- Validation rule loosened

Council reads `schema_version` and applies the matching deserializer. Old leads remain readable; new leads conform to current. Multiple versions can co-exist in `brain/05-leads/` indefinitely.

## 5. Council Consumption Contract

Council Worker (C6) reads JSON from `brain/05-leads/{date}/*.json`, filters by:

- `schema_version` ∈ supported set (currently just `locke-1.0`)
- `confidence` ∈ {`medium`, `high`, `dead_certain`}
- `pattern_type` ∈ {`repeated`, `long_con`} — `single_signal` goes to drafts unless Tyler manually promotes

Then runs Realist + Economist + Skeptic deliberation per `prompts/COUNCIL.md`. Verdict is written as a sidecar at `brain/05-leads/{date}/{lead_id}.verdict.json` — never mutating the original lead.

The contract is read-only from Council's perspective: Locke's emit is immutable except for merges (per `LIBRARIAN-SCHEMA.md` §7).

## 6. Cross-references

- `LIBRARIAN-SCHEMA.md` (sibling) — overall framework Locke conforms to
- `LOCKE-LAMORA-SOUL.md` (sibling) — persona voice; includes prototype Lead JSON
- `prompts/HUNTER.md` §Phase 3 — Gemini Flash analysis prompt that produces this shape
- `prompts/COUNCIL.md` — downstream verdict generation
- `MAP.md` C5 + C6 — Council schema + Worker depend on this contract
- `clue-1/pre-flight-report.md` — confirms brain-write infra readiness

This schema is **immutable v1.0** for the duration of clue-3 through clue-7. Revisions land as v1.1+ at C8 retro if empirical data demands it.
