/**
 * lib/observer/boardDiagnostics.ts
 *
 * Board access diagnostics and login recovery utilities.
 */

import { ENV } from '../../config/env.js';

const BOARD_ROW_SELECTOR = 'tr.list0, tr.list1, tr.common-list0, tr.common-list1, tr.list_notice';
const PPOMPPU_LOGIN_URL = 'https://www.ppomppu.co.kr/zboard/login.php';

export type MaintenanceNoticeResult = {
  isMaintenance: boolean;
  maintenanceNotice: string | null;
  maintenanceUntil: string | null;
};

export type BoardDiagnostics = {
  url: string;
  title: string;
  rowCount: number;
  writeButtonCount: number;
  isForbidden: boolean;
  loginPromptVisible: boolean;
  isMaintenance: boolean;
  maintenanceNotice: string | null;
  maintenanceUntil: string | null;
};

const MAINTENANCE_KEYWORDS = [
  '점검 안내',
  '시스템 점검',
  '시스템 점검 중',
  '점검 중 입니다',
  '점검 중입니다',
  '서비스 점검',
  '정기 점검',
  '서버 점검',
  '긴급 점검',
  '작업 안내',
  '서비스 점검안내',
  '시스템 점검안내',
  '서비스 점검 안내',
  '점검중입니다',
  '점검중',
  'server maintenance',
  'system maintenance',
  'under maintenance'
];

const MAINTENANCE_STATUS_CODES = [502, 503, 504];

function adjustHourPeriod(hour: number, period?: string): number {
  if (!period) return hour;
  const p = period.toUpperCase();
  if ((p === '오후' || p === '저녁' || p === '밤' || p === 'PM') && hour < 12) {
    return hour + 12;
  }
  if ((p === '오전' || p === 'AM') && hour === 12) {
    return 0;
  }
  return hour;
}

/**
 * Parses platform maintenance notices and extracts expected resumption time.
 * Converts Korean local time (KST, UTC+9) to UTC with a +5 minute safety buffer.
 * If notice text is present but time window is unspecified, falls back to 30 minutes.
 */
