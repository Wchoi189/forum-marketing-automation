# Operations Guide

## Publisher Success Criteria

"Success" means more than a click:
- Draft is loaded into editor (required body text present).
- Submit action is triggered.
- URL transitions to a board list/view URL (not write screen).

If any criterion fails, return an error (do not emit optimistic success).

## Debug Artifact Workflow

### Environment Toggles

| Variable | Purpose |
|----------|---------|
| `PUBLISHER_DEBUG_SCREENSHOTS=true` | Step screenshots |
| `PUBLISHER_DEBUG_TRACE=true` | Playwright trace recording |
| `PUBLISHER_TRACE_SUCCESS_SAMPLE_PERCENT` (0–100) | Fraction of successful runs to persist trace |

Artifacts stored under `artifacts/publisher-runs/<timestamp>/`.

On failure, always capture `error.png` when a page exists.

### Trace Replay

```bash
npx playwright show-trace <path-to-trace.zip>
```

### Escalation

Temporarily set `PUBLISHER_TRACE_SUCCESS_SAMPLE_PERCENT=100` (and optionally `LOG_LEVEL=debug`).

## Retention & Garbage Collection

Every directory that grows without bound has exactly one owner listed here. If
you add a directory that accumulates files, add a row — an unowned directory is
how `.agent/session-handovers/` reached 49 files and `artifacts/` reached 13 MB
inside git.

| Path | Grows from | Retention | Enforced by |
|------|-----------|-----------|-------------|
| `artifacts/publisher-runs/` | Debug screenshots and traces | Delete dirs older than 7 days; hard cap 500 MB, oldest-first | `rotateArtifacts()` + `capArtifactsBySize()` |
| `artifacts/*.tmp` | Interrupted atomic writes | Delete when older than 1 hour | `cleanOrphanedTempFiles()` |
| `activity_log.json` | Every observer/publisher run | Truncate to newest 500 once it exceeds 1000 | `rotateActivityLog()` |
| `.agent/session-handovers/` | One file per agent session | Keep newest 10, move rest to `archive/` | `rotateSessionHandovers()` |
| `ppomppu_profile/` | Chromium caches | Rebuildable cache subdirs deleted | `cleanBrowserProfile()` |
| `artifacts/competitor-ads/` | Intel pipeline (SQLite + LLM cache) | **Durable — never collected** | — |
| `artifacts/kakao-history/` | Kakao ingest | **Durable — never collected** | — |
| `artifacts/runtime-controls.json` | Control panel writes | **Durable — never collected** | — |
| `artifacts/publisher-history.json` | Publisher run log | **Durable — never collected** | — |
| `data/` | Kakao pipeline inputs and outputs | **Durable — never collected.** Untracked from git 2026-08-08; raw records backed up outside the repo | — |
| `dist/`, `node_modules/.vite/` | Builds | Manual | `npm run clean:all` |

`runGarbageCollection()` runs at startup and every 6 hours, production only
(`NODE_ENV=production && !DEV_SKIP_BOT`). Trigger it manually with
`POST /api/resource/gc`.

**GC scope is `artifacts/publisher-runs/`, not `artifacts/`.** The module-local
`PUBLISHER_RUNS_DIR` in `lib/resourceMonitor.ts` is deliberately narrower than
`ENV.ARTIFACTS_DIR`. Widening it would delete the competitor-intel database.
`tests/unit/resourceMonitor.test.ts` guards this.

`npm run clean:all` prunes regenerable files on demand; `-- --dry-run` lists
what it would remove without deleting.

## Restoring the ppomppu session

Symptom: `PUBLISHER_LOGIN_REQUIRED: reason=turnstile_unsolved` (or `login_rejected`)
in `publisher.run.failed`, or `session.lost reason=probe_logged_out`. The bot
cannot log in by itself (KE-004); a person must.

Warnings before and at death (SL-004/SL-005):

- **Expiring:** `SESSION_EXPECTED_LIFETIME_HOURS` (168) minus
  `SESSION_EXPIRY_WARNING_HOURS` (24) after the last import, the Overview page
  shows an amber banner and Slack gets one "ppomppu session expiring" message.
  A console login then renews it early.
- **Dead:** a red banner, and one Slack message per death (the login console
  link, or a plain "session dead" when no console can be offered). The
  scheduler parks; "Publisher Failed" messages are suppressed while parked.
- **Probe:** a gap-skip tick never loads the board, so the scheduler probes the
  saved session when nothing has verified it for `SESSION_PROBE_INTERVAL_HOURS`
  (6). Only a `logged_out` header marks it dead; `unknown` changes nothing.

### Default: login console (any device, no desktop needed)

The server opens a plain Chromium on login.php inside a private VNC desktop
(Xvnc), with the ID, password and 자동로그인 already filled, and shows it on a
token-protected page (noVNC). A person taps the Turnstile check and 로그인. The
server reads the new login cookies from that browser's profile on disk (within
~30 s, Chromium's flush interval), probes them in the bot's browser and saves
them if logged in; the page then says Done. Cookies come from the server's IP,
so nothing leaves the server.

The console browser has **no automation attached** (no Playwright, no CDP, no
user-agent override). Turnstile spun forever in the earlier Playwright console
because that browser claimed Windows Chrome while reporting Linux. Do not add
CDP, Playwright or identity overrides to the console browser: `--remote-debugging-*`
alone makes Chromium report `navigator.webdriver = true`.

