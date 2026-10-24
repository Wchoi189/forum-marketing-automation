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
} from './loginConsole.js';
export type { ConsoleEvent, ConsoleInput, ConsoleState, ConsoleSummary, LoginConsole } from './loginConsole.js';

export { renderConsolePage, renderConsoleRequestPage } from './consolePage.js';
