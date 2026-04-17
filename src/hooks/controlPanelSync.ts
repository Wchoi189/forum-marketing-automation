import type { ControlPanelState } from '../lib/controlPanel';

export type ControlPanelSyncTracker = {
  highestVersionSeen: number;
  appliedRequestSeq: number;
};

export type ControlPanelSyncDecision = {
  accepted: boolean;
  tracker: ControlPanelSyncTracker;
};

export type SequencedResponseDecision = {
  accepted: boolean;
  appliedRequestSeq: number;
};

export function decideSequencedResponse(
  appliedRequestSeq: number,
  requestSeq: number
): SequencedResponseDecision {
  if (requestSeq < appliedRequestSeq) {
    return {
      accepted: false,
      appliedRequestSeq
    };
  }

  return {
    accepted: true,
    appliedRequestSeq: requestSeq
  };
}

/**
 * Enforce monotonic state application:
 * - reject lower stateVersion payloads;
 * - for equal versions, reject older request sequence numbers;
 * - mutation responses (no requestSeq) are treated as authoritative.
 */
export function decideControlPanelSync(
  tracker: ControlPanelSyncTracker,
  nextStateVersion: number,
  options: {
    requestSeq?: number;
    latestRequestedSeq: number;
  }
): ControlPanelSyncDecision {
  const { requestSeq, latestRequestedSeq } = options;

  if (typeof requestSeq === 'number') {
    if (nextStateVersion < tracker.highestVersionSeen) {
      return { accepted: false, tracker };
    }

    if (
      nextStateVersion === tracker.highestVersionSeen &&
      requestSeq < tracker.appliedRequestSeq
    ) {
      return { accepted: false, tracker };
    }

    return {
      accepted: true,
      tracker: {
        highestVersionSeen: Math.max(tracker.highestVersionSeen, nextStateVersion),
        appliedRequestSeq: requestSeq
      }
    };
  }

  return {
    accepted: true,
    tracker: {
      highestVersionSeen: Math.max(tracker.highestVersionSeen, nextStateVersion),
      appliedRequestSeq: latestRequestedSeq
    }
  };
}

/**
 * Keep user-editable form fields intact while still refreshing server-authoritative
 * computed status fields during background polling.
 */
export function reconcileControlPanelState(
  current: ControlPanelState,
  nextState: ControlPanelState,
  options: {
    preserveDirtyEdits: boolean;
    controlDirty: boolean;
  }
): ControlPanelState {
  const { preserveDirtyEdits, controlDirty } = options;
  if (!preserveDirtyEdits || !controlDirty) return nextState;

  return {
    ...nextState,
    preset: current.preset,
    nlWebhookEnabled: current.nlWebhookEnabled,
    observer: {
      ...nextState.observer,
      enabled: current.observer.enabled,
      minPreVisitDelayMs: current.observer.minPreVisitDelayMs,
      maxPreVisitDelayMs: current.observer.maxPreVisitDelayMs,
      minIntervalBetweenRunsMs: current.observer.minIntervalBetweenRunsMs,
      gapPersistedOverride: current.observer.gapPersistedOverride,
      gapSourcePin: current.observer.gapSourcePin
    },
    publisher: {
      ...current.publisher
    },
    autoPublisher: {
      ...nextState.autoPublisher,
      enabled: current.autoPublisher.enabled,
      baseIntervalMinutes: current.autoPublisher.baseIntervalMinutes,
      quietHoursStart: current.autoPublisher.quietHoursStart,
      quietHoursEnd: current.autoPublisher.quietHoursEnd,
      quietHoursMultiplier: current.autoPublisher.quietHoursMultiplier,
      activeHoursStart: current.autoPublisher.activeHoursStart,
      activeHoursEnd: current.autoPublisher.activeHoursEnd,
      activeHoursMultiplier: current.autoPublisher.activeHoursMultiplier,
      trendAdaptiveEnabled: current.autoPublisher.trendAdaptiveEnabled,
      trendWindowDays: current.autoPublisher.trendWindowDays,
      trendRecalibrationDays: current.autoPublisher.trendRecalibrationDays,
      scheduleJitterPercent: current.autoPublisher.scheduleJitterPercent,
      scheduleJitterMode: current.autoPublisher.scheduleJitterMode,
      targetPublishIntervalMinutes: current.autoPublisher.targetPublishIntervalMinutes
    }
  };
}
