---
id: BUG-20260904-PUB-01
date: 2026-09-04
title: Auto-Publisher Maintenance Window Unhandled & Hourly Rate-Limit Retry Loop Storm
severity: critical
status: open
components:
  - lib/observer/boardDiagnostics.ts
  - lib/observer/observerRun.ts
  - lib/publisher/ui/rateLimit.ts
  - lib/publisher/flow/runPublisherFlow.ts
  - lib/publisher/publisherRun.ts
  - lib/scheduler/run.ts
  - lib/state/publisher.ts
  - .planning/spec-kit/manifest/playbook.ppomppu-gonggu-v1.json
  - lib/notifications.ts
tags:
  - publisher
  - scheduler
  - rate-limit
  - maintenance-detection
  - slack-alerts
---

# Bug Report: Auto-Publisher Maintenance Window Unhandled & Hourly Rate-Limit Retry Loop Storm

## Overview

During production execution of the `ppomppu-gonggu-v1` workflow on Ppomppu, two critical operational anomalies have severely impacted the automated publishing pipeline:

1. **Unhandled Platform Maintenance ("점검 중 입니다"):** When Ppomppu enters scheduled or emergency server maintenance, the system treats it as an unhandled observer/publisher failure (`BOARD_ACCESS_DENIED: status=503 title="뽐뿌 시스템 점검 중입니다."`), sends alarming Slack error alerts, and fails to parse the maintenance window to pause operations until maintenance concludes.
2. **Hourly Rate Limit & 5-Minute Failure Loop Storm:** Ppomppu enforces a rule permitting only a single post within the same hour (60-minute posting cooldown). When the post-count gap remains safe post-publish or when a publish attempt is blocked by this rule, the scheduler enters an aggressive **5-minute retry loop** (`PUBLISHER_FAIL_RECHECK_INTERVAL = 5`), executing up to 12 failing browser runs per hour and spamming Slack with false-positive `[Playbook] open-saved-drafts: no matching selector candidate` errors.

---

## Bug 1: Platform Maintenance Window Unhandled & Missing Activity Pause ("점검 중 입니다")

### Symptoms
- Slack webhook channel receives critical failure alerts:
  ```text
  ❌ Publisher Failed [observer_error]
  > BOARD_ACCESS_DENIED: status=503 title="뽐뿌 시스템 점검 중입니다." url="https://www.ppomppu.co.kr/zboard/zboard.php?id=gonggu" rows=0
  ```
- Preceding or accompanying navigation requests encounter network timeouts (`page.goto: Timeout 30000ms exceeded`).
- The system continues attempting scheduled ticks throughout the outage, repeatedly launching Chromium processes, encountering HTTP 503, and dispatching repetitive error notifications.
- No automated pause or maintenance schedule extraction occurs.

### Root Cause Analysis
1. **Absence of Maintenance Classification in Diagnostics:**
   In `lib/observer/boardDiagnostics.ts`:
   ```typescript
   export async function getBoardDiagnostics(page: import('playwright').Page): Promise<BoardDiagnostics> {
     const [title, rowCount, writeButtonCount, bodyText] = await Promise.all([
       page.title(),
       page.locator(BOARD_ROW_SELECTOR).count(),
       page.locator('a:has-text("글쓰기")').count(),
       page.locator('body').innerText().catch(() => '')
     ]);

     const isForbidden = title.toLowerCase().includes('403') || bodyText.toLowerCase().includes('forbidden');
     // No check for maintenance keywords ("점검", "점검 중", "시스템 점검", "작업 안내")
     // No check for HTTP 503 / 502 / 504 status
   ```
   `getBoardDiagnostics` only evaluates `isForbidden` (HTTP 403). It does not detect maintenance state or extract maintenance timing.