- **Automatic:** when a run fails with `PUBLISHER_LOGIN_REQUIRED`, Slack gets a
  "ppomppu login needed" link (at most every 3 h; each link lives 15 min).
- **On demand, no Slack:** open `PUBLIC_BASE_URL/session/console` (tailnet:
  `http://100.124.62.44:3000/session/console`), enter `SESSION_IMPORT_SECRET`
  as the console key and press "Open login console here"; the console opens in
  the same window. The key can be remembered on the device, or bookmarked as
  `…/session/console#key=<secret>`, which opens the console on load. The
  fragment never reaches the server, but it does sit in browser history and
  bookmarks, so use it only on the operator's own devices. If a console is
  already open (e.g. the automatic one), this joins it.
- **On demand, via Slack:** same page, "Send login link to Slack instead". No
  key needed; the link goes to Slack only, never back to the page.
- **From a shell:** `curl -X POST localhost:3000/api/session/console -H
  "Authorization: Bearer $SESSION_IMPORT_SECRET"` returns the URL directly.

Needs `SESSION_IMPORT_SECRET` and `PUBLIC_BASE_URL` in `.env.docker`. The
`session.imported` log line lists which login cookies have a real expiry date
(names only): that shows whether 자동로그인 lets the session outlive ~7 days.

### Optional: browser session sync extension

Only useful while a desktop Chrome that is logged in to ppomppu can reach the
bot; it is not a dependency. That Chrome pushes its ppomppu cookies to
`POST /api/session/import` whenever `PHPSESSID` or `pmn` change, and every 30
minutes. The bot probes the board with them and saves only a logged-in session,
keeping its own `cf_clearance`. Slack reports each refresh or rejection.

One-time setup:

1. `npm run session:sync-setup` — generates `SESSION_IMPORT_SECRET` in
   `.env.docker` if absent and writes the gitignored
   `tools/session-sync-extension/config.local.json`.
2. `docker compose up -d app` if a secret was generated.
3. chrome://extensions → Developer mode → Load unpacked →
   `tools/session-sync-extension`.

After that, recovering an expired session is: log in to ppomppu in that Chrome
(tick 자동로그인; you solve Turnstile as any visitor does). The badge on the
extension icon is blank when synced; hover it for the last result.

### Manual fallback: cookie export

Use when the extension cannot reach the bot (remote host) or Chrome is not available.

1. Log in to ppomppu in a normal browser as the bot account and tick 자동로그인.
2. Export the `ppomppu.co.kr` cookies as JSON (Cookie-Editor's export works).
   Save it as `cookies-*.json` so `.gitignore` covers it — it is a live session.
3. Wait until `GET /api/publisher-status` reports `running: false`.
4. Merge into the deployed state. The bot's own `cf_clearance` is kept, because
   Cloudflare binds it to the server's IP:

   ```bash
   C=marketing-automation-app-1
   docker cp $C:/app/data/browser-profile/browser-storage-state.json ./state.json
   npm run session:import -- cookies-export.json --state ./state.json
   docker cp ./state.json $C:/app/data/browser-profile/browser-storage-state.json
   docker exec -u root $C chown app:app /app/data/browser-profile/browser-storage-state.json
   rm ./state.json ./state.json.bak-* cookies-export.json
   ```

   Add `--verify` on a machine whose IP Cloudflare accepts to open the board
   with the merged cookies and report `session=logged_in`.

   Or skip the copies: `curl -X POST localhost:3000/api/session/import -H
   "Authorization: Bearer $SESSION_IMPORT_SECRET" -H 'Content-Type: application/json'
   -d "{\"cookies\": $(cat cookies-export.json)}"` verifies and saves in one step.
5. Trigger `POST /api/run-publisher` or wait for the next tick, and check for
   `published_verified`.

## Selector Strategy

- Prefer stable class/text combinations and scoped locators over absolute XPath.
- Use XPath only as a scoped fallback when sibling relationships are the only reliable signal.
- Keep locators resilient to duplicated labels in list rows/modals.

## Regression Prevention

| Change Type | Command |
|-------------|---------|
| Code edits | `npm run lint` |
| API/publisher changes | `npm run test:integration` |
| Parser/runtime changes | `npm run test` |

Never weaken fail-closed checks. If one blocks the task, fix the cause instead.

## Gap Health Semantics

**`gap` = number of posts AHEAD of ours** (`sharePlanIndex` in `bot.ts`).

`SAFE` means gap ≥ threshold — safe to publish NOW. It is NOT a system health indicator.

| Gap | Meaning |
|-----|---------|
| 0–threshold, rising | Normal — just published |
| ≈ threshold | Normal — about to publish |
| threshold+1 to +2 | Acceptable overshoot |
| threshold+3 to +5 | Warning — recheck loop slow |
| threshold+6+ | **Critical** — scheduler stalled |

**Do not be misled by `Decision: SAFE` in logs.** A gap of 14 with threshold 4 means we are 10 posts overdue.

Confirm via `GET /api/control-panel` → `lastObserverResult`.

**Scheduler is gap-driven, not time-driven.** After successful publish, enters gap-recheck mode (3min → 1.5min → 30s). Base interval (60 min) applies only after errors. See [KE-001](KNOWN_ISSUES.md) if 60-min gaps appear.