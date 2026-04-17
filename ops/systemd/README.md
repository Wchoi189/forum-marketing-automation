# Runtime Service Runbook

## Install service unit

1. Copy unit file:
   - `sudo cp ops/systemd/marketing-automation.service /etc/systemd/system/marketing-automation.service`
2. Ensure scripts are executable:
   - `chmod +x ops/systemd/load-env-from-ssm.sh`
   - `chmod +x ops/systemd/healthcheck.sh`
   - `chmod +x ops/systemd/cleanup-artifacts.sh`
  - `chmod +x ops/systemd/scheduler-replay-report.sh`
3. Reload and enable:
   - `sudo systemctl daemon-reload`
   - `sudo systemctl enable --now marketing-automation.service`

## Runtime checks

- `systemctl status marketing-automation.service`
- `journalctl -u marketing-automation.service -n 200 --no-pager`
- Health check: `PORT=3000 ops/systemd/healthcheck.sh`

## Scheduler Signal Replay Report

- One-shot calibration report from recent publisher history:
  - `npm run scheduler:replay:runbook`
- Output directory pattern:
  - `artifacts/scheduler-replay/runbook-<UTC timestamp>/`
- Core report files:
  - `window_summary.json`
  - `comparison.json`
  - `stability_report.json`
  - `calibration_report.json`

Optional environment overrides for the runbook script:
- `SCHEDULER_REPLAY_WINDOW_DAYS` (default `14`)
- `SCHEDULER_REPLAY_WINDOW_SIZE` (default `8`)
- `SCHEDULER_REPLAY_HISTORY_LIMIT` (default `240`)
- `SCHEDULER_REPLAY_HISTORY_DIR` (default `artifacts/publisher-history`)
- `SCHEDULER_REPLAY_OUTPUT_ROOT` (default `artifacts/scheduler-replay`)

Optional cron example (daily 03:20 UTC):
- `20 3 * * * cd /opt/marketing-automation/current && npm run scheduler:replay:runbook >> /var/log/marketing-automation-scheduler-replay.log 2>&1`

## Daily artifact cleanup

- Add cron (or systemd timer) for retention cleanup:
  - `0 3 * * * /opt/marketing-automation/current/ops/systemd/cleanup-artifacts.sh`
- Defaults:
  - Publisher run directories: 7 days (`PUBLISHER_RETENTION_DAYS`).
  - Trace zip files under `publisher-runs/**/trace.zip`:
    - Success traces: 7 days (`PUBLISHER_RUNS_TRACE_ZIP_RETENTION_DAYS`, falls back to `TRACE_RETENTION_DAYS`).
    - Failure/severe traces (run dir has `error.png`, or `publisher-runs/failures/**`): 7 days (`PUBLISHER_RETENTION_DAYS`).
  - Legacy `artifacts/traces/*.zip`: 7 days (`TRACE_RETENTION_DAYS`).
  - Publisher history JSONL partitions (`artifacts/publisher-history/*.jsonl`): 30 days (`PUBLISHER_HISTORY_JSONL_RETENTION_DAYS`).
  - Publisher history parquet files (`artifacts/publisher-history/parquet/*.parquet`): 180 days (`PUBLISHER_HISTORY_PARQUET_RETENTION_DAYS`).
- The cleanup script also rebuilds parquet datasets from JSONL before retention when `PUBLISHER_HISTORY_ETL_ENABLED=true` (default).

### Operational defaults table

| Area | Path pattern | Default retention | Control |
| --- | --- | --- | --- |
| Publisher run directories | `artifacts/publisher-runs/<timestamp>/` | 7 days | `PUBLISHER_RETENTION_DAYS` |
| Success trace zips | `artifacts/publisher-runs/**/trace.zip` | 7 days | `PUBLISHER_RUNS_TRACE_ZIP_RETENTION_DAYS` (fallback: `TRACE_RETENTION_DAYS`) |
| Failure/severe trace zips | `artifacts/publisher-runs/failures/**/trace.zip` or run dir with `error.png` | 7 days | `PUBLISHER_RETENTION_DAYS` |
| Legacy trace zips | `artifacts/traces/*.zip` | 7 days | `TRACE_RETENTION_DAYS` |
| Publisher history JSONL | `artifacts/publisher-history/*.jsonl` | 30 days | `PUBLISHER_HISTORY_JSONL_RETENTION_DAYS` |
| Publisher history parquet | `artifacts/publisher-history/parquet/*.parquet` | 180 days | `PUBLISHER_HISTORY_PARQUET_RETENTION_DAYS` |

## Debug escalation path

1. Start with default low-cost mode:
   - `PUBLISHER_DEBUG_SCREENSHOTS=false`
   - `PUBLISHER_DEBUG_TRACE=false`
2. If failures are intermittent or difficult to localize:
   - Set `PUBLISHER_DEBUG_SCREENSHOTS=true` and redeploy/restart.
3. If screenshots are insufficient:
   - Set `PUBLISHER_DEBUG_TRACE=true`.
   - Keep `PUBLISHER_TRACE_SUCCESS_SAMPLE_PERCENT=0` initially (failure-only trace retention).
4. For short investigation windows where success-path timing is needed:
   - Temporarily set `PUBLISHER_TRACE_SUCCESS_SAMPLE_PERCENT=100`.
   - Revert to `0` after triage to control storage growth.

## Trace replay

- Locate `trace.zip` under `artifacts/publisher-runs/<timestamp>/trace.zip`.
- Replay locally:
  - `npx playwright show-trace artifacts/publisher-runs/<timestamp>/trace.zip`
- If `trace.zip` is missing on a failed run, confirm:
  - `PUBLISHER_DEBUG_TRACE=true`
  - Retention did not purge the run directory (`PUBLISHER_RETENTION_DAYS`, `PUBLISHER_RUNS_TRACE_ZIP_RETENTION_DAYS`)

## Querying parquet outputs

- Rebuild parquet manually:
  - `npm run publisher-history:parquet`
- Expected outputs:
  - `artifacts/publisher-history/parquet/runs.parquet`
  - `artifacts/publisher-history/parquet/errors.parquet`

- Example: inspect run/error counts by day with pandas:

```python
import pandas as pd

runs = pd.read_parquet("artifacts/publisher-history/parquet/runs.parquet")
errors = pd.read_parquet("artifacts/publisher-history/parquet/errors.parquet")

runs["day"] = pd.to_datetime(runs["at"], utc=True).dt.date
summary = runs.groupby("day")["success"].agg(total="count", successes="sum")
summary["failures"] = summary["total"] - summary["successes"]

print(summary.tail(14))
print("recent error rows:", len(errors.tail(50)))
```

## Fail-closed behavior

- `load-env-from-ssm.sh` exits non-zero if required parameters are missing.
- Failed env bootstrap prevents service start.
- Health check failure after restart should trigger deploy rollback.
