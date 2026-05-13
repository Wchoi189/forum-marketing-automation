/**
 * routes/api/kakao.ts
 *
 * Kakao Open Builder webhook and dashboard routes:
 *   POST /kakao-webhook
 *   GET  /api/kakao/status
 *   POST /api/kakao/reconnect
 *   POST /api/kakao/control
 *   GET  /api/kakao/logs
 *   GET  /api/kakao/kb-export
 *   GET  /api/kakao/db-stats
 *   GET  /api/kakao/users
 */

import { Router } from 'express';
import path from 'path';
import fs from 'fs';
import { ENV } from '../../config/env.js';
import { logger } from '../../lib/logger.js';
import { isValidKakaoPayload, logKakaoMessage, simpleTextResponse as kakaoSimpleText } from '../../lib/kakaoSkill.js';
import { getAutoReply as kakaoGetAutoReply } from '../../lib/kakaoAutoReply.js';
import * as kakaoDb from '../../lib/kakaoDb.js';

export function createKakaoRouter(): Router {
  const router = Router();

  // ── POST /kakao-webhook ─────────────────────────────────────────────────────
  router.post('/kakao-webhook', async (req, res) => {
    if (!ENV.KAKAO_WEBHOOK_ENABLED) { res.status(503).json({ error: 'kakao_webhook_disabled' }); return; }
    if (!isValidKakaoPayload(req.body)) {
      logger.warn({ event: 'kakao_payload_invalid' }, '[Kakao] Rejected malformed payload');
      res.status(400).json({ error: 'invalid_payload' }); return;
    }
    if (ENV.KAKAO_OPENBUILDER_BOT_ID && req.body.bot.id !== ENV.KAKAO_OPENBUILDER_BOT_ID) {
      logger.warn({ event: 'kakao_bot_id_mismatch', received: req.body.bot.id }, '[Kakao] Bot ID mismatch — rejected');
      res.status(403).json({ error: 'bot_id_mismatch' }); return;
    }
    logKakaoMessage(req.body);
    setImmediate(() => { kakaoDb.logInbound(req.body).catch((err) => logger.warn({ event: 'kakao_db_inbound_error', err }, '[KakaoDb] Failed to log inbound')); });
    const reply = await kakaoGetAutoReply(req.body.userRequest.utterance);
    const outboundText = reply ?? '메시지를 받았습니다.';
    const outboundPayload = kakaoSimpleText(outboundText);
    setImmediate(() => { kakaoDb.logOutbound(req.body.userRequest.user.id, outboundText, outboundPayload).catch((err) => logger.warn({ event: 'kakao_db_outbound_error', err }, '[KakaoDb] Failed to log outbound')); });
    res.status(200).json(outboundPayload);
  });

  // ── GET /api/kakao/status ───────────────────────────────────────────────────
  router.get('/api/kakao/status', async (_req, res) => {
    const today = new Date().toISOString().slice(0, 10);
    const logPath = path.join('artifacts', 'kakao-history', `${today}.jsonl`);
    let todayLogCount = 0;
    try {
      const content = await fs.promises.readFile(logPath, 'utf-8');
      const trimmed = content.trim();
      if (trimmed) todayLogCount = trimmed.split('\n').length;
    } catch { /* file doesn't exist yet */ }
    res.json({ webhookEnabled: ENV.KAKAO_WEBHOOK_ENABLED, autoreplyEnabled: ENV.KAKAO_AUTOREPLY_ENABLED, openaiKeyPresent: !!ENV.OPENAI_API_KEY, todayLogCount, webhookUrl: 'https://tortile-edmund-overboastful.ngrok-free.dev/kakao-webhook', dbConnected: kakaoDb.isReady() });
  });

  // ── POST /api/kakao/reconnect ───────────────────────────────────────────────
  router.post('/api/kakao/reconnect', async (_req, res) => {
    try {
      await kakaoDb.ensureReady();
      res.json({ connected: kakaoDb.isReady() });
    } catch (err) {
      logger.warn({ event: 'kakao_db_reconnect_failed', err }, '[KakaoDB] Reconnect failed');
      res.status(503).json({ connected: false, error: 'reconnect_failed' });
    }
  });

  // ── POST /api/kakao/control ─────────────────────────────────────────────────
  router.post('/api/kakao/control', (req, res) => {
    const { webhookEnabled, autoreplyEnabled } = req.body as { webhookEnabled?: boolean; autoreplyEnabled?: boolean };
    if (typeof webhookEnabled === 'boolean') ENV.KAKAO_WEBHOOK_ENABLED = webhookEnabled;
    if (typeof autoreplyEnabled === 'boolean') ENV.KAKAO_AUTOREPLY_ENABLED = autoreplyEnabled;
    logger.info({ event: 'kakao_control_updated', webhookEnabled: ENV.KAKAO_WEBHOOK_ENABLED, autoreplyEnabled: ENV.KAKAO_AUTOREPLY_ENABLED }, '[Kakao] Runtime controls updated');
    res.json({ webhookEnabled: ENV.KAKAO_WEBHOOK_ENABLED, autoreplyEnabled: ENV.KAKAO_AUTOREPLY_ENABLED });
  });

  // ── GET /api/kakao/logs ─────────────────────────────────────────────────────
  router.get('/api/kakao/logs', async (req, res) => {
    const limit = parsePositiveIntQuery(req.query.limit, 100, 1, 500);
    const today = new Date().toISOString().slice(0, 10);
    const logPath = path.join('artifacts', 'kakao-history', `${today}.jsonl`);
    let content: string;
    try { content = await fs.promises.readFile(logPath, 'utf-8'); }
    catch { res.json([]); return; }
    const lines = content.trim().split('\n').filter(Boolean);
    const entries = lines.map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean).reverse().slice(0, limit);
    res.json(entries);
  });

  // ── GET /api/kakao/kb-export ────────────────────────────────────────────────
  router.get('/api/kakao/kb-export', (_req, res) => {
    const xlsxPath = path.join('data', 'kakao-kb', 'knowledge-base-import.xlsx');
    if (!fs.existsSync(xlsxPath)) { res.status(404).json({ error: 'KB export not found — run: npm run kakao:kb-export' }); return; }
    res.download(xlsxPath, 'knowledge-base-import.xlsx');
  });

  // ── GET /api/kakao/db-stats ─────────────────────────────────────────────────
  router.get('/api/kakao/db-stats', async (_req, res) => {
    try { res.json(await kakaoDb.getStats()); }
    catch (err) { logger.error({ event: 'kakao_db_stats_error', err }, '[KakaoDb] Stats query failed'); res.status(500).json({ error: 'db_stats_failed' }); }
  });

  // ── GET /api/kakao/users ────────────────────────────────────────────────────
  router.get('/api/kakao/users', async (_req, res) => {
    if (!ENV.KAKAO_DB_ENABLED) { res.status(503).json({ error: 'kakao_db_required' }); return; }
    try { res.json(await kakaoDb.listUsers(50)); }
    catch (err) { logger.error({ event: 'kakao_users_error', err }, '[KakaoDb] Users query failed'); res.status(500).json({ error: 'users_query_failed' }); }
  });

  return router;
}

function parsePositiveIntQuery(raw: unknown, fallback: number, min: number, max: number): number {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}
