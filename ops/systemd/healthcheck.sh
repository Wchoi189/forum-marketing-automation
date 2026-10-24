#!/usr/bin/env bash
set -euo pipefail

PORT="${PORT:-3000}"
HEALTH_URL="http://127.0.0.1:${PORT}/api/health"
MAX_WAIT_SECONDS="${HEALTH_MAX_WAIT_SECONDS:-30}"

start="$(date +%s)"
while true; do
  if curl -fsS "$HEALTH_URL" >/dev/null 2>&1; then
    exit 0
  fi

  now="$(date +%s)"
  if (( now - start >= MAX_WAIT_SECONDS )); then
    echo "health check failed: ${HEALTH_URL} not ready within ${MAX_WAIT_SECONDS}s" >&2
    exit 1
  fi

  sleep 1
done
