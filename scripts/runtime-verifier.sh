#!/usr/bin/env bash
# runtime-verifier.sh — C2.1 decoupled InfiniVeg runtime-verifier (Phase 1, ADVISORY)
# Reproduces non-hermetic (godot/bash) verify_log entries against origin@work_commit,
# evaluates each entry's `expect` predicate, emits a JSON runtime verdict.
# Runs OUTSIDE the Cloudflare-Worker structural gate's critical path (decoupled tier).
# Hunt: grok-verify-harness · clue-2.1 · OPS-GVH-C21-SHELL-REPRODUCE
#
# Usage:
#   runtime-verifier.sh --work-repo OWNER/REPO --work-commit <40hex> \
#       --hunt H --clue N [--branch B] --entries entries.json [--out verdict.json]
#
# entries.json: [{"cmd": "...", "expect": "exit==0"}, ...]
#   - "@GODOT@" in a cmd is substituted with $GODOT_BIN (default /usr/local/bin/godot)
#   - cmds run from the checkout root, no network assumed
# expect grammar (verify-standard subset): exit==0 | exit!=0 | exit==N |
#   stdout_contains:<TOKEN> | grep_count>=N | grep_count==0
set -uo pipefail

WORK_REPO=""; WORK_COMMIT=""; HUNT=""; CLUE=""; BRANCH=""; ENTRIES=""; OUT=""
while [ $# -gt 0 ]; do
  case "$1" in
    --work-repo)   WORK_REPO="$2"; shift 2;;
    --work-commit) WORK_COMMIT="$2"; shift 2;;
    --hunt)        HUNT="$2"; shift 2;;
    --clue)        CLUE="$2"; shift 2;;
    --branch)      BRANCH="$2"; shift 2;;
    --entries)     ENTRIES="$2"; shift 2;;
    --out)         OUT="$2"; shift 2;;
    *) echo "unknown arg: $1" >&2; exit 2;;
  esac
done

[ -n "$WORK_REPO" ]   || { echo "missing --work-repo" >&2; exit 2; }
[ -n "$WORK_COMMIT" ] || { echo "missing --work-commit" >&2; exit 2; }
[ -n "$ENTRIES" ]     || { echo "missing --entries" >&2; exit 2; }
[ -f "$ENTRIES" ]     || { echo "entries file not found: $ENTRIES" >&2; exit 2; }
command -v python3 >/dev/null 2>&1 || { echo "python3 required" >&2; exit 3; }

GODOT="${GODOT_BIN:-/usr/local/bin/godot}"
TOKEN=""
[ -f /opt/secrets/github-token ] && TOKEN="$(cat /opt/secrets/github-token)"

WORKDIR="$(mktemp -d /tmp/rv-XXXXXX)"
cleanup() { rm -rf "$WORKDIR"; }
trap cleanup EXIT

# --- fetch the EXACT commit by sha (avoids shallow-branch bug: no --branch ambiguity) ---
cd "$WORKDIR" || exit 4
git init -q
if [ -n "$TOKEN" ]; then
  ORIGIN="https://x-access-token:${TOKEN}@github.com/${WORK_REPO}.git"
else
  ORIGIN="https://github.com/${WORK_REPO}.git"
fi
git remote add origin "$ORIGIN"
FETCH_OK=1
git fetch -q --depth 1 origin "$WORK_COMMIT" 2>/dev/null && FETCH_OK=0
if [ "$FETCH_OK" -ne 0 ] && [ -n "$BRANCH" ]; then
  git fetch -q --depth 100 origin "$BRANCH" 2>/dev/null && FETCH_OK=0
fi
if [ "$FETCH_OK" -ne 0 ]; then echo "fetch failed for $WORK_COMMIT" >&2; exit 4; fi
git checkout -q "$WORK_COMMIT" 2>/dev/null || git checkout -q FETCH_HEAD 2>/dev/null \
  || { echo "checkout failed for $WORK_COMMIT" >&2; exit 4; }
CHECKED_OUT="$(git rev-parse HEAD 2>/dev/null || echo unknown)"

# --- run each entry ---
RESULTS="$WORKDIR/.rv_results.jsonl"
: > "$RESULTS"
N="$(python3 -c "import json;print(len(json.load(open('$ENTRIES'))))")"
i=0
while [ "$i" -lt "$N" ]; do
  CMD="$(python3 -c "import json;print(json.load(open('$ENTRIES'))[$i]['cmd'])")"
  EXPECT="$(python3 -c "import json;print(json.load(open('$ENTRIES'))[$i]['expect'])")"
  RUNCMD="$(printf '%s' "$CMD" | sed "s#@GODOT@#${GODOT}#g")"
  OUTPUT="$(cd "$WORKDIR" && eval "$RUNCMD" 2>&1)"; RC=$?
  PASS=false; ACTUAL="exit=$RC"
  case "$EXPECT" in
    "exit==0")          [ "$RC" -eq 0 ] && PASS=true;;
    "exit!=0")          [ "$RC" -ne 0 ] && PASS=true;;
    "exit=="*)          want="${EXPECT#exit==}"; [ "$RC" -eq "$want" ] && PASS=true;;
    "stdout_contains:"*) tok="${EXPECT#stdout_contains:}"; hits="$(printf '%s' "$OUTPUT" | grep -cF "$tok")"; [ "$hits" -gt 0 ] && PASS=true; ACTUAL="exit=$RC hits=$hits";;
    "grep_count>="*)    n="${EXPECT#grep_count>=}"; c="$(printf '%s' "$OUTPUT" | tail -n1 | tr -dc '0-9')"; c="${c:-0}"; [ "$c" -ge "$n" ] && PASS=true; ACTUAL="exit=$RC count=$c";;
    "grep_count==0")    c="$(printf '%s' "$OUTPUT" | tail -n1 | tr -dc '0-9')"; c="${c:-0}"; [ "$c" -eq 0 ] && PASS=true; ACTUAL="exit=$RC count=$c";;
    *)                  ACTUAL="exit=$RC (UNSUPPORTED expect: $EXPECT)";;
  esac
  python3 - "$RESULTS" "$RUNCMD" "$EXPECT" "$ACTUAL" "$PASS" <<'PYEOF'
import json,sys
results,cmd,expect,actual,passv = sys.argv[1:6]
with open(results,'a') as f:
    f.write(json.dumps({"cmd":cmd,"expect":expect,"actual":actual,"pass":passv=="true"})+"\n")
PYEOF
  i=$((i+1))
done

# --- emit verdict (single-line JSON) ---
VERDICT="$(python3 - "$RESULTS" "$HUNT" "$CLUE" "$CHECKED_OUT" "$WORK_REPO" <<'PYEOF'
import json,sys,datetime
results,hunt,clue,commit,repo = sys.argv[1:6]
entries=[json.loads(l) for l in open(results) if l.strip()]
passed=sum(1 for e in entries if e["pass"]); total=len(entries); failed=total-passed
print(json.dumps({
  "hunt":hunt,"clue":clue,"work_repo":repo,"work_commit":commit,
  "entries":entries,"total":total,"passed":passed,"failed":failed,
  "all_pass": (failed==0 and total>0),
  "ran_at": datetime.datetime.utcnow().isoformat()+"Z"
}))
PYEOF
)"

if [ -n "$OUT" ]; then printf '%s\n' "$VERDICT" > "$OUT"; fi
printf '%s\n' "$VERDICT"
