#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
STATE_INDEX_PATH="${PROJECT_ROOT}/.agent/state/state.index.json"
DEFAULT_WING="marketing_automation"
DEFAULT_PALACE_PATH="/parent/project-artifacts/mempalace/palace"
DEFAULT_IDENTITY_PATH="${HOME}/.mempalace/identity.txt"
ALLOW_GLOBAL_FALLBACK="false"

usage() {
  cat <<'EOF'
Usage:
  scripts/mempalace-loop.sh wake-up [--wing <wing>] [--palace <path>]
  scripts/mempalace-loop.sh seed [--wing <wing>] [--include-plans]
  scripts/mempalace-loop.sh checkpoint [--wing <wing>] [--query <text>] [--include-plans]
  scripts/mempalace-loop.sh handover --file <handover-json> [--wing <wing>] [--query <text>] [--include-plans]

Notes:
  - Default indexing scope is memory/context artifacts only.
  - Default palace path is /parent/project-artifacts/mempalace/palace (global persistent palace).
  - Identity file is synced to this project by default at ~/.mempalace/identity.txt.
  - Use --include-plans to also mine .planning/spec-kit/plans.
  - Add --allow-fallback only if you intentionally want non-wing global wake-up/search fallback.
  - Add --no-sync-identity to avoid writing identity.txt for this run.
EOF
}

mp() {
  mempalace --palace "$palace_path" "$@"
}

ensure_room_initialized() {
  local dir="$1"
  if [[ ! -f "$dir/mempalace.yaml" ]]; then
    mp init "$dir" --yes >/dev/null
  fi
}

sync_project_identity() {
  local workflow_id
  local forum_id
  local handover_rel_path
  local handover_abs_path
  local objective

  workflow_id="$(jq -r '.active_workflow_id // "unknown"' "$STATE_INDEX_PATH")"
  forum_id="$(jq -r '.active_forum_id // "unknown"' "$STATE_INDEX_PATH")"
  handover_rel_path="$(jq -r '.last_handover_file // ""' "$STATE_INDEX_PATH")"
  objective=""

  if [[ -n "$handover_rel_path" ]]; then
    handover_abs_path="${PROJECT_ROOT}/${handover_rel_path}"
    if [[ -f "$handover_abs_path" ]]; then
      objective="$(jq -r '.objective // ""' "$handover_abs_path" 2>/dev/null || true)"
    fi
  fi

  mkdir -p "$(dirname "$identity_path")"
  cat > "$identity_path" <<EOF
Project: Forum Marketing Automation (forum-marketing-automation)
Strategy: Working-memory-first Memory Model
Focus: Session handovers, planning/spec contracts, and agent state.
Excluded: Source code by default unless explicitly requested.

Active Workflow: ${workflow_id}
Active Forum: ${forum_id}
Last Handover: ${handover_rel_path:-none}
Current Objective: ${objective:-not set}
EOF
}

require_cmd() {
  local cmd="$1"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "missing required command: ${cmd}" >&2
    exit 1
  fi
}

assert_file_exists() {
  local path="$1"
  if [[ ! -f "$path" ]]; then
    echo "required file not found: ${path}" >&2
    exit 1
  fi
}

