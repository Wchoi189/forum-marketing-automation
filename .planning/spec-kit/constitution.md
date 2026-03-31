---
id: ppomppu-spec-constitution
version: 1
scope:
  - planning_only
  - ai_facing_docs
principles:
  - spec_first
  - contracts_over_prose
  - strict_validation
  - multi_forum_ready
constraints:
  docs:
    audience: ai_only
    formats:
      preferred: [json, yaml]
      allowed_markdown: constraints_only
    forbid:
      - tutorials
      - user_manuals
      - how_to_guides
  structure:
    planning_root: ".planning/spec-kit"
    agent_root: ".agent"
    forbid_runtime_code_in_planning: true
  validation:
    require_schema_for_every_manifest: true
    fail_on_unknown_keys: true
    fail_on_missing_required_keys: true
governance:
  env:
    secrets_in_env_only: true
    forbid_credentials_in_specs: true
  handovers:
    suffix_format: "YYYYMMDD-HHMM"
    location: ".agent/session-handovers"
  execution:
    require_declared_entry_points: true
    require_preconditions_per_entry_point: true
    require_input_output_contract_refs: true
    require_idempotency_declaration: true
    require_failure_policy_declaration: true
    require_run_id_traceability: true
    require_single_active_run_lock: true
    allowed_modes: [auto, manual_override, dry_run, bootstrap]
    required_states: [IDLE, OBSERVING, DECIDING, PUBLISHING, PERSISTING, ERROR]
---

This file defines non-user-facing constraints for the Ppomppu automation project.
