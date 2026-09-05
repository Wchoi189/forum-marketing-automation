import test from 'node:test';
import assert from 'node:assert/strict';
import { RuntimeStateStore, StateVersionConflictError } from '../../lib/state/index.js';

test('RuntimeStateStore: initializes with default state and version 0', () => {
  const store = new RuntimeStateStore(10);
  const state = store.getState();
  assert.equal(state.stateVersion, 0);
  assert.equal(state.persistedAt, null);
  assert.equal(state.observerEnabled, true);
  assert.equal(state.schedulerEnabled, true);
  assert.equal(state.nlWebhookEnabled, true);
});

test('RuntimeStateStore: patch increments stateVersion and updates in-memory state', () => {
  const store = new RuntimeStateStore(10);
  const meta = store.patch({ observerEnabled: false });

  assert.equal(meta.stateVersion, 1);
  assert.ok(meta.persistedAt);
  assert.equal(store.getObserverControls().enabled, false);
});

test('RuntimeStateStore: enforces expectedVersion and throws StateVersionConflictError', () => {
  const store = new RuntimeStateStore(10);
  store.patch({ observerEnabled: false }); // version -> 1

  // Providing stale version 0 should throw
  assert.throws(
    () => store.patch({ observerEnabled: true }, 0),
    (err: unknown) => {
      assert.ok(err instanceof StateVersionConflictError);
      assert.equal((err as StateVersionConflictError).expectedVersion, 0);
      assert.equal((err as StateVersionConflictError).currentVersion, 1);
      return true;
    }
  );

  // Providing correct version 1 succeeds
  const meta2 = store.patch({ observerEnabled: true }, 1);
  assert.equal(meta2.stateVersion, 2);
  assert.equal(store.getObserverControls().enabled, true);
});

test('RuntimeStateStore: listeners receive updates synchronously on patch', () => {
  const store = new RuntimeStateStore(10);
  let notified = false;
  let receivedVersion = 0;

  const unsubscribe = store.subscribe((state, patch) => {
    notified = true;
    receivedVersion = state.stateVersion;
    assert.equal(patch.schedulerBaseIntervalMinutes, 45);
  });

  store.patch({ schedulerBaseIntervalMinutes: 45 });
  assert.equal(notified, true);
  assert.equal(receivedVersion, 1);

  unsubscribe();
  notified = false;
  store.patch({ schedulerBaseIntervalMinutes: 30 });
  assert.equal(notified, false);
});

test('RuntimeStateStore: in-memory fast setters update getters immediately without version increment', () => {
  const store = new RuntimeStateStore(10);
  assert.equal(store.getStateMeta().stateVersion, 0);

  store.setPublisherControlsInMemory({ draftItemIndex: 5, publishBlockedUntil: '2026-09-04T12:00:00Z' });
  const pub = store.getPublisherControls();
  assert.equal(pub.draftItemIndex, 5);
  assert.equal(pub.publishBlockedUntil, '2026-09-04T12:00:00Z');
  assert.equal(store.getStateMeta().stateVersion, 0);
});
