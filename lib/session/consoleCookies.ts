/**
 * lib/session/consoleCookies.ts
 *
 * Read the login console browser's cookies from its profile on disk, so
 * nothing has to attach to the browser to get them (consoleDesktop.ts).
 *
 * The console launches Chromium with --password-store=basic, which encrypts
 * cookie values with Chromium's fixed Linux fallback key ("v10": AES-128-CBC,
 * key PBKDF2-SHA1("peanuts", "saltysalt", 1 iteration), IV of 16 spaces).
 * Since cookie DB version 24 the plaintext starts with SHA-256(host_key).
 * Chromium flushes the DB about every 30 s, so a login shows up here within
 * that window. Session cookies are stored too (is_persistent = 0).
 */

import { createDecipheriv, pbkdf2Sync } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import type { Cookie } from 'playwright';

const V10_KEY = pbkdf2Sync('peanuts', 'saltysalt', 1, 16, 'sha1');
const IV = Buffer.alloc(16, ' ');
const HOST_HASH_BYTES = 32;
/** Microseconds between 1601-01-01 (Chromium's epoch) and 1970-01-01. */
const CHROMIUM_EPOCH_OFFSET_US = 11_644_473_600_000_000n;
const SAME_SITE: Record<number, Cookie['sameSite']> = { 0: 'None', 1: 'Lax', 2: 'Strict' };

type CookieRow = {
  host_key: string;
  name: string;
  value: string;
  encrypted_value: Buffer;
  path: string;
  expires_utc: bigint;
  has_expires: number;
  is_httponly: number;
  is_secure: number;
  samesite: number;
};

function decrypt(encrypted: Buffer, hostKey: string, dbVersion: number): string | null {
  if (encrypted.subarray(0, 3).toString() !== 'v10') return null;
  try {
    const decipher = createDecipheriv('aes-128-cbc', V10_KEY, IV);
    const plain = Buffer.concat([decipher.update(encrypted.subarray(3)), decipher.final()]);
    return (dbVersion >= 24 ? plain.subarray(HOST_HASH_BYTES) : plain).toString('utf-8');
  } catch {
    return null;
  }
}

/** Cookies in a Chromium profile; empty when the DB is absent or unreadable. */
export function readProfileCookies(profileDir: string): Cookie[] {
  const dbPath = path.join(profileDir, 'Default', 'Cookies');
  if (!fs.existsSync(dbPath)) return [];
  let db: Database.Database | null = null;
  try {
    db = new Database(dbPath, { readonly: true, fileMustExist: true });
    db.defaultSafeIntegers(true);
    const version = Number((db.prepare("SELECT value FROM meta WHERE key = 'version'").get() as { value: string } | undefined)?.value ?? 0);
    const rows = db.prepare(
      'SELECT host_key, name, value, encrypted_value, path, expires_utc, has_expires, is_httponly, is_secure, samesite FROM cookies',
    ).all() as CookieRow[];
    const cookies: Cookie[] = [];
    for (const row of rows) {
      const value = row.value || decrypt(row.encrypted_value, row.host_key, version);
      if (value === null) continue;
      const expiresUs = BigInt(row.expires_utc);
      cookies.push({
        name: row.name,
        value,
        domain: row.host_key,
        path: row.path,
        expires: Number(row.has_expires) && expiresUs > 0n ? Number((expiresUs - CHROMIUM_EPOCH_OFFSET_US) / 1_000_000n) : -1,
        httpOnly: Boolean(Number(row.is_httponly)),
        secure: Boolean(Number(row.is_secure)),
        sameSite: SAME_SITE[Number(row.samesite)] ?? 'Lax',
      });
    }
    return cookies;
  } catch {
    // Chromium may hold a write lock mid-flush; the next poll retries.
    return [];
  } finally {
    db?.close();
  }
}
