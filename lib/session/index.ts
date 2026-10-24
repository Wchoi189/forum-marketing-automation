/**
 * lib/session/index.ts
 *
 * ppomppu login session recovery: the remote login console that lets a person
 * restore an expired session from any device (KE-004).
 */

export {
  openLoginConsole,
  findLoginConsole,
  CONSOLE_TTL_MS,
  AUTO_CONSOLE_INTERVAL_MS,
  CONSOLE_IMPORT_SOURCE,
} from './loginConsole.js';
export type { ConsoleEvent, ConsoleState, ConsoleSummary, LoginConsole } from './loginConsole.js';

export { renderConsolePage, renderConsoleRequestPage } from './consolePage.js';
export { attachConsoleVncBridge } from './vncBridge.js';
export { loadNovncBundle } from './novncBundle.js';
export { importSession, type ImportOutcome } from './importSession.js';
export { readProfileCookies } from './consoleCookies.js';
