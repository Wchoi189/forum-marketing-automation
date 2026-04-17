#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

ARTIFACT_ROOT="${ARTIFACT_ROOT:-${PROJECT_ROOT}/artifacts}"
HISTORY_DIR="${SCHEDULER_REPLAY_HISTORY_DIR:-${ARTIFACT_ROOT}/publisher-history}"
OUTPUT_ROOT="${SCHEDULER_REPLAY_OUTPUT_ROOT:-${ARTIFACT_ROOT}/scheduler-replay}"
WINDOW_DAYS="${SCHEDULER_REPLAY_WINDOW_DAYS:-14}"
WINDOW_SIZE="${SCHEDULER_REPLAY_WINDOW_SIZE:-8}"
HISTORY_LIMIT="${SCHEDULER_REPLAY_HISTORY_LIMIT:-240}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUTPUT_DIR="${OUTPUT_ROOT}/runbook-${STAMP}"

if [[ ! -d "${HISTORY_DIR}" ]]; then
  echo "scheduler-replay-report: history directory not found: ${HISTORY_DIR}" >&2
  exit 1
fi

mkdir -p "${OUTPUT_ROOT}"

cd "${PROJECT_ROOT}"
npm run scheduler:replay -- \
  --history-dir "${HISTORY_DIR}" \
  --output-dir "${OUTPUT_DIR}" \
  --window-days "${WINDOW_DAYS}" \
  --window-size "${WINDOW_SIZE}" \
  --history-limit "${HISTORY_LIMIT}"

echo "scheduler-replay-report: wrote report to ${OUTPUT_DIR}"
