#!/usr/bin/env bash
# brain-index.sh — Batch-index all brain nodes via the brain/index API
# Usage: ./scripts/brain-index.sh [BASE_URL]
#
# Runs POST /api/brain/index with offset=0,20,40,… until the API
# returns done:true.  Stops after 8 iterations (160 nodes) as a safety limit.

set -euo pipefail

BASE_URL="${1:-https://api.thechefos.app}"
ENDPOINT="${BASE_URL}/api/brain/index"
LIMIT=20
MAX_ITERATIONS=8

offset=0
iteration=1

echo "🧠 Brain indexing — target: ${ENDPOINT}"
echo "   limit=${LIMIT}, max iterations=${MAX_ITERATIONS}"
echo ""

while [ "$iteration" -le "$MAX_ITERATIONS" ]; do
  echo "[$iteration/$MAX_ITERATIONS] POST offset=${offset} limit=${LIMIT}"

  response=$(curl -s -X POST "${ENDPOINT}?offset=${offset}&limit=${LIMIT}")

  # Print response (pretty-print if jq is available)
  if command -v jq &>/dev/null; then
    echo "$response" | jq .
  else
    echo "$response"
  fi

  # Check for done:true
  done_flag=$(echo "$response" | grep -o '"done":\s*true' || true)
  if [ -n "$done_flag" ]; then
    echo ""
    echo "✅ All nodes indexed!"
    exit 0
  fi

  # Check for errors
  error_flag=$(echo "$response" | grep -o '"error"' || true)
  if [ -n "$error_flag" ]; then
    echo ""
    echo "❌ Indexing failed — see response above"
    exit 1
  fi

  offset=$((offset + LIMIT))
  iteration=$((iteration + 1))

  # Brief pause between requests to be gentle on the API
  sleep 1
done

echo ""
echo "⚠️  Reached max iterations (${MAX_ITERATIONS}). Some nodes may not be indexed."
echo "   Re-run with a higher offset or increase MAX_ITERATIONS."
exit 2
