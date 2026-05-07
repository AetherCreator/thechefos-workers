[CODE-AUTONOMOUS][DETERMINISTIC][SUBSTANTIAL]

# Forge & Library — Clue 7: Foundry Pipeline (Schemer + Builder + Reviewer)

**Hunt:** forge-and-library
**Clue:** 7
**Source of truth:** [`hunts/forge-and-library/FOUNDRY-SCHEMA.md`](../FOUNDRY-SCHEMA.md) — read this first; it is the contract.
**Reference patterns:** existing `packages/locke-harvest/` and `packages/council/` (Kimi K2.6 + AI binding pattern).
**Substrate discipline:** Bible 1.1 §A6 + §A7 audit-wrap + §A8 reasoning-weight. Staged-source cp pattern (per C6). Step-level `$GITHUB_OUTPUT` guard (per C5/C6 — NOT job-level `if: hashFiles()`). Partial-complete antipattern mitigation: author `COMPLETE.md` at **Task 6** (before /health probes).

---

## Goal

Ship 3 new Cloudflare Workers — Schemer, Builder, Reviewer — implementing FOUNDRY-SCHEMA v1.0 MVP. After this clue:

- `https://schemer.tveg-baking.workers.dev/health` → 200 with `model: "@cf/moonshotai/kimi-k2.6"`
- `https://builder.tveg-baking.workers.dev/health` → 200 with `model: null`
- `https://reviewer.tveg-baking.workers.dev/health` → 200 with `model: "claude-haiku-4-5-20251001"`
- CI green on `main` after final commit
- `COMPLETE.md` written and pushed before /health probes

`/run-manual` smokes are **Tyler-side** after he sets per-Worker secrets — not Hunter's job.

---

## Tasks (execute in order; do NOT skip Task 6)

### Task 1 — Read schema + reference patterns

```bash
rtk cat hunts/forge-and-library/FOUNDRY-SCHEMA.md
rtk cat packages/council/wrangler.toml
rtk cat packages/council/src/index.ts
rtk cat packages/locke-harvest/wrangler.toml
rtk cat .github/workflows/deploy.yml
```

Internalize: Council's `[ai] binding = "AI"` + `env.AI.run()` sync pattern + Bearer auth on `raw.githubusercontent.com` for private brain reads + brain-write Worker write pattern + step-level `$GITHUB_OUTPUT` guard for deploy jobs.

### Task 2 — Stage Schemer Worker source

Write to `hunts/forge-and-library/clue-7/staged/schemer/`:

- **`src/index.ts`** — TypeScript Worker. Endpoints:
  - `GET /health` → `{ok: true, persona: "schemer", schema: "foundry-1.0", model: env.NIM_MODEL}`
  - `POST /run-manual?lead_id=X&verdict_path=Y&secret=Z` → reads verdict from brain (Bearer auth), reads lead, calls Kimi K2.6 with SCHEMER prompt (system + user templates from FOUNDRY-SCHEMA §4.1), validates output per §4.1 rules, writes MAP.md + clue caches via brain-write, returns Plan summary
  - `POST /run/:lead_id?secret=X` → webhook variant (v1.1 trigger surface; same logic as /run-manual)
  - `404` on other paths
  - **Validation retry:** if plan validation fails per §4.1, re-prompt Kimi citing rule violations; max 2 retries; on final fail write `_drafts/schemer-rejected-{session}.json` + return 422
  - **Diagnostic-write-to-brain pattern** on Kimi errors (§8): write `_drafts/schemer-error-{session}.json` with full payload preview
  - `Env` interface mirrors Council shape (AI, PERSONA, NIM_MODEL, BRAIN_*, INTEL_LOG_URL, GITHUB_TOKEN, BRAIN_WRITE_SECRET, SCHEMER_RUN_SECRET)
- **`wrangler.toml`** — mirror Council post-pivot:
  - `name = "schemer"`, `main = "src/index.ts"`, compat `2026-05-01`, nodejs_compat
  - `account_id = "cc231edbff18405233612d7afb657f1f"`
  - `[vars]` block with PERSONA, FOUNDRY_SCHEMA_VERSION, NIM_MODEL, BRAIN_RAW_BASE, BRAIN_GH_API_BASE, BRAIN_WRITE_URL, INTEL_LOG_URL, MAX_RETRIES (`"2"`), WALL_CLOCK_BUDGET_MS (`"120000"`), TYLER_CHAT_ID
  - `[ai] binding = "AI"`
  - `[triggers]` block **omitted** (cron deferred to v1.1)
- **`package.json`** — mirror Council shape: `{name, version, private, scripts: {deploy: "wrangler deploy"}, devDependencies}`

### Task 3 — Stage Builder Worker source

Write to `hunts/forge-and-library/clue-7/staged/builder/`:

