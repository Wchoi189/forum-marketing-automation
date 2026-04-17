import test from 'node:test';
import assert from 'node:assert/strict';
import {
  decideControlPanelSync,
  decideSequencedResponse,
  reconcileControlPanelState,
  type ControlPanelSyncTracker
} from '../../src/hooks/controlPanelSync.ts';
import {
  DEFAULT_CONTROL_PANEL,
  type ControlPanelState
} from '../../src/lib/controlPanel.ts';

type ControlPanelStateOverrides = Omit<Partial<ControlPanelState>, 'observer' | 'publisher' | 'autoPublisher'> & {
  observer?: Partial<ControlPanelState['observer']>;
  publisher?: Partial<ControlPanelState['publisher']>;
  autoPublisher?: Partial<ControlPanelState['autoPublisher']>;
};

function makeState(overrides: ControlPanelStateOverrides = {}): ControlPanelState {
  return {
    ...DEFAULT_CONTROL_PANEL,
    ...overrides,
    observer: {
      ...DEFAULT_CONTROL_PANEL.observer,
      ...overrides.observer
    },
    publisher: {
      ...DEFAULT_CONTROL_PANEL.publisher,
      ...overrides.publisher
    },
    autoPublisher: {
      ...DEFAULT_CONTROL_PANEL.autoPublisher,
      ...overrides.autoPublisher
    }
  };
}

test('T-001: reject lower stateVersion even when requestSeq is newer', () => {
  const tracker: ControlPanelSyncTracker = {
    highestVersionSeen: 7,
    appliedRequestSeq: 12
  };

  const decision = decideControlPanelSync(tracker, 6, {
    requestSeq: 20,
    latestRequestedSeq: 20
  });

  assert.equal(decision.accepted, false);
  assert.deepEqual(decision.tracker, tracker);
});

test('T-002: reject older request sequence for equal stateVersion', () => {
  const tracker: ControlPanelSyncTracker = {
    highestVersionSeen: 7,
    appliedRequestSeq: 12
  };

  const decision = decideControlPanelSync(tracker, 7, {
    requestSeq: 11,
    latestRequestedSeq: 20
  });

  assert.equal(decision.accepted, false);
  assert.deepEqual(decision.tracker, tracker);
});

test('T-003: accept higher stateVersion regardless of lower request sequence', () => {
  const tracker: ControlPanelSyncTracker = {
    highestVersionSeen: 7,
    appliedRequestSeq: 12
  };

  const decision = decideControlPanelSync(tracker, 8, {
    requestSeq: 10,
    latestRequestedSeq: 20
  });

  assert.equal(decision.accepted, true);
  assert.deepEqual(decision.tracker, {
    highestVersionSeen: 8,
    appliedRequestSeq: 10
  });
});

test('T-004: mutation response without requestSeq is authoritative and pins latest requested seq', () => {
  const tracker: ControlPanelSyncTracker = {
    highestVersionSeen: 8,
    appliedRequestSeq: 10
  };

  const decision = decideControlPanelSync(tracker, 8, {
    latestRequestedSeq: 30
  });

  assert.equal(decision.accepted, true);
  assert.deepEqual(decision.tracker, {
    highestVersionSeen: 8,
    appliedRequestSeq: 30
  });
});