2. **Generic Error Propagation in Observer:**
   In `lib/observer/observerRun.ts` (lines 133–140):
   ```typescript
   if (statusCode >= 400 || diagnostics.isForbidden) {
     throw new Error(
       `BOARD_ACCESS_DENIED: status=${statusCode} title="${diagnostics.title}" url="${diagnostics.url}" rows=${diagnostics.rowCount}`
     );
   }
   ```
   A 503 maintenance page is treated as an access denial exception rather than an operational pause signal.

3. **Alarmist Notification Dispatch:**
   In `lib/publisher/publisherRun.ts` (lines 149–151, 160–162):
   ```typescript
   if (log.status === 'error') {
     return await finish(false, log.error || '[Observer] Observer failed', 'observer_error', log);
   }
   ...
   } else if (decision !== 'gap_policy') {
     await sendSlackNotification(`❌ *Publisher Failed* [${decision}]\n> ${message}${force ? ' (Force)' : ''}`);
   }
   ```
   Every run during maintenance triggers `❌ Publisher Failed [observer_error]`.

4. **Missing Scheduler Sleep / Pause Mechanism:**
   `lib/scheduler/run.ts` has no field or state to record `maintenanceBlockedUntil`. When an observer run fails with 503, `tick()` returns `false`, causing `scheduleNext(false)` to resume standard interval ticks instead of sleeping for the duration of the maintenance window.

### Proposed Fix & Remediation Plan
1. **Enhance `BoardDiagnostics` & Add Maintenance Extractor:**
   - Detect maintenance patterns in `lib/observer/boardDiagnostics.ts`:
     - HTTP Status: `statusCode === 503 || statusCode === 502 || statusCode === 504`
     - Title/Body: Match `/(?:시스템|서버|서비스)?\s*점검\s*(?:안내|중)?/i`
   - Extract maintenance window using regex matching Korean date/time formats:
     - Regex: `/(?:점검\s*시간|일시|작업\s*시간)[^:\d]*[:\s]*((?:\d{4}[-년./]\s*)?\d{1,2}[-월./]\s*\d{1,2}[-일.]?)?\s*\(?[월화수목금토일]?\)?\s*(\d{1,2}:\d{2})\s*(?:~|-)\s*((?:\d{4}[-년./]\s*)?\d{1,2}[-월./]\s*\d{1,2}[-일.]?)?\s*\(?[월화수목금토일]?\)?\s*(\d{1,2}:\d{2})/i`
     - Calculate target UTC resume time (`maintenanceEndTime + 5m buffer`). If no time is extractable, default to a safe 30–60 minute pause.
2. **Classify Run Decision as `system_maintenance`:**
   - In `observerRun.ts` and `publisherRun.ts`, return decision `system_maintenance`.
   - Record `maintenanceBlockedUntil` into runtime state (`lib/state/publisher.ts`).
3. **Dedicated Informational Slack Notification:**
   - Notify once upon detection:
     ```text
     🚧 *Platform Maintenance Detected* [system_maintenance]
     > Ppomppu system maintenance in progress: "뽐뿌 시스템 점검 중입니다."
     > Specified window: 21:00 ~ 23:00 KST.
     > Automatically pausing publishing activities until 23:05 KST (~74 minutes).
     ```
   - Suppress failure alarms during the maintenance window.
4. **Scheduler Maintenance Awareness:**
   - In `lib/scheduler/run.ts`, check `maintenanceBlockedUntil`. If active, compute remaining minutes and set timer directly to the resumption time.

---

## Bug 2: Hourly Rate Limit (1-Post-Per-Hour Rule) & 5-Minute Failure Loop Storm

### Symptoms
- Execution logs demonstrate repeated publishing attempts every 5 minutes during active board hours:
  - `17:02, 17:08, 17:13, 17:18, 17:23, 17:28, 17:34` (7 attempts in 32 minutes)
  - `18:03, 18:08, 18:14, 18:19, 18:24, 18:29, 18:35, 18:40` (8 attempts in 40 minutes)
  - `20:28, 20:34, 20:39` (3 attempts in 11 minutes)
- Every attempt during these bursts fails with:
  `[Playbook] open-saved-drafts: no matching selector candidate` or `rate_limited`.