export function parseMaintenanceNotice(
  bodyText: string,
  title: string = '',
  statusCode: number = 0,
  referenceDate: Date = new Date()
): MaintenanceNoticeResult {
  const textCombined = `${title}\n${bodyText}`;
  const lowerText = textCombined.toLowerCase();

  const isStatusCodeMaintenance = MAINTENANCE_STATUS_CODES.includes(statusCode);
  const hasKeyword = MAINTENANCE_KEYWORDS.some((kw) => textCombined.includes(kw) || lowerText.includes(kw.toLowerCase()));

  if (!isStatusCodeMaintenance && !hasKeyword) {
    return {
      isMaintenance: false,
      maintenanceNotice: null,
      maintenanceUntil: null
    };
  }

  // Extract snippet for maintenance notice
  let noticeSnippet: string | null = null;
  const lines = textCombined.split('\n').map((l) => l.trim()).filter(Boolean);
  const matchedLine = lines.find((l) => MAINTENANCE_KEYWORDS.some((kw) => l.includes(kw) || l.toLowerCase().includes(kw.toLowerCase())));
  if (matchedLine) {
    noticeSnippet = matchedLine.slice(0, 300);
  } else if (title.trim()) {
    noticeSnippet = title.trim().slice(0, 300);
  } else {
    noticeSnippet = isStatusCodeMaintenance ? `HTTP ${statusCode} Service Unavailable` : 'Platform Maintenance';
  }

  // Parse time window
  // KST is UTC+9
  const kstOffsetMs = 9 * 60 * 60 * 1000;
  const refTimeMs = referenceDate.getTime();
  const refKst = new Date(refTimeMs + kstOffsetMs);
  const defaultYear = refKst.getUTCFullYear();
  const defaultMonth = refKst.getUTCMonth() + 1;
  const defaultDay = refKst.getUTCDate();

  let parsedEndUtcMs: number | null = null;

  // Pattern 1: Full date + time range
  // e.g. 2026년 8월 18일 21:00 ~ 23:00, 2026-08-18 21:00 ~ 2026-08-18 23:00, 8월 18일 21:00 ~ 23:00
  const fullDateRangeRegex = /(?:(\d{4})[년./-]\s*)?(\d{1,2})[월./-]\s*(\d{1,2})일?(?:\s*\([가-힣]+\))?\s*(?:(새벽|오전|오후|저녁|밤|AM|PM)\s*)?(\d{1,2})(?::(\d{2})|시(?:\s*(\d{1,2})분)?)\s*(?:~|-)\s*(?:(?:(\d{4})[년./-]\s*)?(\d{1,2})[월./-]\s*(\d{1,2})일?(?:\s*\([가-힣]+\))?\s*)?(?:(새벽|오전|오후|저녁|밤|AM|PM)\s*)?(\d{1,2})(?::(\d{2})|시(?:\s*(\d{1,2})분)?)/i;
  const m1 = textCombined.match(fullDateRangeRegex);

  if (m1) {
    const startYear = m1[1] ? parseInt(m1[1], 10) : defaultYear;
    const startMonth = parseInt(m1[2], 10);
    const startDay = parseInt(m1[3], 10);
    const rawStartHour = parseInt(m1[5], 10);
    const startHour = adjustHourPeriod(rawStartHour, m1[4]);

    const endYear = m1[8] ? parseInt(m1[8], 10) : (m1[9] ? startYear : startYear);
    const endMonth = m1[9] ? parseInt(m1[9], 10) : startMonth;
    let endDay = m1[10] ? parseInt(m1[10], 10) : startDay;
    const rawEndHour = parseInt(m1[12], 10);
    const endHour = adjustHourPeriod(rawEndHour, m1[11] || m1[4]);
    const endMin = m1[13] ? parseInt(m1[13], 10) : (m1[14] ? parseInt(m1[14], 10) : 0);

    // If end day not explicitly provided and endHour < startHour, overnight roll to next day
    if (!m1[10] && endHour < startHour) {
      endDay += 1;
    }

    const endKstUtcMs = Date.UTC(endYear, endMonth - 1, endDay, endHour, endMin);
    parsedEndUtcMs = endKstUtcMs - kstOffsetMs;
  }

  // Pattern 2: Time range only
  // e.g. 02:00 ~ 06:00, 21:00 ~ 23:00, 23:00 ~ 03:00, 새벽 2시 ~ 6시, 02시 ~ 06시, 02시 30분 ~ 06시 15분
  if (!parsedEndUtcMs) {
    const timeRangeRegex = /(?:(새벽|오전|오후|저녁|밤|AM|PM)\s*)?(\d{1,2})(?::(\d{2})|시(?:\s*(\d{1,2})분)?)\s*(?:~|-)\s*(?:(새벽|오전|오후|저녁|밤|AM|PM)\s*)?(\d{1,2})(?::(\d{2})|시(?:\s*(\d{1,2})분)?)/i;
    const m2 = textCombined.match(timeRangeRegex);
    if (m2) {
      const rawStartHour = parseInt(m2[2], 10);
      const startHour = adjustHourPeriod(rawStartHour, m2[1]);

      const rawEndHour = parseInt(m2[6], 10);
      const endHour = adjustHourPeriod(rawEndHour, m2[5] || m2[1]);
      const endMin = m2[7] ? parseInt(m2[7], 10) : (m2[8] ? parseInt(m2[8], 10) : 0);

      let endDay = defaultDay;
      if (endHour < startHour) {
        endDay += 1;
      }

      const endKstUtcMs = Date.UTC(defaultYear, defaultMonth - 1, endDay, endHour, endMin);
      let candidateUtcMs = endKstUtcMs - kstOffsetMs;

      // If candidate end time is in the past relative to refTimeMs, check if adding 1 day makes sense
      if (candidateUtcMs < refTimeMs) {
        candidateUtcMs += 24 * 60 * 60 * 1000;
      }
      parsedEndUtcMs = candidateUtcMs;
    }
  }

  // Buffer: +5 minutes
  const BUFFER_MS = 5 * 60 * 1000;
  // Fallback: 30 minutes
  const FALLBACK_MS = 30 * 60 * 1000;

  let maintenanceUntilMs: number;
  if (parsedEndUtcMs !== null) {
    maintenanceUntilMs = parsedEndUtcMs + BUFFER_MS;
  } else {
    // Unspecified time -> 30m fallback
    maintenanceUntilMs = refTimeMs + FALLBACK_MS;
  }

  return {
    isMaintenance: true,
    maintenanceNotice: noticeSnippet,
    maintenanceUntil: new Date(maintenanceUntilMs).toISOString()
  };
}