resolve_rel_path() {
  local path="$1"
  if [[ "$path" = /* ]]; then
    local prefix="${PROJECT_ROOT}/"
    if [[ "$path" != "$prefix"* ]]; then
      echo "handover file must be under project root: ${PROJECT_ROOT}" >&2
      exit 1
    fi
    echo "${path#${prefix}}"
    return
  fi
  echo "$path"
}

mine_memory_scope() {
  local wing="$1"
  local include_plans="$2"
  ensure_room_initialized "${PROJECT_ROOT}/.agent/state"
  ensure_room_initialized "${PROJECT_ROOT}/.agent/session-handovers"
  ensure_room_initialized "${PROJECT_ROOT}/.planning/spec-kit/specs"

  mp mine "${PROJECT_ROOT}/.agent/state" --wing "$wing"
  mp mine "${PROJECT_ROOT}/.agent/session-handovers" --wing "$wing"
  mp mine "${PROJECT_ROOT}/.planning/spec-kit/specs" --wing "$wing"
  if [[ "$include_plans" == "true" ]]; then
    ensure_room_initialized "${PROJECT_ROOT}/.planning/spec-kit/plans"
    mp mine "${PROJECT_ROOT}/.planning/spec-kit/plans" --wing "$wing"
  fi
}

search_with_fallback() {
  local wing="$1"
  local query="$2"
  if mp search "$query" --wing "$wing"; then
    return 0
  fi

  if [[ "$ALLOW_GLOBAL_FALLBACK" == "true" ]]; then
    echo "wing-scoped search failed; retrying without --wing" >&2
    mp search "$query"
    return 0
  fi

  echo "wing-scoped search failed for wing '${wing}'." >&2
  echo "Run seed/checkpoint with this wing before searching, or rerun with --allow-fallback." >&2
  return 1
}

wake_up_with_fallback() {
  local wing="$1"
  if mp wake-up --wing "$wing"; then
    return 0
  fi

  if [[ "$ALLOW_GLOBAL_FALLBACK" == "true" ]]; then
    echo "wing-scoped wake-up failed; retrying without --wing" >&2
    mp wake-up
    return 0
  fi

  echo "wing-scoped wake-up failed for wing '${wing}'." >&2
  echo "Run: scripts/mempalace-loop.sh seed  (default wing: ${DEFAULT_WING})" >&2
  echo "Or rerun with --allow-fallback if you intentionally want global context." >&2
  return 1
}

update_state_index_handover() {
  local rel_handover_path="$1"
  local tmp_file
  tmp_file="$(mktemp)"
  jq --arg handover_path "$rel_handover_path" '.last_handover_file = $handover_path' "$STATE_INDEX_PATH" > "$tmp_file"
  mv "$tmp_file" "$STATE_INDEX_PATH"
}

print_state_summary() {
  jq '{active_workflow_id, active_forum_id, last_handover_file}' "$STATE_INDEX_PATH"
}

if [[ "$#" -lt 1 ]]; then
  usage
  exit 1
fi

require_cmd mempalace
require_cmd jq
assert_file_exists "$STATE_INDEX_PATH"

command="$1"
shift

wing="$DEFAULT_WING"
palace_path="$DEFAULT_PALACE_PATH"
identity_path="$DEFAULT_IDENTITY_PATH"
query="next action"
include_plans="false"
handover_file=""
sync_identity="true"

while [[ "$#" -gt 0 ]]; do
  case "$1" in
    --wing)
      [[ "$#" -ge 2 ]] || { echo "--wing requires a value" >&2; exit 1; }
      wing="$2"
      shift 2
      ;;
    --query)
      [[ "$#" -ge 2 ]] || { echo "--query requires a value" >&2; exit 1; }
      query="$2"
      shift 2
      ;;
    --palace)
      [[ "$#" -ge 2 ]] || { echo "--palace requires a value" >&2; exit 1; }
      palace_path="$2"
      shift 2
      ;;
    --identity-path)
      [[ "$#" -ge 2 ]] || { echo "--identity-path requires a value" >&2; exit 1; }
      identity_path="$2"
      shift 2
      ;;
    --include-plans)
      include_plans="true"
      shift
      ;;
    --no-sync-identity)
      sync_identity="false"
      shift
      ;;
    --allow-fallback)
      ALLOW_GLOBAL_FALLBACK="true"
      shift
      ;;
    --file)
      [[ "$#" -ge 2 ]] || { echo "--file requires a value" >&2; exit 1; }
      handover_file="$2"
      shift 2
      ;;
    *)
      echo "unknown argument: $1" >&2
      usage
      exit 1
      ;;
  esac
done

mkdir -p "$(dirname "$palace_path")"

if [[ "$sync_identity" == "true" ]]; then
  sync_project_identity
fi

case "$command" in
  wake-up)
    wake_up_with_fallback "$wing"
    echo "Local state authority summary:"
    print_state_summary
    ;;

  seed)
    mine_memory_scope "$wing" "$include_plans"
    mp status
    ;;

  checkpoint)
    mine_memory_scope "$wing" "$include_plans"
    search_with_fallback "$wing" "$query"
    ;;

  handover)
    if [[ -z "$handover_file" ]]; then
      echo "handover mode requires --file <handover-json>" >&2
      exit 1
    fi

    rel_handover_path="$(resolve_rel_path "$handover_file")"
    abs_handover_path="${PROJECT_ROOT}/${rel_handover_path}"
    assert_file_exists "$abs_handover_path"

    if [[ ! "$rel_handover_path" =~ ^\.agent/session-handovers/handover-[0-9]{8}-[0-9]{4}\.json$ ]]; then
      echo "handover file must match .agent/session-handovers/handover-YYYYMMDD-HHMM.json" >&2
      exit 1
    fi

    update_state_index_handover "$rel_handover_path"
    if [[ "$sync_identity" == "true" ]]; then
      sync_project_identity
    fi
    mine_memory_scope "$wing" "$include_plans"
    mp status
    search_with_fallback "$wing" "$query"
    ;;

  *)
    echo "unknown command: ${command}" >&2
    usage
    exit 1
    ;;
esac