- After exactly 60–65 minutes from the prior successful post, the publication suddenly succeeds (e.g. 16:37 publish -> 17:44 success; 17:44 publish -> 18:45 success; 18:45 publish -> 19:47 success).
- Operators receive up to 12 failure notifications per hour on Slack.

### Root Cause Analysis
1. **The Ppomppu 1-Post-Per-Hour Restriction:**
   Ppomppu prohibits posting more than once per hour in the same board. When clicking the `글쓰기` button during the cooldown period, Ppomppu displays a block page or dialog ("글 등록 후 60분이 지나야 다음 게시물을 등록할 수 있습니다").
2. **Unhandled Alert Dialogs & Redirects:**
   - When clicking `a.write_btn` (`click-write`), Ppomppu often triggers a JavaScript `alert()` with `history.back()`. Playwright auto-dismisses the alert, leaving the page on the board list.
   - `detectRateLimit(page)` in `lib/publisher/ui/rateLimit.ts` checks `page.textContent("body")` for the literal string `글 등록 후 60분이 지나야 다음 게시물을 등록할 수 있습니다`. If the page was redirected back to the board list or if the phrasing differed (e.g. `1시간 이내에 1개의 글만 등록 가능`), `detectRateLimit` reports `{ blocked: false }`.
   - The runner proceeds to Step 3 (`open-saved-drafts`). Because the browser is on the board list rather than the write form, `input[value="임시저장된 게시글"]` is absent, causing `[Playbook] open-saved-drafts: no matching selector candidate`.
3. **The 5-Minute Scheduler Trap (`lib/scheduler/run.ts`):**
   In `lib/scheduler/run.ts` (lines 171–175, 212–222):
   ```typescript
   const PUBLISHER_FAIL_RECHECK_INTERVAL = 5; // Hardcoded 5 minutes

   // In tick():
   } else if (result.gapInfo) {
     // Publisher failed but the gap was already safe — retry sooner than the full interval
     wasPublisherFailGapSafe = true;
     gapInfo = result.gapInfo;
   }

   // In scheduleNext():
   if (fromGapSkip && typeof fromGapSkip === 'object') {
     const gapDiff = fromGapSkip.requiredGap - fromGapSkip.currentGap;
     if (gapDiff <= 0) {
       baseMinutes = PUBLISHER_FAIL_RECHECK_INTERVAL; // Retries in 5 minutes!
       nextMinutes = PUBLISHER_FAIL_RECHECK_INTERVAL;
     }
   }
   ```
   Because the board post gap was already safe (`currentGap >= requiredGap`), `gapDiff <= 0`. The scheduler overrides the base interval and forces a retry in **5 minutes**.
4. **Rate Limit State Ignored by Scheduler:**
   Even when `runPublisherFlow` identifies `rate_limited`:
   In `lib/publisher/publisherRun.ts` (line 294):
   ```typescript
   if (flow.decision === 'rate_limited') {
     const rateLimitedResult = await finish(false, flow.message, 'rate_limited', log);
     return { ...rateLimitedResult, gapInfo: { currentGap: log.current_gap_count, requiredGap: policy.gapThresholdMin } };
   }
   ```
   `publisherRun` returns `gapInfo`. The scheduler receives `gapInfo`, sees `gapDiff <= 0`, and schedules the next tick in **5 minutes**, completely ignoring `publishBlockedUntil`.

### Proposed Fix & Remediation Plan
1. **Proactive Cooldown Gatekeeper (Pre-Flight Check):**
   - Before launching Chromium in `runPublisher()`:
     - Check `publisherHistory` for the last successful publish (`published_verified`).
     - If `now - lastPublishAt < 60 minutes`:
       - Skip browser launch entirely.
       - Calculate exact remaining minutes `rem = Math.ceil((3600000 - (now - lastPublishAt)) / 60000)`.
       - Return `decision: 'rate_limited'` with `cooldownRemainingMinutes: rem`.
