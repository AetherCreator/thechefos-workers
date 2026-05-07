[SUBSTANTIAL]

# C3 — Locke Harvest Worker `[CODE-AUTONOMOUS]` `[DETERMINISTIC]` `[SUBSTANTIAL]`

**Hunt:** forge-and-library
**Clue:** 3 of 8
**Substrate:** auto-exec.sh → claude-exec.sh (this PROMPT's first line is `[SUBSTANTIAL]`)
**Bible:** 1.1 + §A7 + §A8 + §A9
**Repo:** `AetherCreator/thechefos-workers`
**Depends on:** C2 (LIBRARIAN-SCHEMA.md, LOCKE-OUTPUT-SCHEMA.md on origin/main)

---

## Mission

Move the three staged source files from `hunts/forge-and-library/clue-3/staged/` into `packages/locke-harvest/`, commit, push to `origin/main`, verify the existing `.github/workflows/deploy.yml` CI runs green, write COMPLETE.md.

**This PROMPT uses the staged-source pattern.** The verbatim Worker source (~13kB `index.ts` plus `wrangler.toml` and `package.json`) is already committed and locked at `hunts/forge-and-library/clue-3/staged/`. You are NOT writing them inline — you are copying them into place. Tiny tool calls only. This is a deliberate workaround for a substrate failure on the previous attempt where a single ~13kB Write tool call caused a streaming error in the upstream provider.

You will not synthesize. You will not edit the staged files. You will copy, commit, push, verify.

---

## Pre-flight (§A7 audit-wrap discipline)

Read AUDIT exits as data; STRICT must exit 0.

```bash
# AUDIT 1 — current branch
git rev-parse --abbrev-ref HEAD                                 # STRICT must print: main

# AUDIT 2 — staged source files all present
ls -la hunts/forge-and-library/clue-3/staged/                   # AUDIT
test -f hunts/forge-and-library/clue-3/staged/wrangler.toml && echo "wrangler.toml: present" || echo "wrangler.toml: MISSING"
test -f hunts/forge-and-library/clue-3/staged/package.json && echo "package.json: present" || echo "package.json: MISSING"
test -f hunts/forge-and-library/clue-3/staged/index.ts && echo "index.ts: present" || echo "index.ts: MISSING"

# AUDIT 3 — packages/locke-harvest must NOT already exist on disk in this clone
test -d packages/locke-harvest && echo "ABORT: packages/locke-harvest already exists" || echo "OK: clean slate"

# AUDIT 4 — sibling C2 deliverables on this clone
test -f hunts/forge-and-library/LIBRARIAN-SCHEMA.md && echo "LIBRARIAN-SCHEMA: present" || echo "LIBRARIAN-SCHEMA: MISSING"
test -f hunts/forge-and-library/LOCKE-OUTPUT-SCHEMA.md && echo "LOCKE-OUTPUT-SCHEMA: present" || echo "LOCKE-OUTPUT-SCHEMA: MISSING"

# AUDIT 5 — deploy.yml exists
test -f .github/workflows/deploy.yml && echo "deploy.yml: present" || echo "deploy.yml: MISSING"
```

If anything reads MISSING or ABORT: stop, write `hunts/forge-and-library/clue-3/COMPLETE.md` with status `partial — pre-flight failure` plus the failing audit, commit, push. Exit cleanly.

---

## Task 1 — Create destination directory

```bash
mkdir -p packages/locke-harvest/src
```

## Task 2 — Copy the three staged files into place

```bash
cp hunts/forge-and-library/clue-3/staged/wrangler.toml packages/locke-harvest/wrangler.toml
cp hunts/forge-and-library/clue-3/staged/package.json packages/locke-harvest/package.json
cp hunts/forge-and-library/clue-3/staged/index.ts      packages/locke-harvest/src/index.ts
```

## Task 3 — Verify byte-for-byte match (§A7 audit; cmp returns 0 on match)

```bash
cmp hunts/forge-and-library/clue-3/staged/wrangler.toml packages/locke-harvest/wrangler.toml && echo "wrangler.toml: match"
cmp hunts/forge-and-library/clue-3/staged/package.json  packages/locke-harvest/package.json  && echo "package.json: match"
cmp hunts/forge-and-library/clue-3/staged/index.ts      packages/locke-harvest/src/index.ts  && echo "index.ts: match"
ls -la packages/locke-harvest/ packages/locke-harvest/src/
```

If any cmp returns non-zero: stop. The files differ — do not commit. Write COMPLETE.md with status `partial — staged copy mismatch` and exit.

## Task 4 — Commit + push

```bash
git add packages/locke-harvest/wrangler.toml \
        packages/locke-harvest/package.json \
        packages/locke-harvest/src/index.ts

git status --short                                                # AUDIT — should show 3 new files
git diff --cached --stat                                          # AUDIT

git commit -m "forge-and-library C3: locke-harvest Worker scaffold (LIBRARIAN-SCHEMA + LOCKE-OUTPUT-SCHEMA)"
git push origin main
```

Capture the source commit SHA: `git log -1 --format=%H`. Save in a shell variable for COMPLETE.md.

## Task 5 — Verify deploy.yml CI

Wait up to 4 minutes for the workflow run keyed to your push.

```bash
COMMIT_SHA=$(git log -1 --format=%H)
TOKEN=$(cat /opt/secrets/github-token)
REPO="AetherCreator/thechefos-workers"

CI_STATUS="pending"
CI_CONCLUSION="pending"
CI_RUN_ID=""
for i in $(seq 1 24); do
  sleep 10
  RESP=$(curl -s -H "Authorization: Bearer $TOKEN" \
    "https://api.github.com/repos/$REPO/actions/runs?head_sha=$COMMIT_SHA&per_page=1")
  PARSED=$(echo "$RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); r=(d.get('workflow_runs') or [None])[0]; print((r or {}).get('status','none'), (r or {}).get('conclusion','none'), (r or {}).get('id','none'))")
  CI_STATUS=$(echo "$PARSED" | awk '{print $1}')
  CI_CONCLUSION=$(echo "$PARSED" | awk '{print $2}')
  CI_RUN_ID=$(echo "$PARSED" | awk '{print $3}')
  echo "[$i] status=$CI_STATUS conclusion=$CI_CONCLUSION id=$CI_RUN_ID"
  if [ "$CI_STATUS" = "completed" ]; then break; fi
done
```

`success` is the happy path. `failure` is acceptable for clue-3 PASS as long as COMPLETE.md documents the run id and a one-line theory (most likely: `deploy.yml` does not yet include `packages/locke-harvest/` in its matrix — Tyler-side patch in a follow-up commit, not this clue's scope).

## Task 6 — Write COMPLETE.md

Write `hunts/forge-and-library/clue-3/COMPLETE.md`. Fill bracketed slots with real captured values. Then commit and push.

Template:

```markdown
# C3 COMPLETE — locke-harvest Worker scaffold

**Date:** <ISO 8601 UTC from `date -u +%Y-%m-%dT%H:%M:%SZ`>
**Substrate:** auto-exec.sh → claude-exec.sh (per `[SUBSTANTIAL]` first-line tag)
**Pattern:** staged-source cp-into-place (sidesteps prior streaming failure on large Write tool calls)
**Hunt:** forge-and-library
**Status:** <complete | partial — CI red | partial — pre-flight failure | partial — staged copy mismatch>

## Files committed at `packages/locke-harvest/`

- `wrangler.toml` (583 bytes, copied from staged/)
- `package.json` (302 bytes, copied from staged/)
- `src/index.ts` (~12.7 KB, copied from staged/)

Source commit: `<SHA from git log -1 --format=%H after Task 4>`

## CI verification

- deploy.yml run id: `<CI_RUN_ID>`
- conclusion: `<success | failure | timeout>`
- status: `<completed | in_progress | queued | none>`

## Deferred (intentional, NOT failures)

- **KV-backed cross-invocation dedup** — MVP uses in-memory Set. Cross-invocation dedup per LIBRARIAN-SCHEMA §7 is post-MVP.
- **Phase 2 Agent-Reach** — C1 audit confirms not installed. Phase 1 (SearXNG) → Phase 3 (Gemini) only for MVP.
- **SearXNG Cloudflare tunnel** — wrangler.toml points at `https://searxng-tunnel.thechefos.app/search`. Verify the tunnel exists before first cron; otherwise expect `query_failed` intel events. NOT blocking deploy.

## Tyler-side post-deploy steps (DO NOT execute from this clue)

```
wrangler secret put GEMINI_API_KEY --name locke-harvest        # value from /opt/secrets/gemini-key
wrangler secret put BRAIN_WRITE_SECRET --name locke-harvest    # value: SuperDuperClaude
wrangler secret put HARVEST_RUN_SECRET --name locke-harvest    # any random 32-char string; save to /opt/secrets/locke-harvest-run-key
```

## Smoke (Tyler-side, becomes C4)

```
curl -X POST "https://locke-harvest.tveg-baking.workers.dev/run?secret=$(cat /opt/secrets/locke-harvest-run-key)"
```

Expect: `{"kept":N,"discarded":M,"status":"complete|no_signal|all_discarded","session_id":"…"}`. Successful smoke writes ≥1 file under `brain/05-leads/` (or `_drafts/`) and a session report under `brain/05-leads/_sessions/`.
```

Then commit COMPLETE.md:

```bash
git add hunts/forge-and-library/clue-3/COMPLETE.md
git commit -m "forge-and-library C3 COMPLETE — locke-harvest scaffolded via staged-source pattern"
git push origin main
```

---

## Pass conditions

1. ✅ `packages/locke-harvest/wrangler.toml` on `origin/main` (cmp matches staged)
2. ✅ `packages/locke-harvest/package.json` on `origin/main` (cmp matches staged)
3. ✅ `packages/locke-harvest/src/index.ts` on `origin/main` (cmp matches staged)
4. ✅ `hunts/forge-and-library/clue-3/COMPLETE.md` on `origin/main` with filled slots
5. ✅ `deploy.yml` CI run is `completed` (success preferred; documented failure also acceptable)
6. ✅ Long John 🏴‍☠️ ping arrives in `@LongClaudeSilver_bot` DM with **NEW commit count > 0** (verify-push pattern; false-✅ no longer possible)

When all 6 pass conditions hold, your final reply line is:
`HUNT_COMPLETE: forge-and-library/clue-3 <source-SHA> <complete-SHA>`

---

## Forbidden

- DO NOT modify any file outside `packages/locke-harvest/` and `hunts/forge-and-library/clue-3/`
- DO NOT modify or delete files under `hunts/forge-and-library/clue-3/staged/` (those are the locked source)
- DO NOT edit the contents of the copied files — copy verbatim, no formatting/lint passes
- DO NOT modify `.github/workflows/deploy.yml` (out of scope for this clue)
- DO NOT install dependencies (wrangler runs in CI; local install not needed)
- DO NOT add Phase 2 Agent-Reach code or KV bindings (deferred — see Mission)
- DO NOT execute `wrangler secret put` or the C4 smoke curl from this clue
- DO NOT split `src/index.ts` — it is a single locked file
- DO NOT amend prior commits
