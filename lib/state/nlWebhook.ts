/**
 * lib/state/nlWebhook.ts
 *
 * Persistence for the NL webhook kill-switch.
 */

import type { StateMeta } from './types.js';
import { persistState, readPersistedState } from './persistence.js';

/**
 * Read the persisted NL webhook enable flag.
 * Returns null when nothing has been persisted, so callers can fall back to ENV.
 */
export async function readPersistedNlWebhookEnabled(): Promise<boolean | null> {
  const data = await readPersistedState();
  if (typeof data.nlWebhookEnabled === 'boolean') return data.nlWebhookEnabled;
  return null;
}

/**
 * Persist the NL webhook enable flag.
 */
export async function persistNlWebhookEnabled(value: boolean, expectedVersion?: number): Promise<StateMeta> {
  return persistState({ nlWebhookEnabled: value }, expectedVersion);
}