test('T-005: reconcileControlPanelState preserves editable fields but refreshes authoritative metadata', () => {
  const current = makeState({
    stateVersion: 3,
    persistedAt: '2026-04-17T01:00:00.000Z',
    preset: 'night-safe',
    nlWebhookEnabled: false,
    observer: {
      enabled: false,
      minPreVisitDelayMs: 1111,
      maxPreVisitDelayMs: 2222,
      minIntervalBetweenRunsMs: 3333,
      gapThresholdMin: 5,
      gapPersistedOverride: 9,
      gapThresholdSpecBaseline: 5,
      gapUsesEnvOverride: false,
      gapSource: 'spec',
      gapSourcePin: 'spec'
    },
    publisher: {
      draftItemIndex: 6
    },
    autoPublisher: {
      enabled: false,
      baseIntervalMinutes: 99,
      effectiveIntervalMinutes: 99,
      quietHoursStart: 1,
      quietHoursEnd: 2,
      quietHoursMultiplier: 2,
      activeHoursStart: 7,
      activeHoursEnd: 20,
      activeHoursMultiplier: 0.7,
      trendAdaptiveEnabled: false,
      trendWindowDays: 3,
      trendRecalibrationDays: 4,
      scheduleJitterPercent: 0,
      scheduleJitterMode: 'none',
      targetPublishIntervalMinutes: 44,
      running: false,
      nextTickEta: '2026-04-17T02:00:00.000Z'
    }
  });

  const nextState = makeState({
    stateVersion: 4,
    persistedAt: '2026-04-17T01:30:00.000Z',
    preset: 'balanced',
    nlWebhookEnabled: true,
    observer: {
      enabled: true,
      minPreVisitDelayMs: 10,
      maxPreVisitDelayMs: 20,
      minIntervalBetweenRunsMs: 30,
      gapThresholdMin: 12,
      gapPersistedOverride: 12,
      gapThresholdSpecBaseline: 6,
      gapUsesEnvOverride: true,
      gapSource: 'env',
      gapSourcePin: null
    },
    publisher: {
      draftItemIndex: 2
    },
    autoPublisher: {
      enabled: true,
      baseIntervalMinutes: 30,
      effectiveIntervalMinutes: 25,
      quietHoursStart: 3,
      quietHoursEnd: 5,
      quietHoursMultiplier: 1.8,
      activeHoursStart: 8,
      activeHoursEnd: 23,
      activeHoursMultiplier: 0.8,
      trendAdaptiveEnabled: true,
      trendWindowDays: 14,
      trendRecalibrationDays: 14,
      scheduleJitterPercent: 15,
      scheduleJitterMode: 'uniform',
      targetPublishIntervalMinutes: 0,
      running: true,
      nextTickEta: '2026-04-17T03:00:00.000Z'
    }
  });

  const reconciled = reconcileControlPanelState(current, nextState, {
    preserveDirtyEdits: true,
    controlDirty: true
  });

  // Authoritative metadata should still refresh.
  assert.equal(reconciled.stateVersion, 4);
  assert.equal(reconciled.persistedAt, '2026-04-17T01:30:00.000Z');

  // Editable fields should remain as the user's in-progress values.
  assert.equal(reconciled.preset, 'night-safe');
  assert.equal(reconciled.nlWebhookEnabled, false);
  assert.equal(reconciled.observer.gapPersistedOverride, 9);
  assert.equal(reconciled.publisher.draftItemIndex, 6);
  assert.equal(reconciled.autoPublisher.baseIntervalMinutes, 99);

  // Computed/runtime status should refresh from server.
  assert.equal(reconciled.observer.gapThresholdMin, 12);
  assert.equal(reconciled.observer.gapThresholdSpecBaseline, 6);
  assert.equal(reconciled.observer.gapUsesEnvOverride, true);
  assert.equal(reconciled.observer.gapSource, 'env');
  assert.equal(reconciled.autoPublisher.running, true);
  assert.equal(reconciled.autoPublisher.effectiveIntervalMinutes, 25);
  assert.equal(reconciled.autoPublisher.nextTickEta, '2026-04-17T03:00:00.000Z');
});

test('T-006: reconcileControlPanelState returns full server state when edit protection is off', () => {
  const current = makeState({
    stateVersion: 1,
    observer: {
      gapPersistedOverride: 3
    }
  });
  const nextState = makeState({
    stateVersion: 2,
    observer: {
      gapPersistedOverride: 7,
      gapThresholdMin: 7
    }
  });

  const reconciled = reconcileControlPanelState(current, nextState, {
    preserveDirtyEdits: false,
    controlDirty: true
  });

  assert.deepEqual(reconciled, nextState);
});

test('T-007: decideSequencedResponse rejects out-of-order publisher poll result', () => {
  const rejected = decideSequencedResponse(5, 4);
  assert.equal(rejected.accepted, false);
  assert.equal(rejected.appliedRequestSeq, 5);

  const accepted = decideSequencedResponse(5, 6);
  assert.equal(accepted.accepted, true);
  assert.equal(accepted.appliedRequestSeq, 6);
});
