#!/usr/bin/env bash
set -euo pipefail

ARTIFACT_ROOT="${ARTIFACT_ROOT:-/opt/marketing-automation/shared/artifacts}"
PUBLISHER_RETENTION_DAYS="${PUBLISHER_RETENTION_DAYS:-7}"
TRACE_RETENTION_DAYS="${TRACE_RETENTION_DAYS:-7}"
# Playwright traces live under publisher-runs/<run-id>/trace.zip (separate from optional ARTIFACT_ROOT/traces/)
PUBLISHER_RUNS_TRACE_ZIP_RETENTION_DAYS="${PUBLISHER_RUNS_TRACE_ZIP_RETENTION_DAYS:-${TRACE_RETENTION_DAYS}}"

if [[ -d "${ARTIFACT_ROOT}/publisher-runs" ]]; then
  find "${ARTIFACT_ROOT}/publisher-runs" -type f -name 'trace.zip' -mtime +"${PUBLISHER_RUNS_TRACE_ZIP_RETENTION_DAYS}" -delete
  find "${ARTIFACT_ROOT}/publisher-runs" -mindepth 1 -maxdepth 1 -type d -mtime +"${PUBLISHER_RETENTION_DAYS}" -exec rm -rf {} +
fi

if [[ -d "${ARTIFACT_ROOT}/traces" ]]; then
  find "${ARTIFACT_ROOT}/traces" -type f -name '*.zip' -mtime +"${TRACE_RETENTION_DAYS}" -delete
fi
