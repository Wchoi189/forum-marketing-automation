#!/usr/bin/env bash
#
# Test runner with a hermetic environment.
#
# The developer `.env` is auto-injected by tsx and contains absolute host paths
# (PROJECT_ROOT, ARTIFACTS_DIR) that do not exist on every machine. Tests must
# not depend on it, so every path-shaped variable is overridden explicitly here
# and writes are redirected into a per-run temp directory that is removed on exit.
#
# Usage: bash scripts/run-tests.sh <test-file> [...]

set -euo pipefail

TEST_TMP="$(mktemp -d "${TMPDIR:-/tmp}/marketing-automation-tests.XXXXXX")"
trap 'rm -rf "$TEST_TMP"' EXIT

export PROJECT_ROOT="."
export ARTIFACTS_DIR="$TEST_TMP/artifacts"
export BOT_PROFILE_DIR="$TEST_TMP/browser-profile"
export ACTIVITY_LOG_PATH="$TEST_TMP/activity-log.json"

export FORUM_PRIMARY_ID="ppomppu"
export PPOMPPU_USER_ID="test-user"
export PPOMPPU_USER_PW="test-pass"
export XAI_API_KEY="test-xai-key"
export NL_WEBHOOK_SECRET="test-secret"

mkdir -p "$ARTIFACTS_DIR" "$BOT_PROFILE_DIR"

# Expand globs here rather than passing them through. Node's --test only accepts
# glob patterns from v21 onward; on v20 it reports "Could not find <pattern>"
# and exits, which silently skipped the competitor-intel suite entirely.
shopt -s nullglob
files=()
for arg in "$@"; do
  if [[ "$arg" == *[*?]* ]]; then
    matches=( $arg )
    if [[ ${#matches[@]} -eq 0 ]]; then
      echo "run-tests.sh: no files matched '$arg'" >&2
      exit 1
    fi
    files+=( "${matches[@]}" )
  else
    files+=( "$arg" )
  fi
done
shopt -u nullglob

exec npx tsx --test --test-concurrency=1 "${files[@]}"
