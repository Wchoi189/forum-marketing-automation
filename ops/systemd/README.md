# Runtime Service Runbook

## Install service unit

1. Copy unit file:
   - `sudo cp ops/systemd/marketing-automation.service /etc/systemd/system/marketing-automation.service`
2. Ensure scripts are executable:
   - `chmod +x ops/systemd/load-env-from-ssm.sh`
   - `chmod +x ops/systemd/healthcheck.sh`
   - `chmod +x ops/systemd/cleanup-artifacts.sh`
3. Reload and enable:
   - `sudo systemctl daemon-reload`
   - `sudo systemctl enable --now marketing-automation.service`

## Runtime checks

- `systemctl status marketing-automation.service`
- `journalctl -u marketing-automation.service -n 200 --no-pager`
- Health check: `PORT=3000 ops/systemd/healthcheck.sh`

## Daily artifact cleanup

- Add cron (or systemd timer) for retention cleanup:
  - `0 3 * * * /opt/marketing-automation/current/ops/systemd/cleanup-artifacts.sh`
- Defaults:
  - Publisher run directories: 30 days.
  - Trace zip files: 14 days.

## Fail-closed behavior

- `load-env-from-ssm.sh` exits non-zero if required parameters are missing.
- Failed env bootstrap prevents service start.
- Health check failure after restart should trigger deploy rollback.
