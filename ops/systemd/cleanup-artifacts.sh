#!/usr/bin/env bash
set -euo pipefail

ARTIFACT_ROOT="${ARTIFACT_ROOT:-/opt/marketing-automation/shared/artifacts}"
PUBLISHER_RETENTION_DAYS="${PUBLISHER_RETENTION_DAYS:-7}"
TRACE_RETENTION_DAYS="${TRACE_RETENTION_DAYS:-7}"
# Playwright traces live under publisher-runs/<run-id>/trace.zip (separate from optional ARTIFACT_ROOT/traces/)
PUBLISHER_RUNS_TRACE_ZIP_RETENTION_DAYS="${PUBLISHER_RUNS_TRACE_ZIP_RETENTION_DAYS:-${TRACE_RETENTION_DAYS}}"
PUBLISHER_HISTORY_JSONL_RETENTION_DAYS="${PUBLISHER_HISTORY_JSONL_RETENTION_DAYS:-30}"
PUBLISHER_HISTORY_PARQUET_RETENTION_DAYS="${PUBLISHER_HISTORY_PARQUET_RETENTION_DAYS:-180}"
PUBLISHER_HISTORY_ETL_ENABLED="${PUBLISHER_HISTORY_ETL_ENABLED:-true}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

if [[ "${PUBLISHER_HISTORY_ETL_ENABLED}" == "true" ]] && [[ -d "${ARTIFACT_ROOT}/publisher-history" ]]; then
  if command -v python3 >/dev/null 2>&1; then
    python3 "${PROJECT_ROOT}/scripts/publisher_history_jsonl_to_parquet.py" \
      --input-dir "${ARTIFACT_ROOT}/publisher-history" \
      --output-dir "${ARTIFACT_ROOT}/publisher-history/parquet"
  else
    echo "cleanup-artifacts: python3 not available; skipping publisher-history parquet ETL" >&2
  fi
fi

if [[ -d "${ARTIFACT_ROOT}/publisher-runs" ]]; then
  # Outcome/severity-aware trace retention:
  # - failure/severe traces (error screenshot sibling or failures/ path): keep up to PUBLISHER_RETENTION_DAYS
  # - success traces: keep up to PUBLISHER_RUNS_TRACE_ZIP_RETENTION_DAYS
  while IFS= read -r -d '' trace_file; do
    trace_dir="$(dirname "${trace_file}")"
    failure_marker="${trace_dir}/error.png"
    if [[ -f "${failure_marker}" ]] || [[ "${trace_file}" == *"/publisher-runs/failures/"* ]]; then
      if [[ -n "$(find "${trace_file}" -mtime +"${PUBLISHER_RETENTION_DAYS}" -print -quit)" ]]; then
        rm -f "${trace_file}"
      fi
    else
      if [[ -n "$(find "${trace_file}" -mtime +"${PUBLISHER_RUNS_TRACE_ZIP_RETENTION_DAYS}" -print -quit)" ]]; then
        rm -f "${trace_file}"
      fi
    fi
  done < <(find "${ARTIFACT_ROOT}/publisher-runs" -type f -name 'trace.zip' -print0)
  find "${ARTIFACT_ROOT}/publisher-runs" -mindepth 1 -maxdepth 1 -type d -mtime +"${PUBLISHER_RETENTION_DAYS}" -exec rm -rf {} +
fi

if [[ -d "${ARTIFACT_ROOT}/traces" ]]; then
  find "${ARTIFACT_ROOT}/traces" -type f -name '*.zip' -mtime +"${TRACE_RETENTION_DAYS}" -delete
fi

if [[ -d "${ARTIFACT_ROOT}/publisher-history" ]]; then
  find "${ARTIFACT_ROOT}/publisher-history" -maxdepth 1 -type f -name '*.jsonl' -mtime +"${PUBLISHER_HISTORY_JSONL_RETENTION_DAYS}" -delete
  if [[ -d "${ARTIFACT_ROOT}/publisher-history/parquet" ]]; then
    find "${ARTIFACT_ROOT}/publisher-history/parquet" -type f -name '*.parquet' -mtime +"${PUBLISHER_HISTORY_PARQUET_RETENTION_DAYS}" -delete
  fi
fi
