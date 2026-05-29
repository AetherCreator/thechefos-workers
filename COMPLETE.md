# Clue 1 — 3.2 + 3.3 Complete

## Push SHAs

| Part | SHA | Verified HEAD == origin/main |
|------|-----|------------------------------|
| 3.2 | `a1c3134c8152dc721036c5bdcff28156084f257e` | ✓ |
| 3.3 | `2b997018bb107aab3eb4a76f92e18e7195687da7` | ✓ |

---

## Part A — 3.2: Lead filename discriminator

### New filename format

```
<lead_id>.<pattern_type>.<confidence>.json
```

- `lead_id` — prefix, unchanged (existing tooling/globs keep working)
- `pattern_type` and `confidence` — sanitized to `[a-z0-9_-]` by `sanitizeForFilename()` (lowercase, replace non-alnum non-hyphen-underscore with `_`)
- Verdict sidecar — resolved lead filename with `.json` → `.verdict.json`

Examples:
```
bakers-percentage-calc.single_signal.high.json          ← lead
bakers-percentage-calc.single_signal.high.verdict.json  ← verdict sidecar
```

### Per-worker diffs summary

#### `packages/locke-harvest/src/personas/lookout/run.ts`

- Exported `sanitizeForFilename(s: string): string` — lowercases, replaces `[^a-z0-9_-]` with `_`
- Lead path construction changed from `${dir}/${lead_id}.json` to `${dir}/${lead_id}.${safeType}.${safeConf}.json`

#### `packages/council/src/index.ts`

- `findLeadPath` (exported): replaced HEAD probing with GitHub Contents API directory listing per candidate dir. Matches files whose name is `<leadId>.json` (legacy) OR `<leadId>.*` (new format); excludes `.verdict.json` sidecars.
- Sweep: `CONFIDENCE_FILTER` parsed once outside loop. Added filename-stem confidence prefilter after `isNonLeadFilename` check — extracts confidence from `parts[parts.length-1]` when `stem.split('.').length >= 3`; legacy files (1 part) fall through to `readLead`+`filterLead`.
- Verdict write: computed `leadFileStem = leadPath.split('/').pop()!.replace(/\.json$/, '')` — used for `_canary/` and `_review/` verdict paths so full stem (not bare `lead_id`) is preserved.
- `isNonLeadFilename` exported for test coverage.

#### `packages/schemer/src/index.ts`

- `findLeadPath` (exported): same directory-listing pattern as Council.
- `verdictPathActual = leadPath.replace(/\.json$/, '.verdict.json')` already correct; no change needed.

#### Reviewer

Confirmed no change needed. Reviewer receives `product_url` + `product_slug` and resolves paths under `brain/06-foundry/`. It does not resolve lead/verdict paths by `lead_id`.

---

## Legacy fallback proof — `bakers-percentage-calc` resolves

`findLeadPath('bakers-percentage-calc', env)` trace:

1. Fetch `BRAIN_GH_API_BASE/brain/05-leads/<today>` → directory listing
2. `files.find()`: checks each file name:
   - `n === 'bakers-percentage-calc.json'` → **true** → return `match.path`
3. Returns `brain/05-leads/<today>/bakers-percentage-calc.json` (or yesterday/_drafts fallback)

For a new-format lead:
1. Fetch listing for candidate dir
2. `n.startsWith('bakers-percentage-calc.')` → **true** for `bakers-percentage-calc.single_signal.high.json`
3. `!n.endsWith('.verdict.json')` → **true**; `n.endsWith('.json')` → **true**
4. Returns `brain/05-leads/<dir>/bakers-percentage-calc.single_signal.high.json`

Both paths verified by tests in `packages/council/src/index.test.ts` and `packages/schemer/src/index.test.ts`.

---

## Part B — 3.3: Diagnostic/error dump routing

### Writer survey findings

| Package | Previous path | New path |
|---------|--------------|----------|
| `locke-harvest` Lookout (phase-3 analyzer trace) | `brain/05-leads/_drafts/analyzer-trace-<sessionId>.json` | `brain/06-diagnostics/lookout/analyzer-trace-<sessionId>.json` |
| `schemer` (plan validation failure) | `brain/06-foundry/_drafts/schemer-error-<sessionId>.json` | `brain/06-diagnostics/schemer/schemer-error-<sessionId>.json` |

**Council**: no non-lead writer found that lands in `brain/05-leads/_drafts/`. Session reports go to `brain/05-leads/_sessions/` (not `_drafts/`). Council's `NON_LEAD_FILENAME_PATTERNS` (including `^analyzer-trace-` backstop) is retained as a filter for any legacy dumps predating this deploy.

**Reviewer**: writes only to `brain/06-foundry/`. No diagnostic writer found in `_drafts/`.

---

## Test counts

| Package | Test files | Tests |
|---------|-----------|-------|
| `locke-harvest` | 7 | 72 |
| `council` | 1 | 13 |
| `schemer` | 1 | 7 |
| **Total** | **9** | **92** |

All 92 tests green (`npm test` in each changed package). Vitest added to `schemer` (previously had no test script).

---

## Live deploy smoke

Live deploy-smoke is left to the external dispatcher. After GHA deploy lands:
- Verify `findLeadPath` resolves both `bakers-percentage-calc.json` (legacy) and a new `<id>.<type>.<conf>.json` lead in the brain repo.
- Verify Council sweep skips a new-format low-confidence file by filename before fetching.
- Verify diagnostic dumps land in `brain/06-diagnostics/` (not `05-leads/_drafts/` or `06-foundry/_drafts/`).
