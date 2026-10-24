/**
 * lib/state/session.ts
 *
 * The ppomppu login session as managed state (SL-001).
 *
 * The bot cannot log itself in (KE-004), so the session is a resource a person
 * refreshes and the bot only observes: the publisher marks it verified or dead,
 * an import marks it healthy, and the scheduler parks while it is dead (SL-002).
 * 'expiring' is derived from importedAt, never stored.
 */

import { ENV } from '../../config/env.js';
import type { SessionRecord, SessionStatus, StateMeta } from './types.js';
import { persistState } from './persistence.js';
import { getRuntimeStateStore } from './store.js';

const STORED_STATUSES: ReadonlySet<string> = new Set(['unknown', 'healthy', 'dead']);

export const DEFAULT_SESSION_RECORD: SessionRecord = {
  status: 'unknown',
  importedAt: null,
  lastVerifiedAt: null,
  lostAt: null,
  lostReason: null,
};

function isoOrNull(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const t = Date.parse(value);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

/** Coerce a persisted or patched value into a valid record; unknown shapes reset to the default. */
export function normalizeSessionRecord(value: unknown): SessionRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { ...DEFAULT_SESSION_RECORD };
  const raw = value as Record<string, unknown>;
  return {
    status: typeof raw.status === 'string' && STORED_STATUSES.has(raw.status)
      ? (raw.status as SessionRecord['status'])
      : 'unknown',
    importedAt: isoOrNull(raw.importedAt),
    lastVerifiedAt: isoOrNull(raw.lastVerifiedAt),
    lostAt: isoOrNull(raw.lostAt),
    lostReason: typeof raw.lostReason === 'string' ? raw.lostReason.slice(0, 200) : null,
  };
}

/**
 * Status with 'expiring' derived: a healthy session whose import is older than the
 * expected lifetime minus the warning window. Pure; the caller supplies the clock.
 */
export function deriveSessionStatus(
  record: SessionRecord,
  now: number,
  lifetimeHours: number = ENV.SESSION_EXPECTED_LIFETIME_HOURS,
  warningHours: number = ENV.SESSION_EXPIRY_WARNING_HOURS
): SessionStatus {
  if (record.status !== 'healthy' || !record.importedAt) return record.status;
  const ageMs = now - Date.parse(record.importedAt);
  return ageMs >= (lifetimeHours - warningHours) * 3_600_000 ? 'expiring' : 'healthy';
}

export function getSessionRecord(): SessionRecord {
  return getRuntimeStateStore().getSessionRecord();
}

/** True while the session is known dead: the scheduler launches nothing until an import. */
export function isSessionParked(): boolean {
  return getSessionRecord().status === 'dead';
}

async function writeSession(next: SessionRecord): Promise<StateMeta> {
  return persistState({ session: next });
}

/** A publisher run saw the board logged in. Revives a dead record: the run itself verified it. */
export async function markSessionVerified(at: Date = new Date()): Promise<StateMeta> {
  const current = getSessionRecord();
  return writeSession({
    ...current,
    status: 'healthy',
    lastVerifiedAt: at.toISOString(),
    lostAt: null,
    lostReason: null,
  });
}

/** A person's login was verified by the bot's own browser and saved. Un-parks the scheduler. */
export async function markSessionImported(at: Date = new Date()): Promise<StateMeta> {
  const iso = at.toISOString();
  return writeSession({ status: 'healthy', importedAt: iso, lastVerifiedAt: iso, lostAt: null, lostReason: null });
}

/** The publisher threw PUBLISHER_LOGIN_REQUIRED. The first loss wins; repeats keep its time and reason. */
export async function markSessionLost(reason: string, at: Date = new Date()): Promise<StateMeta | null> {
  const current = getSessionRecord();
  if (current.status === 'dead') return null;
  return writeSession({ ...current, status: 'dead', lostAt: at.toISOString(), lostReason: reason });
}
