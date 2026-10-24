/**
 * tests/unit/sessionState.test.ts
 *
 * SL-001 — the ppomppu session record in runtime state: normalization, the derived
 * 'expiring' status, and the transitions the publisher and import write. The
 * transition tests use the shared store, which scripts/run-tests.sh points at a
 * temp ARTIFACTS_DIR.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  RuntimeStateStore,
  DEFAULT_SESSION_RECORD,
  normalizeSessionRecord,
  deriveSessionStatus,
  sessionView,
  isSessionProbeDue,
  getSessionRecord,
  isSessionParked,
  markSessionVerified,
  markSessionImported,
  markSessionLost,
  readPersistedState,
} from '../../lib/state/index.js';
import type { SessionRecord } from '../../lib/state/index.js';

const HOUR = 3_600_000;
const T0 = Date.parse('2026-10-24T18:41:00.000Z');

function healthy(importedAt: string | null): SessionRecord {
  return { ...DEFAULT_SESSION_RECORD, status: 'healthy', importedAt };
}

test('normalizeSessionRecord: junk resets to unknown and a stored "expiring" is not accepted', () => {
  assert.deepEqual(normalizeSessionRecord(undefined), DEFAULT_SESSION_RECORD);
  assert.deepEqual(normalizeSessionRecord([1, 2]), DEFAULT_SESSION_RECORD);
  const rec = normalizeSessionRecord({ status: 'expiring', importedAt: 'not a date', lostReason: 42 });
  assert.equal(rec.status, 'unknown');
  assert.equal(rec.importedAt, null);
  assert.equal(rec.lostReason, null);
});

test('deriveSessionStatus: healthy turns expiring at lifetime minus warning, not before', () => {
  const rec = healthy(new Date(T0).toISOString());
  assert.equal(deriveSessionStatus(rec, T0 + 143 * HOUR, 168, 24), 'healthy');
  assert.equal(deriveSessionStatus(rec, T0 + 144 * HOUR, 168, 24), 'expiring');
});

test('deriveSessionStatus: no import time, dead and unknown pass through unchanged', () => {
  assert.equal(deriveSessionStatus(healthy(null), T0 + 1000 * HOUR, 168, 24), 'healthy');
  assert.equal(deriveSessionStatus({ ...DEFAULT_SESSION_RECORD, status: 'dead' }, T0, 168, 24), 'dead');
  assert.equal(deriveSessionStatus(DEFAULT_SESSION_RECORD, T0, 168, 24), 'unknown');
});

test('sessionView: derives the status and the expected end from importedAt', () => {
  const view = sessionView(healthy(new Date(T0).toISOString()), T0 + 150 * HOUR, 168);
  assert.equal(view.status, 'expiring');
  assert.equal(view.expectedEndAt, new Date(T0 + 168 * HOUR).toISOString());
  assert.equal(sessionView(DEFAULT_SESSION_RECORD, T0, 168).expectedEndAt, null);
});

test('isSessionProbeDue: never verified or stale is due; fresh or dead is not', () => {
  const verifiedAt = (ms: number): SessionRecord => ({ ...healthy(null), lastVerifiedAt: new Date(ms).toISOString() });
  assert.equal(isSessionProbeDue(DEFAULT_SESSION_RECORD, T0, 6), true);
  assert.equal(isSessionProbeDue(verifiedAt(T0), T0 + 5 * HOUR, 6), false);
  assert.equal(isSessionProbeDue(verifiedAt(T0), T0 + 6 * HOUR, 6), true);
  assert.equal(isSessionProbeDue({ ...DEFAULT_SESSION_RECORD, status: 'dead' }, T0, 6), false);
});

test('RuntimeStateStore: a session patch is normalized and survives as its own copy', () => {
  const store = new RuntimeStateStore(10);
  store.patch({ session: { ...DEFAULT_SESSION_RECORD, status: 'dead', lostReason: 'turnstile_unsolved' } });
  const rec = store.getSessionRecord();
  assert.equal(rec.status, 'dead');
  rec.status = 'healthy';
  assert.equal(store.getSessionRecord().status, 'dead');
});

test('session transitions: lost parks, a repeat loss keeps the first reason, import un-parks', async () => {
  await markSessionImported(new Date(T0));
  assert.equal(isSessionParked(), false);

  await markSessionLost('turnstile_unsolved', new Date(T0 + 7 * 24 * HOUR));
  assert.equal(isSessionParked(), true);
  assert.equal(await markSessionLost('login_rejected'), null);
  const lost = getSessionRecord();
  assert.equal(lost.lostReason, 'turnstile_unsolved');
  assert.equal(lost.importedAt, new Date(T0).toISOString(), 'loss keeps importedAt for lifetime telemetry');

  await markSessionImported(new Date(T0 + 8 * 24 * HOUR));
  const back = getSessionRecord();
  assert.equal(isSessionParked(), false);
  assert.equal(back.lostAt, null);
  assert.equal(back.importedAt, new Date(T0 + 8 * 24 * HOUR).toISOString());

  const onDisk = await readPersistedState();
  assert.equal(onDisk.session?.status, 'healthy');
});

test('session transitions: a run that sees logged_in revives a dead record and keeps importedAt', async () => {
  await markSessionImported(new Date(T0));
  await markSessionLost('turnstile_unsolved');
  await markSessionVerified(new Date(T0 + HOUR));
  const rec = getSessionRecord();
  assert.equal(rec.status, 'healthy');
  assert.equal(rec.lastVerifiedAt, new Date(T0 + HOUR).toISOString());
  assert.equal(rec.importedAt, new Date(T0).toISOString());
  assert.equal(rec.lostReason, null);
});
