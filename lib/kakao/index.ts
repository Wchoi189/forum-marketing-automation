/**
 * lib/kakao/index.ts
 *
 * Barrel export for the KakaoTalk skill module.
 *
 * `db` is exported as a namespace rather than flattened: its function names
 * (ensureReady, isReady, close, getStats, listUsers) are generic enough that
 * spreading them into the module's top level would collide with anything else
 * added here later.
 */

export * as db from './db.js';

export type {
  KakaoUser,
  KakaoBlock,
  KakaoUserRequest,
  KakaoIntent,
  KakaoBot,
  KakaoAction,
  KakaoSkillPayload,
  KakaoMessageEntry,
  KakaoResponse,
} from './skill.js';

export { logKakaoMessage, simpleTextResponse, isValidKakaoPayload } from './skill.js';

export { getAutoReply } from './autoReply.js';
