import test from "node:test";
import assert from "node:assert/strict";
import { createCipheriv, createHash, pbkdf2Sync } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { readProfileCookies } from "../../lib/session/index.ts";

// Chromium's Linux fallback ("basic" password store) encryption, as the console browser writes it.
function encryptV10(value: string, hostKey: string): Buffer {
  const cipher = createCipheriv("aes-128-cbc", pbkdf2Sync("peanuts", "saltysalt", 1, 16, "sha1"), Buffer.alloc(16, " "));
  const plain = Buffer.concat([createHash("sha256").update(hostKey).digest(), Buffer.from(value)]);
  return Buffer.concat([Buffer.from("v10"), cipher.update(plain), cipher.final()]);
}

function makeProfile(rows: Array<{ host: string; name: string; value: string; expiresUtc: bigint; httpOnly: number; sameSite: number }>): string {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "console-cookies-"));
  fs.mkdirSync(path.join(profile, "Default"));
  const db = new Database(path.join(profile, "Default", "Cookies"));
  db.exec(`CREATE TABLE meta (key TEXT, value TEXT);
    INSERT INTO meta VALUES ('version', '24');
    CREATE TABLE cookies (host_key TEXT, name TEXT, value TEXT, encrypted_value BLOB, path TEXT, expires_utc INTEGER,
      has_expires INTEGER, is_httponly INTEGER, is_secure INTEGER, samesite INTEGER, is_persistent INTEGER);`);
  const insert = db.prepare("INSERT INTO cookies VALUES (?, ?, '', ?, '/', ?, ?, ?, 1, ?, ?)");
  for (const r of rows) {
    insert.run(r.host, r.name, encryptV10(r.value, r.host), r.expiresUtc, r.expiresUtc > 0n ? 1 : 0, r.httpOnly, r.sameSite, r.expiresUtc > 0n ? 1 : 0);
  }
  db.close();
  return profile;
}

test("readProfileCookies: decrypts v10 values and maps Chromium fields to Playwright cookies", () => {
  // 2026-11-01T00:00:00Z in microseconds since 1601-01-01.
  const expiresUtc = (BigInt(Date.UTC(2026, 10, 1)) * 1000n) + 11_644_473_600_000_000n;
  const profile = makeProfile([
    { host: ".ppomppu.co.kr", name: "PHPSESSID", value: "abc123", expiresUtc: 0n, httpOnly: 0, sameSite: -1 },
    { host: ".ppomppu.co.kr", name: "pmn", value: "member", expiresUtc, httpOnly: 1, sameSite: 1 },
  ]);
  try {
    const cookies = readProfileCookies(profile);
    assert.deepEqual(cookies, [
      { name: "PHPSESSID", value: "abc123", domain: ".ppomppu.co.kr", path: "/", expires: -1, httpOnly: false, secure: true, sameSite: "Lax" },
      { name: "pmn", value: "member", domain: ".ppomppu.co.kr", path: "/", expires: Date.UTC(2026, 10, 1) / 1000, httpOnly: true, secure: true, sameSite: "Lax" },
    ]);
  } finally {
    fs.rmSync(profile, { recursive: true, force: true });
  }
});

test("readProfileCookies: a missing profile reads as no cookies", () => {
  assert.deepEqual(readProfileCookies(path.join(os.tmpdir(), "no-such-console-profile")), []);
});
