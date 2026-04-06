# CloudWatch Alarm Runbook

## Required alarms

- `marketing-automation-service-down`
  - Trigger: systemd unit enters failed or inactive state.
  - Action: page on-call and run SSM triage.
- `marketing-automation-restart-loop`
  - Trigger: restart count above threshold in rolling window.
  - Action: collect recent deploy details and rollback if related.
- `marketing-automation-publisher-error-rate`
  - Trigger: publisher failures exceed ratio threshold.
  - Action: inspect `artifacts/publisher-runs` forensic data and recent workflow changes.

## On alarm checklist

1. Confirm host health via SSM session.
2. Check latest service logs and publisher artifacts.
3. Determine if incident was caused by deploy, env, or upstream site changes.
4. Roll back if post-deploy health checks are failing.
5. Write summary to latest handover JSON.