- **`src/index.ts`** — orchestration shell, NO LLM. Endpoints:
  - `GET /health` → `{ok: true, persona: "builder", schema: "foundry-1.0", model: null}`
  - `POST /run-manual?plan_path=X&secret=Y` → reads MAP.md from brain, parses clue list (regex on `^\d+\.\s+\[CODE\]`), writes `build-status.json` per FOUNDRY-SCHEMA §4.2 with all clues at `status: "logged"`, `next_step: "manual"`, returns the build-status object
  - **v1.0 explicitly does NOT POST to Mastro** — comment in code reading: `// v1.0 MVP: log only — Mastro integration deferred to v1.1`
  - `Env` interface: PERSONA, FOUNDRY_SCHEMA_VERSION, BRAIN_*, INTEL_LOG_URL, GITHUB_TOKEN, BRAIN_WRITE_SECRET, BUILDER_RUN_SECRET
- **`wrangler.toml`** — mirror Council shape, NO `[ai]` block, NO cron, `[vars]` block subset (no NIM_MODEL — Builder has no model)
- **`package.json`** — same as Schemer

### Task 4 — Stage Reviewer Worker source

Write to `hunts/forge-and-library/clue-7/staged/reviewer/`:

- **`src/index.ts`** — TypeScript Worker. Endpoints:
  - `GET /health` → `{ok: true, persona: "reviewer", schema: "foundry-1.0", model: env.HAIKU_MODEL}`
  - `POST /review-manual?product_url=X&product_slug=Y&secret=Z` → fetches product_url (Gate 1: loads), runs 3 Haiku calls in parallel (Gates 3, 4, 5 per FOUNDRY-SCHEMA §4.3 — verbatim prompts from prompts/SCHEMER-AND-REVIEWER.md), writes REVIEW.json, returns it
  - **Gate 2 (Stripe) explicitly skipped** — comment reading: `// v1.0 MVP: Stripe gate deferred to v1.1 — needs STRIPE_API_KEY`
  - Verdict mapping per FOUNDRY-SCHEMA §4.3
  - Haiku call shape: POST `https://api.anthropic.com/v1/messages` with `Authorization: Bearer ${ANTHROPIC_API_KEY}`, `anthropic-version: 2023-06-01`, body `{model: env.HAIKU_MODEL, max_tokens: 1024, messages: [...]}` — extract content from `data.content[0].text`
  - Retry once on 429/5xx with backoff; mark gate `pass: null, error: "..."` on final fail; continue other gates
  - `Env` interface: PERSONA, FOUNDRY_SCHEMA_VERSION, HAIKU_MODEL, BRAIN_*, INTEL_LOG_URL, GITHUB_TOKEN, BRAIN_WRITE_SECRET, REVIEWER_RUN_SECRET, ANTHROPIC_API_KEY
- **`wrangler.toml`** — mirror Council shape, NO `[ai]` block (Reviewer uses HTTP fetch to Anthropic, not Workers AI), NO cron, `[vars]` includes `HAIKU_MODEL = "claude-haiku-4-5-20251001"`
- **`package.json`** — same shape

### Task 5 — Patch deploy.yml with 3 new jobs

Read current `.github/workflows/deploy.yml`. For each of `schemer`, `builder`, `reviewer`, add a `deploy-{name}` job using **step-level `$GITHUB_OUTPUT` guard** (NOT job-level `if: hashFiles()`):

```yaml
  deploy-schemer:
    runs-on: ubuntu-latest
    needs: setup
    steps:
      - uses: actions/checkout@v4
      - id: check
        run: |
          if [ -d "packages/schemer" ]; then
            echo "exists=true" >> $GITHUB_OUTPUT
          else
            echo "exists=false" >> $GITHUB_OUTPUT
          fi
      - if: steps.check.outputs.exists == 'true'
        uses: cloudflare/wrangler-action@v3
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          workingDirectory: packages/schemer
```

(Match the exact shape of `deploy-council` and `deploy-locke-harvest` already in the file.)

Stage the patched yml at `hunts/forge-and-library/clue-7/staged/.github/workflows/deploy.yml`.

### Task 6 — **AUTHOR COMPLETE.md NOW** (before /health probes)

This task is **non-negotiable** per partial-complete antipattern mitigation. Write `hunts/forge-and-library/clue-7/COMPLETE.md` with:

```markdown
# Clue 7 — Foundry Pipeline COMPLETE

**Hunt:** forge-and-library
**Completed:** {ISO8601}
**Substrate:** Hunter (claude-exec.sh)
**Source of truth:** FOUNDRY-SCHEMA.md (commit 4b7721b3)

## Files staged
- hunts/forge-and-library/clue-7/staged/schemer/ ({size}B src/index.ts)
- hunts/forge-and-library/clue-7/staged/builder/ ({size}B src/index.ts)
- hunts/forge-and-library/clue-7/staged/reviewer/ ({size}B src/index.ts)
- hunts/forge-and-library/clue-7/staged/.github/workflows/deploy.yml

## Files deployed (post-cp commit)
- packages/schemer/ → SHA {commit}
- packages/builder/ → SHA {commit}
- packages/reviewer/ → SHA {commit}
- .github/workflows/deploy.yml → SHA {commit}

## CI status
{filled in after Task 9}

## /health smokes (Task 11)
{filled in after Task 11}

## Tyler-side prerequisites (NOT Hunter's job)
Set per-Worker secrets via `wrangler secret put`:
- schemer: GITHUB_TOKEN, BRAIN_WRITE_SECRET, SCHEMER_RUN_SECRET
- builder: GITHUB_TOKEN, BRAIN_WRITE_SECRET, BUILDER_RUN_SECRET
- reviewer: GITHUB_TOKEN, BRAIN_WRITE_SECRET, REVIEWER_RUN_SECRET, ANTHROPIC_API_KEY

After secrets set, smoke /run-manual against each Worker.
```

