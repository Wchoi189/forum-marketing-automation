#!/usr/bin/env bash
# Project AI Memory Loop Orchestrator
#
# Commands:
#   wake-up     Mine core workspace metadata -> palace, print identity
#   seed        Full re-mine including docs/
#   checkpoint  Re-mine core workspace files mid-session
#   handover    Re-mine, update identity, show status
#

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PALACE_PATH="/home/qubit/.mempalace/palace"
WING="marketing_automation"

mp() {
  mempalace --palace "$PALACE_PATH" "$@"
}

mine_dir() {
  local target="$1"
  local desc="$2"
  if [[ ! -d "$target" ]]; then return; fi
  echo "  mining: $desc"
  mp mine "$target" --wing "$WING" 2>&1 | grep -E "✓|Done\.|Files processed|Drawers filed|skip" || true
}

mine_core() {
  mine_dir "${PROJECT_ROOT}/AgentQMS"                           "AgentQMS/ (manifests, conventions)"
  mine_dir "${PROJECT_ROOT}/.dev/context/sessions"               "Sessions/"
  mine_dir "${PROJECT_ROOT}/.dev/context/decisions"              "Decisions/"
}

case "${1:-}" in
  wake-up)
    echo "Waking up project wing: ${WING}"
    mine_core
    mp wake-up --wing "${WING}" 2>/dev/null || mp wake-up
    ;;
  seed)
    echo "Seeding full workspace..."
    mine_core
    mine_dir "${PROJECT_ROOT}/docs"                              "docs/ (architecture guides)"
    mp status
    ;;
  checkpoint|handover)
    echo "Checkpointing workspace..."
    mine_core
    mp status
    ;;
  *)
    echo "Usage: $0 {wake-up|seed|checkpoint|handover}"
    exit 1
    ;;
esac
