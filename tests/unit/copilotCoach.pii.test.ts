import test from "node:test";
import assert from "node:assert/strict";
import { scrubContext } from "../../lib/piiScrubber.js";

// ── Pass 1 regex tests ────────────────────────────────────────────────────────

test("scrubs Korean bank account numbers (dash-formatted)", () => {
  // 3-2-6 format — clear of phone prefix so only bank regex fires
  assert.equal(
    scrubContext("입금 계좌: 001-23-456789 입니다"),
    "입금 계좌: [ACCOUNT] 입니다"
  );
});

test("scrubs IBK-style account via keyword trigger (기업은행)", () => {
  // Bare 14-digit number is caught by pass-2 when bank keyword is present
  const raw = "기업은행 43414622001010";
  const scrubbed = scrubContext(raw);
  assert.ok(scrubbed.includes("[ACCOUNT]"), `expected [ACCOUNT] in: ${scrubbed}`);
});

test("scrubs Korean phone numbers (010 dash format)", () => {
  assert.equal(
    scrubContext("연락처: 010-1234-5678"),
    "연락처: [PHONE]"
  );
});

test("scrubs Korean phone numbers (no dashes)", () => {
  const result = scrubContext("번호: 01012345678");
  assert.ok(result.includes("[PHONE]"), `expected [PHONE] in: ${result}`);
});

test("scrubs email addresses", () => {
  assert.equal(
    scrubContext("이메일: user@example.com 로 보내주세요"),
    "이메일: [EMAIL] 로 보내주세요"
  );
});

test("scrubs Gmail addresses", () => {
  assert.equal(
    scrubContext("wchoi189@gmail.com"),
    "[EMAIL]"
  );
});

test("scrubs resident registration number partial (주민번호)", () => {
  assert.equal(
    scrubContext("생년월일: 900101-1234567"),
    "생년월일: [RRN]"
  );
});

// ── Pass 2 keyword-triggered tests ───────────────────────────────────────────

test("scrubs space-separated account when 계좌 keyword present", () => {
  const result = scrubContext("계좌번호는 4341 4622 0010 10 입니다");
  assert.ok(result.includes("[ACCOUNT]"), `expected [ACCOUNT] in: ${result}`);
});

test("scrubs dot-separated phone when 번호 keyword present", () => {
  const result = scrubContext("전화번호 010.1234.5678 입니다");
  assert.ok(result.includes("[PHONE]"), `expected [PHONE] in: ${result}`);
});

// ── Clean text unchanged ──────────────────────────────────────────────────────

test("leaves clean text unchanged", () => {
  const clean = "안녕하세요! 유튜브 프리미엄 6개월 가입 문의드립니다.";
  assert.equal(scrubContext(clean), clean);
});

// ── Multiple PII in one string ────────────────────────────────────────────────

test("scrubs multiple PII types in one message", () => {
  const raw = "이메일 test@kakao.com 이고 연락처는 010-9876-5432 입니다";
  const result = scrubContext(raw);
  assert.ok(result.includes("[EMAIL]"), `expected [EMAIL] in: ${result}`);
  assert.ok(result.includes("[PHONE]"), `expected [PHONE] in: ${result}`);
  assert.ok(!result.includes("test@kakao.com"), "email should be scrubbed");
  assert.ok(!result.includes("010-9876-5432"), "phone should be scrubbed");
});
