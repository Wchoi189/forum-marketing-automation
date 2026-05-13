# Cloud Deployment Runbook

> Ppomppu OTT Bot — Production deployment for AWS EC2 t3.micro / Oracle Cloud Free (ARM)

## Prerequisites

- Target VM: ≥1 GB RAM, 1 vCPU, Linux (Ubuntu 22.04+ recommended)
- Node.js 20 installed on VM
- `npm` and `tsx` available
- SSH access with sudo
- AWS SSM Parameter Store configured for secrets (or `runtime.env` file)

## Build a Release Tarball

```bash
# On your dev machine or CI
npm ci
npm run build        # builds frontend → dist/
tar -czf marketing-automation-$(date -u +%Y%m%d-%H%M%S).tar.gz \
  server.ts bot.ts mcp/ config/ contracts/ lib/ routes/ ops/ templates/ \
  node_modules/ dist/ package.json package-lock.json tsconfig.json
```

**Note:** The `node_modules/` in the tarball must be built for Linux x64 (or ARM64 for Oracle). If your dev machine is different, build on the target or use the Docker approach below.

## Docker Build (Alternative)

```bash
# On any machine with Docker
docker build -t marketing-automation:latest .
# Save as tarball for transport
docker save marketing-automation:latest | gzip > marketing-automation-docker.tar.gz
```

Then on the VM:
```bash
docker load < marketing-automation-docker.tar.gz
docker compose up -d
```

## Deploy

1. Upload the tarball to the VM:
   ```bash
   scp marketing-automation-20260513-120000.tar.gz ubuntu@<vm-ip>:/tmp/
   ```

2. SSH into the VM and run:
   ```bash
   sudo bash /opt/marketing-automation/current/ops/deploy/deploy-release.sh \
     /tmp/marketing-automation-20260513-120000.tar.gz
   ```

3. Verify health:
   ```bash
   curl -s http://localhost:3000/api/health
   curl -s http://localhost:3000/api/health/resources | jq '.process.rssMb'
   ```

The deploy script:
- Extracts tarball to `releases/<timestamp>/`
- Atomically swaps `current` symlink
- Reloads systemd and restarts the service
- Runs a health check (waits up to 30s)
- Prunes old releases (keeps 5 most recent)

## Rollback

```bash
sudo bash /opt/marketing-automation/current/ops/deploy/rollback-release.sh
```

The rollback script:
- Finds the second-most-recent release in `releases/`
- Swaps `current` symlink back to it
- Restarts the service
- Runs health check (fails with exit 1 if health check doesn't pass within 30s)

## Secrets Management

### AWS SSM (Recommended)

Secrets are loaded via `ops/systemd/load-env-from-ssm.sh` which writes to `/opt/marketing-automation/shared/env/runtime.env`.

Required SSM parameters:
- `/marketing-automation/ppomppu-user-id`
- `/marketing-automation/ppomppu-user-pw`
- `/marketing-automation/bot-profile-dir`
- `/marketing-automation/activity-log-path`

### Fallback: runtime.env File

```bash
sudo mkdir -p /opt/marketing-automation/shared/env
sudo tee /opt/marketing-automation/shared/env/runtime.env << 'EOF'
PPOMPPU_USER_ID=your_id
PPOMPPU_USER_PW=your_pw
BOT_PROFILE_DIR=/opt/marketing-automation/shared/ppomppu_profile
ACTIVITY_LOG_PATH=/opt/marketing-automation/shared/activity_log.json
DRY_RUN_MODE=true
XAI_API_KEY=optional
NL_WEBHOOK_SECRET=optional
EOF
sudo chmod 600 /opt/marketing-automation/shared/env/runtime.env
```

## Monitoring Setup

### UptimeRobot

1. Create account at uptimerobot.com
2. Add new HTTP monitor:
   - **Friendly Name:** Ppomppu OTT Bot
   - **URL:** `https://<your-domain>/api/health`
   - **Monitoring Interval:** Every 5 minutes
   - **Timeout:** 30 seconds
3. Configure alerts → Slack webhook to `#alerts` channel

### systemd Journal

```bash
# View recent logs
journalctl -u marketing-automation -n 100 --no-pager

# Follow live
journalctl -u marketing-automation -f

# Check OOM kills
dmesg -T | grep -i oom
```

### Resource Dashboard

```bash
curl -s http://localhost:3000/api/health/resources | jq '{
  rss: .process.rssMb,
  heap: .process.heapUsedMb,
  activityLogEntries: .activityLog.entryCount,
  artifactSizeMb: .artifacts.totalSizeMb,
  warnings: .warnings
}'
```

## Troubleshooting

### OOM Kills

- Check: `dmesg -T | grep -i oom`
- Fix: Ensure systemd `MemoryMax=500M` is set. Verify `--max-old-space-size=400` in ExecStart.
- Chromium on 512 MB hosts needs `--js-flags=--max-old-space-size=100`.

### Chromium Won't Launch

- Missing `--disable-dev-shm-usage`: Add to `CHROMIUM_LAUNCH_ARGS` in `bot.ts`.
- Seccomp profile blocks sandbox: Add `--no-sandbox` to launch args (cloud hosts with strict seccomp).
- Check: `journalctl -u marketing-automation | grep -i chromium`

### SQLite Lock Errors (NAS)

- Ensure PRAGMAs are set: `journal_mode=WAL`, `synchronous=NORMAL`, `busy_timeout=5000`.
- File at `lib/competitor-ad-sqlite.ts` applies these on every `openDatabase()` call.

### Service Won't Start

- Check: `journalctl -u marketing-automation --since "5 minutes ago"`
- Verify env vars: `cat /opt/marketing-automation/shared/env/runtime.env`
- Check file ownership: `ls -la /opt/marketing-automation/current/`

### Deploy Fails Health Check

- The deploy script exits non-zero if health check fails within 30s.
- Run rollback immediately: `sudo bash ops/deploy/rollback-release.sh`
- Check logs: `journalctl -u marketing-automation -n 50`

## Docker-Specific

### Persistent Volumes

Docker named volumes ensure data survives container recreation:
- `marketing-automation-bot-profile` — browser session (login cookies)
- `marketing-automation-logs` — activity_log.json
- `marketing-automation-artifacts` — publisher debug artifacts

### Image Size

Verify after build:
```bash
docker images marketing-automation
# Should be < 800 MB
```

### shm_size

Docker compose sets `shm_size: 256mb`. This is mandatory — Chromium will crash on default Docker `/dev/shm` (64 MB).
