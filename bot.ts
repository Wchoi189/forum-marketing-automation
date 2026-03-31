import { chromium } from 'playwright';
import fs from 'fs/promises';
import type { ActivityLog, Post } from './contracts/models.js';
import { ENV } from './config/env.js';

const BOARD_URL = 'https://www.ppomppu.co.kr/zboard/zboard.php?id=gonggu';
const USER_DATA_DIR = ENV.BOT_PROFILE_DIR;
const LOG_FILE = ENV.ACTIVITY_LOG_PATH;
const GAP_THRESHOLD = ENV.OBSERVER_GAP_THRESHOLD;
const PARSE_CONFIDENCE_MIN = 0.9;
const REQUIRED_DRAFT_TITLE =
  '[OTT/멤버십] [SharePlan] 끝까지 관리된 유튜브/코세라 프리미엄 (가입 완료 후 결제)';
const REQUIRED_BODY_TEXT = '회원 모집 안내';
const REQUIRED_CATEGORY_LABEL = '유튜브';

export async function getLogs(): Promise<ActivityLog[]> {
  try {
    const data = await fs.readFile(LOG_FILE, 'utf-8');
    return JSON.parse(data);
  } catch (e) {
    return [];
  }
}

function createManualReviewMessage(parseConfidence: number): string {
  return `MANUAL_REVIEW_REQUIRED: parse confidence ${parseConfidence.toFixed(2)} is below ${PARSE_CONFIDENCE_MIN.toFixed(2)}`;
}

async function saveLog(log: ActivityLog) {
  const logs = await getLogs();
  logs.unshift(log);
  // Keep last 300 logs for weekly analysis (approx 12 days if run hourly)
  await fs.writeFile(LOG_FILE, JSON.stringify(logs.slice(0, 300), null, 2));
}

export async function runObserver() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  try {
    console.log('Running Observer...');
    await page.goto(BOARD_URL, { waitUntil: 'networkidle' });

    // Fallback selector chain + confidence score keeps observer fail-closed on layout drift.
    const rows = await page.$$eval('tr.list0, tr.list1', (trs) => {
      function pickText(el: Element, selectors: string[]): { value: string; confidence: number } {
        for (let i = 0; i < selectors.length; i++) {
          const selected = el.querySelector(selectors[i]);
          const value = selected?.textContent?.trim() || '';
          if (value) {
            return { value, confidence: i === 0 ? 1 : 0.75 };
          }
        }
        return { value: '', confidence: 0 };
      }

      function pickInt(el: Element, selectors: string[]): { value: number; confidence: number } {
        const textResult = pickText(el, selectors);
        const value = Number.parseInt(textResult.value || '0', 10);
        return { value: Number.isNaN(value) ? 0 : value, confidence: textResult.confidence };
      }

      return trs.map(tr => {
        const title = pickText(tr, ['td.list_title', 'td[class*="list_title"]', 'td:nth-child(3)']);
        const author = pickText(tr, ['td.list_name', 'td[class*="list_name"]', 'td:nth-child(4)']);
        const date = pickText(tr, ['td.eng.list_date', 'td[class*="list_date"]', 'td:nth-child(5)']);
        const views = pickInt(tr, ['td.eng.list_hit', 'td[class*="list_hit"]', 'td:nth-child(6)']);

        const parseConfidence = (title.confidence + author.confidence + date.confidence + views.confidence) / 4;

        return {
          title: title.value,
          author: author.value,
          date: date.value,
          views: views.value,
          parseConfidence,
          isNotice: tr.querySelector('img[src*="notice"]') !== null
        };
      });
    });

    const nonNoticeRows = rows.filter(r => !r.isNotice);
    const validRows = nonNoticeRows.filter(r => r.title && r.author);
    const parseConfidence =
      validRows.length === 0
        ? 0
        : validRows.reduce((acc, row) => acc + row.parseConfidence, 0) / validRows.length;

    const sharePlanIndex = validRows.findIndex(r => r.author.toLowerCase().includes('shareplan'));

    let gap = 0;
    let competitors: string[] = [];
    let lastPost: (typeof validRows)[number] | null = null;

    if (sharePlanIndex === -1) {
      // If not found, assume safe but gap is large
      gap = validRows.length;
      competitors = validRows.slice(0, 5).map(r => r.author);
    } else {
      gap = sharePlanIndex;
      competitors = validRows.slice(0, sharePlanIndex).map(r => r.author);
      lastPost = validRows[sharePlanIndex];
    }

    const status = parseConfidence < PARSE_CONFIDENCE_MIN ? 'unsafe' : gap >= GAP_THRESHOLD ? 'safe' : 'unsafe';
    const allPosts: Post[] = validRows.map(({ title, author, date, views, isNotice }) => ({
      title,
      author,
      date,
      views,
      isNotice
    }));

    const log: ActivityLog = {
      timestamp: new Date().toISOString(),
      current_gap_count: gap,
      last_post_timestamp: lastPost?.date || 'N/A',
      top_competitor_names: competitors,
      view_count_of_last_post: lastPost?.views || 0,
      status,
      all_posts: allPosts,
      ...(parseConfidence < PARSE_CONFIDENCE_MIN ? { error: createManualReviewMessage(parseConfidence) } : {})
    };

    await saveLog(log);
    return log;
  } catch (error: any) {
    console.error('Observer Error:', error);
    const log: ActivityLog = {
      timestamp: new Date().toISOString(),
      current_gap_count: 0,
      last_post_timestamp: 'N/A',
      top_competitor_names: [],
      view_count_of_last_post: 0,
      status: 'error',
      all_posts: [],
      error: error.message
    };
    await saveLog(log);
    return log;
  } finally {
    await browser.close();
  }
}

