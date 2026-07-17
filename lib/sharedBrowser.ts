import { chromium, type Browser, type BrowserContext, type BrowserContextOptions } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { ENV } from '../config/env.js';
import { logger } from './logger.js';

/**
 * Storage state (login cookies) is persisted to the shared volume so it survives
 * redeploys. BOT_PROFILE_DIR already lives on the persistent volume, so co-locate here.
 */
const STORAGE_STATE_PATH = path.join(ENV.BOT_PROFILE_DIR, 'browser-storage-state.json');

/** Reduces trivial AutomationControlled / headless flags and caps per-process memory. */
export const CHROMIUM_LAUNCH_ARGS = [
  '--disable-blink-features=AutomationControlled',
  '--js-flags=--max-old-space-size=100',  // 100 MB V8 heap
  '--disable-gpu',
  '--disable-dev-shm-usage',  // mandatory on VMs with small /dev/shm (< 64 MB)
  '--disable-disk-cache',     // SAVE NVMe: completely disable disk caching
  '--disable-crash-reporter', // SAVE NVMe: no crashpad dumps
  '--disable-breakpad',       // SAVE NVMe: no crashpad dumps
] as const;

/** Cache-busting headers applied to every browser request. */
export const CACHE_BUST_HEADERS = {
  'Cache-Control': 'no-cache, no-store, must-revalidate',
  'Pragma': 'no-cache',
  'Expires': '0',
};

/** Browser context options with anti-detection headers and locale settings. */
export function sharedBrowserContextOptions(): BrowserContextOptions {
  return {
    userAgent: ENV.BROWSER_USER_AGENT,
    locale: 'ko-KR',
    timezoneId: 'Asia/Seoul',
    viewport: { width: 1280, height: 800 },
    extraHTTPHeaders: {
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
      'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
      'Sec-Ch-Ua': '"Google Chrome";v="146", "Chromium";v="146", "Not/A)Brand";v="24"',
      'Sec-Ch-Ua-Mobile': '?0',
      'Sec-Ch-Ua-Platform': '"Windows"',
      ...CACHE_BUST_HEADERS,
    },
  };
}

/** Persistent shared browser — one Chromium for the lifetime of the server. */
let sharedBrowser: Browser | null = null;

/** All currently-active contexts (observer + publisher) for safe shutdown. */
export const activeContexts = new Set<BrowserContext>();

/** Counter tracking browser contexts created to trigger periodic process recycling. */
let contextCreationsCount = 0;
const RECYCLE_THRESHOLD = 15;

/** True after initSharedBrowser() resolves — callers can check synchronously. */
export function isSharedBrowserReady(): boolean {
  return sharedBrowser !== null;
}

/** Get the shared browser. Must be called after initSharedBrowser() resolves. */
export function getSharedBrowser(): Browser {
  if (!sharedBrowser) {
    throw new Error('[SharedBrowser] Browser not initialized — call initSharedBrowser() first');
  }
  return sharedBrowser;
}

/** Launch the shared Chromium. Call once during server startup. */
export async function initSharedBrowser(): Promise<Browser> {
  if (sharedBrowser) return sharedBrowser;
  sharedBrowser = await chromium.launch({
    headless: ENV.BROWSER_HEADLESS,
    args: [...CHROMIUM_LAUNCH_ARGS],
  });

  logger.info(
    { event: 'shared_browser.started' },
    '[SharedBrowser] Launched'
  );

  return sharedBrowser;
}

/** Create a new browser context from the shared browser. */
export async function createBrowserContext(options?: { loadSavedStorageState: boolean }): Promise<BrowserContext> {
  // If the browser was closed/recycled, or not yet initialized, spin it up
  if (!sharedBrowser) {
    await initSharedBrowser();
  } else if (activeContexts.size === 0 && contextCreationsCount >= RECYCLE_THRESHOLD) {
    logger.info(
      { event: 'shared_browser.recycling', contextCreationsCount },
      `[SharedBrowser] Recycling shared browser after ${contextCreationsCount} contexts to reclaim memory`
    );
    await closeSharedBrowser();
    await initSharedBrowser();
    contextCreationsCount = 0;
  }

  contextCreationsCount++;

  const browser = getSharedBrowser();
  const opts = sharedBrowserContextOptions();

  if (options?.loadSavedStorageState) {
    try {
      const raw = fs.readFileSync(STORAGE_STATE_PATH, 'utf-8');
      const state = JSON.parse(raw) as { cookies?: unknown; origins?: unknown };
      if (state.cookies) opts.storageState = { cookies: state.cookies as any, origins: [] };
    } catch {
      // No saved state — first run
    }
  }

  const context = await browser.newContext(opts);
  activeContexts.add(context);
  context.on('close', () => activeContexts.delete(context));
  return context;
}

/** Close the shared browser and all active contexts. */
export async function closeSharedBrowser(): Promise<void> {
  if (!sharedBrowser) return;

  const contexts = [...activeContexts];
  for (const ctx of contexts) {
    try {
      await ctx.close();
    } catch {
      /* context already closed */
    }
  }
  activeContexts.clear();

  logger.info(
    { event: 'shared_browser.closed' },
    '[SharedBrowser] Closed'
  );

  await sharedBrowser.close();
  sharedBrowser = null;
}

/**
 * Save cookies from a context for reuse by the next context.
 * Called after a publisher run so login session survives context recreation.
 */
export async function saveStorageState(context: BrowserContext): Promise<void> {
  try {
    const cookies = await context.cookies();
    const state = JSON.stringify({ cookies }, null, 2);
    fs.writeFileSync(STORAGE_STATE_PATH, state, 'utf-8');
    logger.debug({ event: 'shared_browser.storage_saved', cookieCount: cookies.length }, '[SharedBrowser] Storage state saved');
  } catch (err) {
    logger.warn({ event: 'shared_browser.save_error', err }, '[SharedBrowser] Failed to save storage state');
  }
}
