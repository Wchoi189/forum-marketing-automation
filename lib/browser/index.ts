/**
 * lib/browser/index.ts
 *
 * Barrel export for Chromium lifecycle: the shared browser and its contexts,
 * page-level debug handlers, and the evaluate() name polyfill injected into
 * parser sessions.
 */

export {
  CHROMIUM_LAUNCH_ARGS,
  CACHE_BUST_HEADERS,
  sharedBrowserContextOptions,
  activeContexts,
  isSharedBrowserReady,
  getSharedBrowser,
  initSharedBrowser,
  createBrowserContext,
  closeSharedBrowser,
  saveStorageState,
  shutdownBrowser,
  registerSignalHandlers,
} from './shared.js';

export { registerBrowserDebugHandlers } from './debug.js';

export { BROWSER_EVAL_NAME_POLYFILL_SCRIPT } from './evalPolyfill.js';
