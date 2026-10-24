/**
 * tests/unit/sessionHealth.test.ts
 *
 * SL-004/SL-005 — session upkeep: the expiry warning fires once per imported
 * session, and the probe marks the record from what the board header says,
 * dropping its result when an import landed meanwhile. The probe and the death
 * announcement are injected, so no browser or login console starts.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { checkSessionExpiry, probeSavedSession } from '../../lib/session/index.js';
import { getSessionRecord, markSessionImported, markSessionVerified } from '../../lib/state/index.js';

const HOUR = 3_600_000;

function fakeProbe(sessionState: 'logged_in' | 'logged_out' | 'unknown', during?: () => Promise<unknown>) {
  return async () => {
    await during?.();
    return { sessionState, url: 'https://www.ppomppu.co.kr/zboard/zboard.php?id=test' };
  };
}

function recordAnnouncements() {
  const calls: Array<{ reason: string; transitioned: boolean }> = [];
  return { calls, announce: async (reason: string, transitioned: boolean) => { calls.push({ reason, transitioned }); } };
}

test('checkSessionExpiry: silent while healthy, warns once on entering expiring, again for the next import', async () => {
  const importedAt = Date.parse('2026-10-01T00:00:00.000Z');
  await markSessionImported(new Date(importedAt));

  assert.equal(await checkSessionExpiry(importedAt + 100 * HOUR), false);
  assert.equal(await checkSessionExpiry(importedAt + 150 * HOUR), true);
  assert.equal(await checkSessionExpiry(importedAt + 151 * HOUR), false, 'one warning per session, not per tick');

  const next = importedAt + 160 * HOUR;
  await markSessionImported(new Date(next));
  assert.equal(await checkSessionExpiry(next + 150 * HOUR), true);
});

test('probeSavedSession: logged_out marks the session dead and announces the transition once', async () => {
  await markSessionImported();
  const { calls, announce } = recordAnnouncements();

  assert.equal(await probeSavedSession({ probe: fakeProbe('logged_out'), announce }), 'logged_out');
  const rec = getSessionRecord();
  assert.equal(rec.status, 'dead');
  assert.equal(rec.lostReason, 'probe_logged_out');
  assert.deepEqual(calls, [{ reason: 'probe_logged_out', transitioned: true }]);
});

test('probeSavedSession: logged_in refreshes lastVerifiedAt; unknown changes nothing', async () => {
  await markSessionImported(new Date(Date.now() - 10 * HOUR));
  const { calls, announce } = recordAnnouncements();

  await probeSavedSession({ probe: fakeProbe('unknown'), announce });
  const untouched = getSessionRecord();
  assert.equal(untouched.status, 'healthy');
  assert.equal(untouched.lastVerifiedAt, untouched.importedAt);

  await probeSavedSession({ probe: fakeProbe('logged_in'), announce });
  assert.ok(Date.parse(getSessionRecord().lastVerifiedAt!) > Date.parse(untouched.importedAt!));
  assert.equal(calls.length, 0);
});

test('probeSavedSession: an import during the probe wins over a logged_out result', async () => {
  await markSessionVerified();
  const { calls, announce } = recordAnnouncements();

  await probeSavedSession({ probe: fakeProbe('logged_out', () => markSessionImported()), announce });
  assert.equal(getSessionRecord().status, 'healthy', 'stale probe must not kill a fresh import');
  assert.equal(calls.length, 0);
});