export async function runPublisher(force: boolean = false) {
  let log: ActivityLog | undefined;
  try {
    log = await runObserver();
    
    if (log.status === 'error') {
      return { success: false, message: log.error || 'Observer failed', log };
    }

    if (force && !ENV.MANUAL_OVERRIDE_ENABLED) {
      return { success: false, message: 'Manual override is disabled by environment policy', log };
    }

    if (!force && log.status !== 'safe') {
      console.log('Gap is too small. Skipping publication.');
      return { success: false, message: log.error || 'Gap is too small', log };
    }

    // Launch persistent context
    const context = await chromium.launchPersistentContext(USER_DATA_DIR, {
      headless: true,
      viewport: { width: 1280, height: 800 }
    });

    const page = await context.newPage();

    try {
      console.log('Running Publisher...');
      await page.goto(BOARD_URL);

      // Step 1: Access Writing Interface
      // Find "글쓰기" button. Usually an <a> tag with text or image
      const writeBtn = page.locator('a:has-text("글쓰기")');
      await writeBtn.click();

      // Step 2: Retrieve Draft
      // Click "임시저장된 게시글"
      const draftBtn = page.locator('input[value="임시저장된 게시글"], button:has-text("임시저장된 게시글")');
      await draftBtn.click();

      // The drafts appear in a popup or modal. We need to find the specific one.
      // Logic: Find the draft titled `[OTT/멤버십] [SharePlan] 끝까지 관리된 유튜브/코세라 프리미엄 (가입 완료 후 결제)`
      // Select the most recent one.
      await page.waitForSelector('.popup_layer, .modal', { timeout: 5000 }).catch(() => {});
      
      const draftRow = page.locator(`tr:has-text("${REQUIRED_DRAFT_TITLE}")`).first();
      
      if ((await draftRow.count()) === 0) {
        throw new Error('Draft not found');
      }

      // Step 3: Load & Verify
      const loadBtn = draftRow.locator('a:has-text("불러오기"), button:has-text("불러오기")');
      await loadBtn.click();

      // Wait for editor to load
      await page.waitForTimeout(2000);
      
      // Verify required text is in editor body
      // Ppomppu uses a custom editor, often an iframe or a textarea
      const content = await page.content();
      if (!content.includes(REQUIRED_BODY_TEXT)) {
        // Check inside iframes if necessary
        const frames = page.frames();
        let found = false;
        for (const frame of frames) {
          const frameContent = await frame.content();
          if (frameContent.includes(REQUIRED_BODY_TEXT)) {
            found = true;
            break;
          }
        }
        if (!found) throw new Error(`Verification failed: "${REQUIRED_BODY_TEXT}" not found in editor`);
      }

      // Step 4: Categorize
      // Set OTT category dropdown to "유튜브"
      // The selector might be a <select> or a custom dropdown
      const categorySelect = page.locator('select[name="category"], select#category');
      if (await categorySelect.count() > 0) {
        const selected = await categorySelect.selectOption({ label: REQUIRED_CATEGORY_LABEL });
        if (selected.length === 0) {
          throw new Error(`Category selection failed: "${REQUIRED_CATEGORY_LABEL}" option missing`);
        }
      }

      // Step 5: Publish
      const submitBtn = page.locator('input[value="작성완료"], button:has-text("작성완료")');
      if (ENV.DRY_RUN_MODE) {
        console.log('Dry-run mode enabled. Submit click intentionally skipped.');
        return { success: true, message: 'Publication simulated successfully (DRY_RUN_MODE=true)', log };
      }

      await submitBtn.click();
      console.log('Draft loaded, verified, and submitted.');
      return { success: true, message: 'Publication submitted successfully', log };

    } finally {
      await context.close();
    }
  } catch (error: any) {
    console.error('Publisher Error:', error);
    return { success: false, message: error.message, log };
  }
}
