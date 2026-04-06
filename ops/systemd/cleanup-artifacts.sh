#!/usr/bin/env bash
set -euo pipefail

ARTIFACT_ROOT="${ARTIFACT_ROOT:-/opt/marketing-automation/shared/artifacts}"
PUBLISHER_RETENTION_DAYS="${PUBLISHER_RETENTION_DAYS:-30}"
TRACE_RETENTION_DAYS="${TRACE_RETENTION_DAYS:-14}"

if [[ -d "${ARTIFACT_ROOT}/publisher-runs" ]]; then
  find "${ARTIFACT_ROOT}/publisher-runs" -mindepth 1 -maxdepth 1 -type d -mtime +"${PUBLISHER_RETENTION_DAYS}" -exec rm -rf {} +
fi

if [[ -d "${ARTIFACT_ROOT}/traces" ]]; then
  find "${ARTIFACT_ROOT}/traces" -type f -name '*.zip' -mtime +"${TRACE_RETENTION_DAYS}" -delete
fi