2. **Scheduler Awareness of Cooldown & Rate Limits:**
   - In `lib/scheduler/run.ts`:
     - When `result.decision === 'rate_limited'` or when rate limit is active, schedule the next tick for `now + remainingMinutes + 1m`.
     - Remove the 5-minute spin loop for rate limit and playbook errors. Replace with an exponential backoff (15m -> 30m -> 60m) or cooldown alignment.
3. **Capture Dialogs and Expand Rate Limit Patterns:**
   - In `runPublisherFlow.ts`, attach a `page.once('dialog', ...)` listener before `click-write` to capture alert text.
   - Expand `RATE_LIMIT_MARKER` in `rateLimit.ts` with regex patterns matching alternative Korean phrasing (e.g. `/(?:60분|1시간)\s*(?:이내|이 지나야|에\s*1개)/i`).
4. **Suppress Slack Failure Alerts for Rate Limits:**
   - In `lib/publisher/publisherRun.ts`, do not treat `rate_limited` as an alarming failure (`❌`). Send a quiet notice or skip Slack alerts entirely.

---

## Bug 3: Draft Modal Selector & Action Timeout Fragility

### Symptoms
- `[Playbook] open-saved-drafts: no matching selector candidate` occurs even when the write page loads normally.
- `locator.click: Timeout 500ms exceeded` on draft table row `<td class="subject">[OTT/멤버십]...</td>`.

### Root Cause
1. In `.planning/spec-kit/manifest/playbook.ppomppu-gonggu-v1.json`, `open-saved-drafts` only targets `input` and `button` tags. Ppomppu write forms frequently render the draft button as an anchor `<a class="btn_tempas">` or `<a href="...">임시저장된 게시글</a>`.
2. In `lib/publisher/ui/draftModal.ts`, `DRAFT_MODAL_ACTION_TIMEOUT_MS = 1000` (or 500ms). When the modal backdrop is animating or DOM rendering is slow, Playwright's actionability check times out prematurely.

### Proposed Fix & Remediation Plan
1. Update `playbook.ppomppu-gonggu-v1.json` to include:
   ```json
   "selectors": [
     ["a.btn_tempas"],
     ["button.btn_tempas"],
     ["input[value*=\"임시저장\"]"],
     ["button:has-text(\"임시저장\")"],
     ["a:has-text(\"임시저장\")"]
   ]
   ```
2. Increase `DRAFT_MODAL_ACTION_TIMEOUT_MS` in `draftModal.ts` to `3000ms–5000ms`.

---

## Component Impact Matrix

| Component | Nature of Defect | Required Remediation | Severity |
| :--- | :--- | :--- | :--- |
| `lib/observer/boardDiagnostics.ts` | No maintenance status (503) or schedule parser | Add `isMaintenance` flag and Korean schedule regex extractor | High |
| `lib/observer/observerRun.ts` | Throws generic `BOARD_ACCESS_DENIED` on 503 | Return structured maintenance diagnostic; don't crash pipeline | High |
| `lib/publisher/ui/rateLimit.ts` | Rigid text marker; does not capture `window.alert` | Support flexible regex patterns and dialog event interception | Medium |
| `lib/publisher/publisherRun.ts` | Sends `❌` Slack alerts for maintenance & rate limits | Dispatch informative `🚧` alerts; enforce pre-flight 60m cooldown | High |
| `lib/scheduler/run.ts` | Hardcoded 5-min retry loop on safe-gap errors | Align next tick with `publishBlockedUntil` / `maintenanceBlockedUntil` | Critical |
| `lib/state/publisher.ts` | Missing `maintenanceBlockedUntil` in runtime state | Add in-memory and disk persistence for maintenance state | Medium |
| `manifest/playbook.ppomppu-gonggu-v1.json` | Missing `<a>` selectors for draft restoration | Add anchor and partial text selectors | Medium |
| `lib/publisher/ui/draftModal.ts` | 500ms–1000ms click timeout too strict | Increase action timeout to 3000ms–5000ms | Medium |
