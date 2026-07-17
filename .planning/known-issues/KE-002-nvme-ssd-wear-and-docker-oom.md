---
id: KE-002
date: 2026-07-17
title: System unresponsiveness and rapid NVMe SSD wear from Docker/Playwright
severity: critical
status: fixed
components:
  - docker-compose.yml
  - lib/sharedBrowser.ts
  - mcp/parser-session.ts
fix_commit: docker-ssd-protection branch, 2026-07-17
---

## Symptoms

- Server mini PC becomes completely unresponsive or hangs during shutdown/reboot.
- Shutdown logs show `Failed unmounting var-lib-docker-rootfs...` due to locked files.
- NVMe SSD runs extremely hot and eventually fails/dies due to TBW (Terabytes Written) exhaustion.
- Publisher reports `EACCES: permission denied` for artifacts directory.

## Root Cause

A perfect storm of three aggressive I/O and memory issues:
1. **Aggressive OOM Kills**: The `docker-compose.yml` memory limit was set to `500M`. Node.js + Headless Chromium easily spikes above 500MB, triggering immediate SIGKILLs from Docker. This left zombie Chromium processes running and holding open file locks on the SSD.
2. **Infinite Docker Logs**: The default `json-file` Docker logging driver has no size limit. A 24/7 bot constantly writes stdout/stderr, resulting in massive GB-sized log files that continuously thrash the SSD.
3. **Chromium Disk Caching**: Playwright Chromium creates thousands of temporary cache files per navigation. With `BOT_PROFILE_DIR` mapped to the NVMe, Chromium was doing massive random writes to disk for every request.

## Diagnosis Path

1. Checked memory limits in `docker-compose.yml` (`500M`) vs expected Node+Chromium footprints (~1GB+).
2. Audited `docker-compose.yml` for logging driver size limits (none found).
3. Checked Playwright launch arguments in `lib/sharedBrowser.ts` and `mcp/parser-session.ts` for `--disable-disk-cache` (absent).

## Fix

**`docker-compose.yml`:**
- Increased `memory` limit from `500M` to `1G`.
- Added `init: true` to run a PID 1 `tini` process that automatically reaps orphaned/zombie Chromium processes on crash.
- Added `logging` limits (`max-size: "10m"`, `max-file: "3"`) to prevent logs from exceeding 30MB.

**`lib/sharedBrowser.ts` & `mcp/parser-session.ts`:**
- Added `--disable-disk-cache`, `--disable-crash-reporter`, and `--disable-breakpad` to `CHROMIUM_LAUNCH_ARGS` so Playwright runs purely in memory.

## Prevention

- Memory bounds and logging constraints are now codified in `.planning/spec-kit/specs/remote-ops.runtime.contract.json` and `remote-ops.observability.contract.json`.
- All future browser contexts MUST use `--disable-disk-cache` if the storage directory is on a physical disk rather than a RAM disk.

## Lessons Learned

- **Beware the Docker defaults.** Docker's lack of default log rotation is a known SSD killer in IoT and edge deployments.
- **Headless browsers are hostile to cheap disks.** Without explicit memory-cache flags, browsers will act like they are on a desktop with limitless I/O.
- **OOM Kills leak processes.** If a container crashes, background processes spawned by Node (like Chromium) might not exit cleanly unless Docker is configured with `init: true`.
