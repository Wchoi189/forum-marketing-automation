# Planning Workspace

This directory stores execution planning artifacts that are intentionally separate from specifications.

## Structure
- `sprints/`: time-boxed execution plans.
- `snapshots/`: hard copy planning snapshots.
- `templates/`: execution loop context pack and drift report templates.
- `../archive/`: mirrored archive root (specs + plans/epics/roadmaps/sprints/tasks).
- `../archive/plans/tasks/`: archived implementation checklists.
## Guidance
- Keep contracts, schemas, and behavior definitions in `../specs/`.
- Keep sequencing, delivery plans, and execution breakdowns here.
- Link from plans to relevant specs to keep intent and implementation aligned.

## Governance Plans
- `execution-loop.plan.json`: repo-wide planning and implementation execution loop.
- `planning-brain-consolidation.plan.json`: consolidation plan + hard copy policy.
- `state-authority-hardening.plan.json`: phased plan to achieve deterministic state authority and reliable publish opportunity capture.