export async function getBoardDiagnostics(
  page: import('playwright').Page,
  statusCode: number = 0
): Promise<BoardDiagnostics> {
  const [title, rowCount, writeButtonCount, bodyText] = await Promise.all([
    page.title().catch(() => ''),
    page.locator(BOARD_ROW_SELECTOR).count().catch(() => 0),
    page.locator('a:has-text("글쓰기")').count().catch(() => 0),
    page.locator('body').innerText().catch(() => '')
  ]);

  const isForbidden = statusCode === 403 || title.toLowerCase().includes('403') || bodyText.toLowerCase().includes('forbidden');
  const loginHints = ['로그인', '로그 인', 'login'];
  const loginPromptVisible = loginHints.some((hint) => bodyText.toLowerCase().includes(hint.toLowerCase()));

  const maintenanceInfo = parseMaintenanceNotice(bodyText, title, statusCode);

  return {
    url: page.url(),
    title,
    rowCount,
    writeButtonCount,
    isForbidden,
    loginPromptVisible,
    isMaintenance: maintenanceInfo.isMaintenance,
    maintenanceNotice: maintenanceInfo.maintenanceNotice,
    maintenanceUntil: maintenanceInfo.maintenanceUntil
  };
}

async function fillAndSubmitLoginForm(page: import('playwright').Page): Promise<boolean> {
  // Fill credentials — works on both overlay and standalone login page
  const userIdInput = page.locator('input[name="user_id"]').first();
  const passwordInput = page.locator('input[name="password"]').first();
  if ((await userIdInput.count()) === 0 || (await passwordInput.count()) === 0) {
    return false;
  }

  await userIdInput.fill(ENV.PPOMPPU_USER_ID);
  await passwordInput.fill(ENV.PPOMPPU_USER_PW);

  // Set auto_login via JS — the checkbox onclick handler can prevent Playwright clicks
  await page.evaluate(() => {
    const cb = document.querySelector('input[name="auto_login"]') as HTMLInputElement;
    if (cb && !cb.checked) { cb.checked = true; }
  });

  // Submit the form via JS — the submit button is input[type="image"] with no text label
  await page.evaluate(() => {
    const form = document.querySelector('form[name="zb_login"]') as HTMLFormElement
      || document.querySelector('form#zb_login') as HTMLFormElement;
    if (form) form.submit();
  });

  // Wait for the redirect to complete after login
  try {
    await page.waitForURL('**/zboard.php**', { timeout: 10000 });
  } catch {
    // If URL didn't change, give it a moment more
    await page.waitForTimeout(3000);
  }

  return true;
}

export async function attemptPpomppuLoginFromBoard(page: import('playwright').Page, boardUrl: string): Promise<boolean> {
  // Strategy 1: Try the login overlay on the board page
  const loginLink = page.locator('a.loginsmbtn, a:has-text("로그인")').first();
  const hasLoginLink = (await loginLink.count()) > 0;

  if (hasLoginLink) {
    try {
      await loginLink.click({ timeout: 5000 });
      await page.waitForTimeout(500);

      const submitted = await fillAndSubmitLoginForm(page);
      if (submitted) {
        // Check if we're now logged in
        if (!page.url().includes('zboard.php?id=gonggu')) {
          await page.goto(boardUrl, { waitUntil: 'domcontentloaded', timeout: ENV.BOT_NAV_TIMEOUT_MS });
          await page.waitForTimeout(2000);
        }
        const after = await getBoardDiagnostics(page);
        if (after.writeButtonCount > 0) return true;
      }
    } catch {
      // Overlay failed, fall through to Strategy 2
    }
  }

  // Strategy 2: Navigate directly to login.php
  try {
    await page.goto(PPOMPPU_LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: ENV.BOT_NAV_TIMEOUT_MS });
    await page.waitForTimeout(500);

    const submitted = await fillAndSubmitLoginForm(page);
    if (submitted) {
      if (!page.url().includes('zboard.php?id=gonggu')) {
        await page.goto(boardUrl, { waitUntil: 'domcontentloaded', timeout: ENV.BOT_NAV_TIMEOUT_MS });
        await page.waitForTimeout(2000);
      }
      const after = await getBoardDiagnostics(page);
      if (after.writeButtonCount > 0) return true;
    }
  } catch {
    // Direct login also failed
  }

  return false;
}
