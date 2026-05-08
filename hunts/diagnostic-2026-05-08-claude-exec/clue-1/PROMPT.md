[SUBSTANTIAL][DIAGNOSTIC]

# claude-exec hardening validation diagnostic

Validate that the hardened claude-exec.sh substrate (3 patches deployed 2026-05-07T22:00Z) reaches Claude Code headless and produces a committed artifact.

## Context

claude-exec.sh was hardened with three additive patches in the prior session:
1. `stdbuf -oL -eL tee` for line-buffered log flushing
2. hunterbot `getMe` probe at script startup (validates Telegram token)
3. CRASH detection in bottom-half (catches runner dying before exit line)

Patch 3 only fires on actual crash. This diagnostic exercises patches 1+2 by completing a normal ✅ run.

## Task

Create the file `hunts/diagnostic-2026-05-08-claude-exec/clue-1/COMPLETE.md` with the following content:

```
# COMPLETE — claude-exec hardening validation

**Dispatched:** 2026-05-08
**Hardening surfaces validated this run:**
- ✅ Patch 1: stdbuf line-buffered tee — reached Claude Code without truncation
- ✅ Patch 2: hunterbot getMe probe — token valid, script proceeded past startup gate
- ⏸ Patch 3: CRASH detection — fires-on-failure, not exercised by happy path

**Proof of life:** This commit is byte evidence that the Foundry execution path operates end-to-end on a freshly hardened claude-exec.sh substrate.
```

## Pass criteria

- COMPLETE.md exists at the specified path
- File is pushed to `thechefos-workers/main`
- Long John (@LongClaudeSilver_bot) emits a ✅ done ping with hunt=diagnostic-2026-05-08-claude-exec, clue=1

## Notes

This is a single-file commit. No source code changes. No multi-file synthesis required. The act of creating and committing the file itself completes the diagnostic.
