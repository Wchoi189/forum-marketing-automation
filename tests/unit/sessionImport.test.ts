import test from "node:test";
import assert from "node:assert/strict";
import { convertExportedCookies, mergeCookies } from "../../lib/browser/index.js";
import { classifySessionState } from "../../lib/observer/index.js";

test("convertExportedCookies: maps Cookie-Editor fields to Playwright cookies", () => {
  const [persistent, session, strict] = convertExportedCookies([
    { name: "a", value: "1", domain: ".ppomppu.co.kr", path: "/", expirationDate: 2000000000.5, session: false, sameSite: "no_restriction", secure: true },
    { name: "PHPSESSID", value: "s", domain: ".ppomppu.co.kr", path: "/", session: true, sameSite: "unspecified", httpOnly: true },
    { name: "b", value: "2", domain: "www.ppomppu.co.kr", expirationDate: 2000000000, sameSite: "strict" }
  ]);

  assert.deepEqual(persistent, { name: "a", value: "1", domain: ".ppomppu.co.kr", path: "/", expires: 2000000000.5, httpOnly: false, secure: true, sameSite: "None" });
  assert.equal(session.expires, -1);
  assert.equal(session.sameSite, "Lax");
  assert.equal(session.httpOnly, true);
  assert.equal(strict.sameSite, "Strict");
  assert.equal(strict.path, "/");
});

test("convertExportedCookies: accepts a Playwright storage state as-is", () => {
  const cookie = { name: "x", value: "y", domain: "d", path: "/p", expires: -1, httpOnly: false, secure: false, sameSite: "Lax" as const };
  assert.deepEqual(convertExportedCookies({ cookies: [cookie] }), [cookie]);
});

test("convertExportedCookies: rejects malformed input", () => {
  assert.throws(() => convertExportedCookies({ nope: true }), /array of cookies/);
  assert.throws(() => convertExportedCookies([{ name: "x", domain: "d" }]), /Cookie #0/);
});

test("mergeCookies: incoming wins per (name, domain, path); base-only cookies survive; expired dropped", () => {
  const now = 1_800_000_000;
  const base = convertExportedCookies([
    { name: "PHPSESSID", value: "dead", domain: ".ppomppu.co.kr", session: true },
    { name: "cf_clearance", value: "server-ip", domain: ".ppomppu.co.kr", expirationDate: now + 1000 },
    { name: "stale", value: "old", domain: ".ppomppu.co.kr", expirationDate: now - 1 }
  ]);
  const incoming = convertExportedCookies([
    { name: "PHPSESSID", value: "live", domain: ".ppomppu.co.kr", session: true },
    { name: "PHPSESSID", value: "other-host", domain: "www.ppomppu.co.kr", session: true }
  ]);

  const merged = mergeCookies(base, incoming, now);
  const byKey = Object.fromEntries(merged.map((c) => [`${c.name}@${c.domain}`, c.value]));

  assert.deepEqual(byKey, {
    "PHPSESSID@.ppomppu.co.kr": "live",
    "cf_clearance@.ppomppu.co.kr": "server-ip",
    "PHPSESSID@www.ppomppu.co.kr": "other-host"
  });
});

test("mergeCookies: the bot's own cf_clearance beats an imported one", () => {
  const base = convertExportedCookies([{ name: "cf_clearance", value: "server-ip", domain: ".ppomppu.co.kr", session: true }]);
  const incoming = convertExportedCookies([{ name: "cf_clearance", value: "laptop-ip", domain: ".ppomppu.co.kr", session: true }]);
  assert.equal(mergeCookies(base, incoming)[0].value, "server-ip");
  assert.equal(mergeCookies([], incoming)[0].value, "laptop-ip");
});

test("classifySessionState: logout link means logged in, login button alone means logged out", () => {
  assert.equal(classifySessionState(1, 0), "logged_in");
  assert.equal(classifySessionState(1, 1), "logged_in");
  assert.equal(classifySessionState(0, 1), "logged_out");
  assert.equal(classifySessionState(0, 0), "unknown");
});