Push COMPLETE.md immediately. **Even if subsequent tasks fail**, this commit signals intent and survives session crashes.

### Task 7 — cp staged → packages

```bash
mkdir -p packages/schemer packages/builder packages/reviewer
cp -r hunts/forge-and-library/clue-7/staged/schemer/* packages/schemer/
cp -r hunts/forge-and-library/clue-7/staged/builder/* packages/builder/
cp -r hunts/forge-and-library/clue-7/staged/reviewer/* packages/reviewer/
cp hunts/forge-and-library/clue-7/staged/.github/workflows/deploy.yml .github/workflows/deploy.yml
rtk git add packages/schemer packages/builder packages/reviewer .github/workflows/deploy.yml
rtk git commit -m "forge-and-library/clue-7: cp Schemer + Builder + Reviewer Workers + deploy.yml patch"
rtk git push origin main
```

### Task 8 — Wait for CI

Poll GHA runs until conclusion=success on the cp commit. Timeout 5 min.

### Task 9 — /health smokes

```bash
for w in schemer builder reviewer; do
  echo "=== $w ==="
  curl -sS "https://${w}.tveg-baking.workers.dev/health"
  echo
done
```

Expected output (parse-checked):
- `schemer`: `{"ok":true,"persona":"schemer","schema":"foundry-1.0","model":"@cf/moonshotai/kimi-k2.6"}`
- `builder`: `{"ok":true,"persona":"builder","schema":"foundry-1.0","model":null}`
- `reviewer`: `{"ok":true,"persona":"reviewer","schema":"foundry-1.0","model":"claude-haiku-4-5-20251001"}`

### Task 10 — Update COMPLETE.md with /health JSON + final SHAs

Fill in the deferred sections of COMPLETE.md from Task 6. Push.

### Task 11 — Long John completion ping

(Handled by `claude-exec.sh` exit-trap automatically.)

---

## Pass conditions (Rule 7 — `curl -sI` 200 in evidence)

- ✅ FOUNDRY-SCHEMA.md exists on `origin/main` (already shipped pre-fire, commit `4b7721b3`)
- ✅ packages/schemer, packages/builder, packages/reviewer all exist on `origin/main`
- ✅ .github/workflows/deploy.yml has deploy-schemer + deploy-builder + deploy-reviewer jobs
- ✅ Latest GHA run on cp commit: `conclusion=success`
- ✅ `curl -sI https://schemer.tveg-baking.workers.dev/health` → `HTTP/2 200`
- ✅ `curl -sI https://builder.tveg-baking.workers.dev/health` → `HTTP/2 200`
- ✅ `curl -sI https://reviewer.tveg-baking.workers.dev/health` → `HTTP/2 200`
- ✅ COMPLETE.md exists on `origin/main` with all sections filled

---

## Anti-patterns to avoid

1. **Job-level `if: hashFiles('packages/X/**')`** — broken on this repo (workflow YAML rejection, `total_count=0`). Use **step-level `$GITHUB_OUTPUT`** guard. Verify by inspecting `deploy-council` / `deploy-locke-harvest` shape in current deploy.yml.
2. **COMPLETE.md elision** — partial-complete antipattern (per `brain/02-knowledge/hunter-false-complete-antipattern.md`). Long John commit-count `1` instead of `2` is the signature. Fix: author COMPLETE at Task 6, update at Task 10. Two commits.
3. **NIM HTTP fetch in Schemer** — DO NOT fetch `integrate.api.nvidia.com`. Use `env.AI.run()` binding sync mode. NIM edge has 524 ceiling at ~145s — patterns banked.
4. **Streaming on Kimi K2.6** — sync (`stream: false` / no stream param) is canonical for in-network Workers AI. Streaming was a survival hack for NVIDIA edge; in-network has no such constraint.
5. **`max_tokens: 4096` for Kimi** — Kimi reasoning fills `reasoning_content` separately, both share the budget. Use 16384 for Schemer (THDD MAP + clue caches output).
6. **Setting Worker secrets via wrangler** — Hunter cannot do this. Flag in COMPLETE.md as Tyler-side. Workers will deploy and `/health` will work; `/run-manual` returns 403 until Tyler sets `*_RUN_SECRET`.

---

`HUNT_INTEGRATION: forge-and-library/C7 — Schemer + Builder + Reviewer Workers ship via staged-source cp pattern. Source of truth is FOUNDRY-SCHEMA.md (4b7721b3). All MVP scope: manual triggers only, Builder logs-only, Reviewer 4/5 gates. v1.1 webhook chain + Mastro + Stripe deferred.`
