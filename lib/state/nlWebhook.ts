/**
 * lib/state/nlWebhook.ts
 *
 * Persistence for the NL webhook kill-switch.
 * Delegates to RuntimeStateStore.
 */

import type { StateMeta } from './types.js';
import { persistState } from './persistence.js';
import { getRuntimeStateStore } from './store.js';

/**
 * Read the persisted NL webhook enable flag from store authority.
 * Returns null when nothing has been persisted, so callers can fall back to ENV.
 */
export async function readPersistedNlWebhookEnabled(): Promise<boolean | null> {
  const store = getRuntimeStateStore();
  await store.ensureInitialized();
  return store.getNlWebhookEnabled();
}

/**
 * Persist the NL webhook enable flag.
 */
export async function persistNlWebhookEnabled(value: boolean, expectedVersion?: number): Promise<StateMeta> {
  return persistState({ nlWebhookEnabled: value }, expectedVersion);
}
