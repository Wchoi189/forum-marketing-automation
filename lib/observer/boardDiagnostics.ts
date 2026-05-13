/**
 * lib/observer/boardDiagnostics.ts
 *
 * Board access diagnostics and login recovery utilities.
 */

import { ENV } from '../../config/env.js';

const BOARD_ROW_SELECTOR = 'tr.list0, tr.list1, tr.common-list0, tr.common-list1, tr.list_notice';
const PPOMPPU_LOGIN_URL = 'https://www.ppomppu.co.kr/zboard/login.php';

export type BoardDiagnostics = {
  url: string;
  title: string;
  rowCount: number;
  writeButtonCount: number;
  isForbidden: boolean;
  loginPromptVisible: boolean;
};

export async function getBoardDiagnostics(page: import('playwright').Page): Promise<BoardDiagnostics> {
  const [title, rowCount, writeButtonCount, bodyText] = await Promise.all([
    page.title(),
    page.locator(BOARD_ROW_SELECTOR).count(),
    page.locator('a:has-text("글쓰기")').count(),
    page.locator('body').innerText().catch(() => '')
  ]);

  const isForbidden = title.toLowerCase().includes('403') || bodyText.toLowerCase().includes('forbidden');
  const loginHints = ['로그인', '로그 인', 'login'];
  const loginPromptVisible = loginHints.some((hint) => bodyText.toLowerCase().includes(hint.toLowerCase()));

  return {
    url: page.url(),
    title,
    rowCount,
    writeButtonCount,
    isForbidden,
    loginPromptVisible
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
