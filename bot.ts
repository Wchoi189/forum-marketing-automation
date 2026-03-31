import { chromium } from 'playwright';
import fs from 'fs/promises';
import type { ActivityLog } from './contracts/models.js';
import { ENV } from './config/env.js';

const BOARD_URL = 'https://www.ppomppu.co.kr/zboard/zboard.php?id=gonggu';
const USER_DATA_DIR = ENV.BOT_PROFILE_DIR;
const LOG_FILE = ENV.ACTIVITY_LOG_PATH;
const GAP_THRESHOLD = ENV.OBSERVER_GAP_THRESHOLD;

export async function getLogs(): Promise<ActivityLog[]> {
  try {
    const data = await fs.readFile(LOG_FILE, 'utf-8');
    return JSON.parse(data);
  } catch (e) {
    return [];
  }
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

    // Scrape the board
    // The table structure: tr with class like 'list0' or 'list1'
    // We need to find the first 'SharePlan' author
    const rows = await page.$$eval('tr.list0, tr.list1', (trs) => {
      return trs.map(tr => {
        const titleEl = tr.querySelector('td.list_title');
        const authorEl = tr.querySelector('td.list_name');
        const dateEl = tr.querySelector('td.eng.list_date');
        const viewsEl = tr.querySelector('td.eng.list_hit');
        
        return {
          title: titleEl?.textContent?.trim() || '',
          author: authorEl?.textContent?.trim() || '',
          date: dateEl?.textContent?.trim() || '',
          views: parseInt(viewsEl?.textContent?.trim() || '0', 10),
          isNotice: tr.querySelector('img[src*="notice"]') !== null
        };
      });
    });

    const nonNoticeRows = rows.filter(r => !r.isNotice);
    const sharePlanIndex = nonNoticeRows.findIndex(r => r.author.toLowerCase().includes('shareplan'));

    let gap = 0;
    let competitors: string[] = [];
    let lastPost: any = null;

    if (sharePlanIndex === -1) {
      // If not found, assume safe but gap is large
      gap = nonNoticeRows.length;
      competitors = nonNoticeRows.slice(0, 5).map(r => r.author);
    } else {
      gap = sharePlanIndex;
      competitors = nonNoticeRows.slice(0, sharePlanIndex).map(r => r.author);
      lastPost = nonNoticeRows[sharePlanIndex];
    }

    const status = gap >= GAP_THRESHOLD ? 'safe' : 'unsafe';
    
    const log: ActivityLog = {
      timestamp: new Date().toISOString(),
      current_gap_count: gap,
      last_post_timestamp: lastPost?.date || 'N/A',
      top_competitor_names: competitors,
      view_count_of_last_post: lastPost?.views || 0,
      status,
      all_posts: nonNoticeRows
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

    if (!force && log.status !== 'safe') {
      console.log('Gap is too small. Skipping publication.');
      return { success: false, message: 'Gap is too small', log };
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
      
      const draftTitle = '[OTT/멤버십] [SharePlan] 끝까지 관리된 유튜브/코세라 프리미엄 (가입 완료 후 결제)';
      const draftRow = page.locator(`tr:has-text("${draftTitle}")`).first();
      
      if (await draftRow.count() === 0) {
        throw new Error('Draft not found');
      }

      // Step 3: Load & Verify
      const loadBtn = draftRow.locator('a:has-text("불러오기"), button:has-text("불러오기")');
      await loadBtn.click();

      // Wait for editor to load
      await page.waitForTimeout(2000);
      
      // Verify "회원 모집 안내" is in the editor body
      // Ppomppu uses a custom editor, often an iframe or a textarea
      const content = await page.content();
      if (!content.includes('회원 모집 안내')) {
         // Check inside iframes if necessary
         const frames = page.frames();
         let found = false;
         for (const frame of frames) {
           const frameContent = await frame.content();
           if (frameContent.includes('회원 모집 안내')) {
             found = true;
             break;
           }
         }
         if (!found) throw new Error('Verification failed: "회원 모집 안내" not found in editor');
      }

      // Step 4: Categorize
      // Set OTT category dropdown to "유튜브"
      // The selector might be a <select> or a custom dropdown
      const categorySelect = page.locator('select[name="category"], select#category');
      if (await categorySelect.count() > 0) {
        await categorySelect.selectOption({ label: '유튜브' });
      }

      // Step 5: Publish
      const submitBtn = page.locator('input[value="작성완료"], button:has-text("작성완료")');
      // await submitBtn.click(); // UNCOMMENT THIS FOR REAL ACTION
      console.log('Draft loaded and verified. Ready to publish.');

      return { success: true, message: 'Publication simulated successfully (Submit button not clicked for safety)', log };

    } finally {
      await context.close();
    }
  } catch (error: any) {
    console.error('Publisher Error:', error);
    return { success: false, message: error.message, log };
  }
}
