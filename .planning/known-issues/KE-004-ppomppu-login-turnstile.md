---
id: KE-004
date: 2026-10-16
title: Expired ppomppu session cannot be recovered — login form is behind Cloudflare Turnstile
severity: critical
status: mitigated
components:
  - lib/observer/boardDiagnostics.ts
  - lib/publisher/publisherRun.ts
  - lib/browser/sessionImport.ts
  - scripts/import-session-cookies.ts
fix_commit: da49bdb (fix/ppomppu-session-recovery) — deployed 2026-10-24
---

## Symptoms

Hourly publishing stopped on 2026-10-16 after a run of successes. The failures
changed shape from one run to the next, which made them look like three bugs:

| UTC | Error | Actual page state |
|-----|-------|-------------------|
| 10:38 | `locator.click: Timeout 1000ms exceeded` (draft row) | Logged in. Unrelated chronic flake, see below |
| 11:54 | `[Playbook] open-saved-drafts: no matching selector candidate` | **Logged out.** Guests also see 글쓰기, so the pre-flight passed and the write page showed a permission alert instead of the editor |
| 12:10, 12:41 | `PUBLISHER_WRITE_ENTRY_UNAVAILABLE: reason=login_required_or_session_missing` | Logged out; login recovery failed silently |

The scheduler backed off to 60 minutes and kept failing.

## Root Cause

1. The ppomppu session (`PHPSESSID` + `pmn`, both session cookies) expired
   server-side. There is no persistent auto-login cookie in the saved state.
2. ppomppu added a Cloudflare Turnstile widget (`.sec-turnstile`,
   `cf-turnstile-response`) plus `sec_nonce` and `login_token` to the
   `zb_login` form. A `form.submit()` without a solved token is rejected with
   the alert `보안 확인이 필요합니다. 페이지를 새로고침한 뒤 다시 시도해 주세요.`
   Headless Chromium does not pass the challenge.
3. `attemptPpomppuLoginFromBoard` swallowed every error and logged nothing, and
   tried twice per run (overlay, then login.php), so the alert was never seen.

The same error code on 2026-07-17 recovered on its own — scripted login still
worked then. The Turnstile form is the change.

## Diagnosis Path

- `docker logs marketing-automation-app-1 | grep publisher.run.failed` for the sequence.
- Failure screenshots in `/app/data/artifacts/publisher-runs/failures/<ts>/error.png`:
  the header shows the blue 로그인 button instead of the SharePlan nick.
- A one-off login with a `dialog` listener surfaced the rejection alert; the
  form's `outerHTML` showed the Turnstile widget and script.

## Fix

- `getBoardDiagnostics` reports `sessionState` from header markers
  (`로그아웃` link = logged in, `a.gnb-btn-login` = logged out).
  `isSessionUsable()` gates the publisher instead of the write-button count.
- Login makes one attempt, never posts credentials when Turnstile has no
  token, captures rejection alerts, and logs `publisher.login.failed` /
  `publisher.login.recovered`. Failure throws
  `PUBLISHER_LOGIN_REQUIRED: reason=<turnstile_unsolved|login_rejected|...>`.
- A run that found the session dead no longer saves its cookies, so it cannot
  overwrite a session imported while it was in flight.
- Recovery is manual: `npm run session:import` (runbook in
  `.agent/OPERATIONS.md`, "Restoring the ppomppu session").

The draft-row flake (about 1–2 per day since 2026-09) is fixed in the same change.
The row click opens a heavy preview, and the click lands, but Playwright's
action does not return within 1s. The timeout is now 5s, and a timeout counts
as success when `div.tempas-preview` is visible.

## Recurrence 2026-10-23

The imported session died at 17:27 UTC, about 7 days after its import, and
publishing failed hourly until the scheduler was disabled. Production was
still on the 2026-09-06 image, so the old code path ran: the old
`login_required_or_session_missing` message, two blind login attempts per
run, and cookies saved after every dead-session run. Follow-up work is the
[publisher-resilience](../initiatives/publisher-resilience/README.md)
initiative.

Since 2026-10-25 (`2fa66f8`) recovery runs on the server: a session loss posts
a login-console link to Slack, the server's own Chromium shows login.php with
the credentials filled, and a person taps Turnstile and 로그인 from any tailnet
device. The bot saves the session once the header shows it logged in. The
optional `tools/session-sync-extension` (`854c835`) does the same from a
desktop Chrome when one is online.

First live use of that console (2026-10-25): Turnstile spun for over a minute
after the tap and never passed. The console browser was the bot's headless
Playwright Chromium: its user agent said Windows Chrome 146 while
`navigator.platform` said Linux and the binary was Chromium 149, it had
headless-shell traits (no `window.chrome`, no plugins), and Playwright's CDP
was attached to the Turnstile iframe. The setup was the problem, not the
browser brand: another Chromium build (e.g. ungoogled) under the same
Playwright launch would carry the same contradictions. Since `15f44a7` the console
is a plain headed Chromium on Xvnc with nothing attached, driven over noVNC;
`navigator.webdriver` is false because nothing drives it. Side finding:
`brunhild.challenges.cloudflare.com` failing with `ERR_NAME_NOT_RESOLVED` is
Cloudflare's IPv6-only probe on an IPv4-only line, and harmless.

The VNC console passed Turnstile on its first use (2026-10-25 03:41 KST) and
the session was saved after the probe confirmed it. 자동로그인 issues
`PPOMSESSIONID` with a 30-day expiry (to 2026-11-23); the old saved state had
no such cookie. Whether it lets the bot's session outlive the ~7-day
`PHPSESSID` without another login shows around 2026-11-01.

## Lessons

- `writeButtonCount` is not a session signal on ppomppu. Check the header.
- A recovery path that swallows errors converts one clear failure into a
  sequence of misleading ones. Log the reason before returning false.
- Unattended login against a challenge-protected form is a liability: each
  rejected attempt from the server IP raises the account's risk score.
