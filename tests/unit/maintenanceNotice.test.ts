import test from "node:test";
import assert from "node:assert/strict";
import { parseMaintenanceNotice } from "../../lib/observer/index.js";

test("parseMaintenanceNotice: full Korean date & time format with +5m buffer", () => {
  const noticeText = `
    [안내] 시스템 점검 안내
    보다 안정적인 서비스 제공을 위해 정기 점검을 진행합니다.
    일시: 2026년 8월 18일 21:00 ~ 23:00
    점검 중에는 서비스 이용이 제한됩니다.
  `;
  const result = parseMaintenanceNotice(noticeText, "뽐뿌 시스템 점검 안내");

  assert.strictEqual(result.isMaintenance, true);
  assert.ok(result.maintenanceNotice?.includes("점검"));
  assert.strictEqual(result.maintenanceUntil, "2026-08-18T14:05:00.000Z"); // 23:00 KST = 14:00 UTC + 5m
});

test("parseMaintenanceNotice: cross-midnight full date & time range", () => {
  const noticeText = `
    서버 점검 안내: 2026년 8월 18일 23:00 ~ 2026년 8월 19일 03:00
  `;
  const result = parseMaintenanceNotice(noticeText);

  assert.strictEqual(result.isMaintenance, true);
  assert.strictEqual(result.maintenanceUntil, "2026-08-18T18:05:00.000Z"); // 03:00 KST = 18:00 UTC + 5m
});

test("parseMaintenanceNotice: month and day format without year", () => {
  const noticeText = `
    정기 점검 안내
    일정: 8월 18일 21:00 ~ 23:00
  `;
  // Reference date: 2026-08-18 10:00:00 UTC
  const refDate = new Date("2026-08-18T10:00:00.000Z");
  const result = parseMaintenanceNotice(noticeText, "", 0, refDate);

  assert.strictEqual(result.isMaintenance, true);
  assert.strictEqual(result.maintenanceUntil, "2026-08-18T14:05:00.000Z");
});

test("parseMaintenanceNotice: dot and dash date delimiters (2026.08.18 / 2026-08-18)", () => {
  const noticeTextDot = "시스템 점검 안내: 2026.08.18 21:00 ~ 23:00";
  const resultDot = parseMaintenanceNotice(noticeTextDot);
  assert.strictEqual(resultDot.isMaintenance, true);
  assert.strictEqual(resultDot.maintenanceUntil, "2026-08-18T14:05:00.000Z");

  const noticeTextDash = "시스템 점검 안내: 2026-08-18 21:00 ~ 23:00";
  const resultDash = parseMaintenanceNotice(noticeTextDash);
  assert.strictEqual(resultDash.isMaintenance, true);
  assert.strictEqual(resultDash.maintenanceUntil, "2026-08-18T14:05:00.000Z");
});

test("parseMaintenanceNotice: time-only range format (02:00 ~ 06:00)", () => {
  const noticeText = `
    [점검 안내] 02:00 ~ 06:00 동안 데이터베이스 정기점검이 진행됩니다.
  `;
  // Reference date: 2026-08-18 01:00 KST (2026-08-17T16:00:00.000Z)
  const refDate = new Date("2026-08-17T16:00:00.000Z");
  const result = parseMaintenanceNotice(noticeText, "", 0, refDate);

  assert.strictEqual(result.isMaintenance, true);
  // 06:00 KST on 2026-08-18 is 2026-08-17 21:00 UTC. With +5m buffer: 21:05 UTC.
  assert.strictEqual(result.maintenanceUntil, "2026-08-17T21:05:00.000Z");
});

test("parseMaintenanceNotice: overnight time-only range format (23:00 ~ 04:00)", () => {
  const noticeText = `
    서버 점검: 23:00 ~ 04:00
  `;
  // Reference date: 2026-08-18 22:00 KST (2026-08-18T13:00:00.000Z)
  const refDate = new Date("2026-08-18T13:00:00.000Z");
  const result = parseMaintenanceNotice(noticeText, "", 0, refDate);

  assert.strictEqual(result.isMaintenance, true);
  // 04:00 KST on 2026-08-19 is 2026-08-18 19:00 UTC. With +5m buffer: 19:05 UTC.
  assert.strictEqual(result.maintenanceUntil, "2026-08-18T19:05:00.000Z");
});

test("parseMaintenanceNotice: Korean hour phrasing (새벽 2시 ~ 6시)", () => {
  const noticeText = `
    작업 안내: 새벽 2시 ~ 6시 점검 진행
  `;
  // Reference date: 2026-08-18 01:00 KST (2026-08-17T16:00:00.000Z)
  const refDate = new Date("2026-08-17T16:00:00.000Z");
  const result = parseMaintenanceNotice(noticeText, "", 0, refDate);

  assert.strictEqual(result.isMaintenance, true);
  assert.strictEqual(result.maintenanceUntil, "2026-08-17T21:05:00.000Z");
});

test("parseMaintenanceNotice: fallback to 30 minutes when time window is unspecified", () => {
  const noticeText = `
    현재 시스템 점검 중입니다. 잠시 후 다시 접속해 주시기 바랍니다.
  `;
  const refDate = new Date("2026-08-18T12:00:00.000Z");
  const result = parseMaintenanceNotice(noticeText, "", 0, refDate);

  assert.strictEqual(result.isMaintenance, true);
  // Fallback: refDate + 30 minutes
  assert.strictEqual(result.maintenanceUntil, "2026-08-18T12:30:00.000Z");
});

test("parseMaintenanceNotice: recognizes HTTP 503 status code with fallback", () => {
  const result = parseMaintenanceNotice("Service Temporarily Unavailable", "503 Service Unavailable", 503, new Date("2026-08-18T12:00:00.000Z"));

  assert.strictEqual(result.isMaintenance, true);
  assert.strictEqual(result.maintenanceUntil, "2026-08-18T12:30:00.000Z");
});

test("parseMaintenanceNotice: recognizes HTTP 502 and 504 status codes", () => {
  const result502 = parseMaintenanceNotice("", "Bad Gateway", 502, new Date("2026-08-18T12:00:00.000Z"));
  assert.strictEqual(result502.isMaintenance, true);

  const result504 = parseMaintenanceNotice("", "Gateway Timeout", 504, new Date("2026-08-18T12:00:00.000Z"));
  assert.strictEqual(result504.isMaintenance, true);
});

test("parseMaintenanceNotice: normal board page returns isMaintenance: false", () => {
  const normalText = `
    자유게시판 최신글 목록
    10234 | 넷플릭스 공유 파티 구합니다 | 홍길동 | 12:45 | 120
    10233 | 디즈니플러스 연간 구독 후기 | 김철수 | 12:40 | 85
  `;
  const result = parseMaintenanceNotice(normalText, "뽐뿌 자유게시판");

  assert.strictEqual(result.isMaintenance, false);
  assert.strictEqual(result.maintenanceNotice, null);
  assert.strictEqual(result.maintenanceUntil, null);
});
