import { useState, useEffect, useRef, useCallback } from 'react';
import type { PipelineStepId } from '../PipelineCanvas';
import {
  DEFAULT_CONTROL_PANEL,
  stripTaggedErrorPrefix,
  type ControlPanelState,
  type ActivityLog,
  type BoardStats,
  type CompetitorStat,
  type DraftItem,
  type PublisherHistoryEntry,
  type TrendInsights,
  type AiAdvisorOutput
} from '../lib/controlPanel';
import {
  decideControlPanelSync,
  decideSequencedResponse,
  reconcileControlPanelState
} from './controlPanelSync';

type ActionMessage = { type: 'success' | 'error'; text: string; log?: ActivityLog } | null;

type AiTokenStats = {
  callCount: number;
  successCount: number;
  failureCount: number;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalTokens: number;
  avgPromptTokens: number | null;
  avgCompletionTokens: number | null;
  avgTotalTokens: number | null;
  lastCallAt: string | null;
  lastDurationMs: number | null;
};

export interface UseAppDataReturn {
  // Data
  logs: ActivityLog[];
  drafts: DraftItem[];
  competitorStats: CompetitorStat[];
  boardStats: BoardStats | null;
  trendInsights: TrendInsights | null;
  publisherHistory: PublisherHistoryEntry[];
  controlPanel: ControlPanelState;
  aiTokenStats: AiTokenStats | null;
  playbookData: unknown;
  loading: boolean;
  actionMessage: ActionMessage;
  controlSaving: boolean;
  controlDirty: boolean;
  controlPanelSection: 'observer' | 'scheduler' | 'publisher';
  aiRec: AiAdvisorOutput | null;
  aiRecBuiltAt: string | null;
  aiRecApplied: boolean;
  aiAppliedValues: { intervalMinutes: number; gapThreshold: number } | null;
  aiRecRefreshAttempted: boolean;

  // UI-only state
  selectedLog: ActivityLog | null;
  showOverrideModal: boolean;
  realPublisherStep: PipelineStepId | null;

  // Setters (for UI-only state that pages manipulate directly)
  setControlPanel: React.Dispatch<React.SetStateAction<ControlPanelState>>;
  setControlDirty: React.Dispatch<React.SetStateAction<boolean>>;
  setControlPanelSection: React.Dispatch<React.SetStateAction<'observer' | 'scheduler' | 'publisher'>>;
  setSelectedLog: React.Dispatch<React.SetStateAction<ActivityLog | null>>;
  setShowOverrideModal: React.Dispatch<React.SetStateAction<boolean>>;
  setActionMessage: React.Dispatch<React.SetStateAction<ActionMessage>>;

  // Actions
  fetchLogs: () => Promise<void>;
  fetchDrafts: () => Promise<void>;
  fetchStats: () => Promise<void>;
  fetchControlPanel: () => Promise<void>;
  fetchPublisherHistory: () => Promise<void>;
  fetchPlaybook: () => Promise<void>;
  fetchAiTokenStats: () => Promise<void>;
  refreshAiRecommendation: () => Promise<void>;
  runObserver: () => Promise<void>;
  runPublisher: (force?: boolean) => Promise<void>;
  saveControlPanel: (override?: ControlPanelState) => Promise<void>;
  silentRefreshObserver: () => void;
  applyAiRecommendation: () => Promise<void>;
}

export function useAppData(): UseAppDataReturn {
  const ACTIVITY_POLL_MS = 60_000;
  const OBSERVER_REFRESH_MS = 3 * 60 * 1000;
  const MIN_OBSERVER_INTERVAL_MS = 3 * 60 * 1000;
  const [logs, setLogs] = useState<ActivityLog[]>([]);
  const [competitorStats, setCompetitorStats] = useState<CompetitorStat[]>([]);
  const [boardStats, setBoardStats] = useState<BoardStats | null>(null);
  const [trendInsights, setTrendInsights] = useState<TrendInsights | null>(null);
  const [playbookData, setPlaybookData] = useState<unknown>(null);
  const [aiTokenStats, setAiTokenStats] = useState<AiTokenStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [actionMessage, setActionMessage] = useState<ActionMessage>(null);

  const [drafts, setDrafts] = useState<DraftItem[]>([]);
  const [publisherHistory, setPublisherHistory] = useState<PublisherHistoryEntry[]>([]);
  const [controlPanel, setControlPanel] = useState<ControlPanelState>(DEFAULT_CONTROL_PANEL);
  const [controlSaving, setControlSaving] = useState(false);
  const [controlDirty, setControlDirty] = useState(false);
  const [controlPanelSection, setControlPanelSection] = useState<'observer' | 'scheduler' | 'publisher'>('observer');

  const [selectedLog, setSelectedLog] = useState<ActivityLog | null>(null);
  const [showOverrideModal, setShowOverrideModal] = useState(false);
  const [aiRec, setAiRec] = useState<AiAdvisorOutput | null>(null);
  const [aiRecBuiltAt, setAiRecBuiltAt] = useState<string | null>(null);
  const [aiRecRefreshAttempted, setAiRecRefreshAttempted] = useState(false);
  const [aiRecApplied, setAiRecApplied] = useState(false);
  const [aiAppliedValues, setAiAppliedValues] = useState<{ intervalMinutes: number; gapThreshold: number } | null>(null);

  // Real publisher step — updated by polling /api/publisher-status during a run
  const [realPublisherStep, setRealPublisherStep] = useState<PipelineStepId | null>(null);
  const publisherPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastObserverRefreshRef = useRef<number>(0);
  const prevPublisherRunningRef = useRef(false);
  const publisherStatusRequestSeqRef = useRef(0);
  const publisherStatusAppliedSeqRef = useRef(0);

  // Guard against out-of-order /api/control-panel responses overwriting newer state.
  const controlPanelRequestSeqRef = useRef(0);
  const controlPanelAppliedSeqRef = useRef(0);
  const controlPanelHighestVersionSeenRef = useRef(DEFAULT_CONTROL_PANEL.stateVersion);

  const normalizeControlPanelState = useCallback((data: Partial<ControlPanelState>): ControlPanelState => ({
    ...DEFAULT_CONTROL_PANEL,
    ...data,
    observer: { ...DEFAULT_CONTROL_PANEL.observer, ...data.observer },
    publisher: { ...DEFAULT_CONTROL_PANEL.publisher, ...data.publisher },
    autoPublisher: { ...DEFAULT_CONTROL_PANEL.autoPublisher, ...data.autoPublisher }
  }), []);

  const applyServerControlPanelState = useCallback((
    nextState: ControlPanelState,
    opts: { requestSeq?: number; preserveDirtyEdits?: boolean } = {}
  ) => {
    const { requestSeq, preserveDirtyEdits = false } = opts;

    const syncDecision = decideControlPanelSync(
      {
        highestVersionSeen: controlPanelHighestVersionSeenRef.current,
        appliedRequestSeq: controlPanelAppliedSeqRef.current
      },
      nextState.stateVersion,
      {
        requestSeq,
        latestRequestedSeq: controlPanelRequestSeqRef.current
      }
    );

    if (!syncDecision.accepted) return false;

    controlPanelAppliedSeqRef.current = syncDecision.tracker.appliedRequestSeq;
    controlPanelHighestVersionSeenRef.current = syncDecision.tracker.highestVersionSeen;

    setControlPanel((current) => reconcileControlPanelState(current, nextState, {
      preserveDirtyEdits,
      controlDirty
    }));

    return true;
  }, [controlDirty]);

  // Fetch functions
  const fetchStats = useCallback(async () => {
    try {
      const [compRes, boardRes, trendRes] = await Promise.all([
        fetch('/api/competitor-stats'),
        fetch('/api/board-stats'),
        fetch('/api/trend-insights')
      ]);
      const [compData, boardData, trendData] = await Promise.all([
        compRes.json(),
        boardRes.json(),
        trendRes.json()
      ]);
      setCompetitorStats(compData);
      setBoardStats(boardData);
      if (trendRes.ok && trendData && typeof trendData.trendMultiplier === 'number') {
        setTrendInsights(trendData as TrendInsights);
      }
    } catch (error) {
      console.error('Failed to fetch stats:', error);
    }
  }, []);

  const fetchLogs = useCallback(async () => {
    try {
      const response = await fetch('/api/logs');
      const data = await response.json();
      setLogs(data);
    } catch (error) {
      console.error('Failed to fetch logs:', error);
    }
  }, []);

  const fetchDrafts = useCallback(async () => {
    try {
      const response = await fetch('/api/drafts');
      const data = await response.json();
      setDrafts(data);
    } catch (error) {
      console.error('Failed to fetch drafts:', error);
    }
  }, []);

  const fetchPublisherHistory = useCallback(async () => {
    try {
      const response = await fetch('/api/publisher-history?limit=30');
      const data = await response.json();
      if (Array.isArray(data)) {
        setPublisherHistory(data as PublisherHistoryEntry[]);
      }
    } catch (error) {
      console.error('Failed to fetch publisher history:', error);
    }
  }, []);

  const fetchControlPanel = useCallback(async () => {
    try {
      const requestSeq = ++controlPanelRequestSeqRef.current;
      const response = await fetch('/api/control-panel');
      const data = await response.json();
      const nextState = normalizeControlPanelState(data as Partial<ControlPanelState>);
      applyServerControlPanelState(nextState, {
        requestSeq,
        preserveDirtyEdits: true,
      });
    } catch (error) {
      console.error('Failed to fetch control panel:', error);
    }
  }, [normalizeControlPanelState, applyServerControlPanelState]);

  const fetchPlaybook = useCallback(async () => {
    try {
      const response = await fetch('/api/playbook/ppomppu-gonggu-v1');
      const data = await response.json();
      setPlaybookData(data);
    } catch (error) {
      console.error('Failed to fetch playbook:', error);
    }
  }, []);

  const fetchAiTokenStats = useCallback(async () => {
    try {
      const response = await fetch('/api/ai-token-stats');
      const data = await response.json();
      setAiTokenStats(data);
    } catch {
      // ignore — panel shows null gracefully
    }
  }, []);

  const refreshAiRecommendation = useCallback(async () => {
    try {
      setAiRecRefreshAttempted(true);
      const res = await fetch('/api/ai-recommendation');
      const data = await res.json();
      if (data.recommendation && data.recommendation.ok !== false) {
        const rec = data.recommendation.recommendation ?? data.recommendation;
        if (rec && typeof rec.recommendedIntervalMinutes === 'number') {
          setAiRec(rec as AiAdvisorOutput);
          setAiRecBuiltAt(data.contextBuiltAt ?? null);
          setAiRecApplied(false);
          setAiAppliedValues(null);
        } else {
          setAiRec(null);
        }
      } else {
        setAiRec(null);
      }
    } catch {
      // ignore — UI shows null state gracefully
    }
  }, []);

  const silentRefreshObserver = useCallback(() => {
    const now = Date.now();
    if (now - lastObserverRefreshRef.current < MIN_OBSERVER_INTERVAL_MS) return;
    lastObserverRefreshRef.current = now;
    fetch('/api/run-observer', { method: 'POST' })
      .then(r => r.json())
      .then(() => { fetchLogs(); fetchStats(); fetchControlPanel(); })
      .catch(() => {});
  }, [fetchLogs, fetchStats, fetchControlPanel]);

  // Initial data load on mount + 30-second refresh for non-critical data
  useEffect(() => {
    fetchLogs();
    fetchDrafts();
    fetchStats();
    fetchControlPanel();
    fetchPublisherHistory();
    fetchPlaybook();
    fetchAiTokenStats();
    silentRefreshObserver();
    const interval = setInterval(() => {
      fetchLogs();
      fetchDrafts();
      fetchStats();
      fetchControlPanel();
      fetchPublisherHistory();
      fetchAiTokenStats();
    }, ACTIVITY_POLL_MS);
    return () => clearInterval(interval);
  }, [fetchLogs, fetchDrafts, fetchStats, fetchControlPanel, fetchPublisherHistory, fetchPlaybook, fetchAiTokenStats, silentRefreshObserver]);

  // Periodic observer auto-refresh every 5 minutes so board state never goes stale
  useEffect(() => {
    const interval = setInterval(() => {
      silentRefreshObserver();
    }, OBSERVER_REFRESH_MS);
    return () => clearInterval(interval);
  }, [silentRefreshObserver]);

  // Re-sync control panel + logs when the tab regains focus after being in the background.
  // Timers in background tabs are heavily throttled by browsers, so polling may be stale.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        fetchControlPanel();
        fetchLogs();
        fetchPublisherHistory();
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [fetchControlPanel, fetchLogs, fetchPublisherHistory]);

  // Publisher step polling (fine-grained, used during active publish runs)
  const startPublisherPolling = useCallback(() => {
    if (publisherPollRef.current) return;
    publisherPollRef.current = setInterval(async () => {
      try {
        const requestSeq = ++publisherStatusRequestSeqRef.current;
        const res = await fetch('/api/publisher-status');
        const data: { step: PipelineStepId | null; running: boolean } = await res.json();
        const sequenceDecision = decideSequencedResponse(
          publisherStatusAppliedSeqRef.current,
          requestSeq
        );
        if (!sequenceDecision.accepted) return;
        publisherStatusAppliedSeqRef.current = sequenceDecision.appliedRequestSeq;
        if (data.step) {
          setRealPublisherStep(data.step);
        }
        if (!data.running && !data.step) {
          stopPublisherPolling();
        }
      } catch {
        // ignore poll errors
      }
    }, 1500);
  }, []);

  const stopPublisherPolling = useCallback(() => {
    if (publisherPollRef.current) {
      clearInterval(publisherPollRef.current);
      publisherPollRef.current = null;
    }
  }, []);

  // Fast 5-second poll of publisher-status to detect scheduler auto-publish ticks.
  // This endpoint is pure in-memory (zero disk I/O) so the overhead is negligible.
  // When running transitions true→false, we refresh logs and history to show updated data.
  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const requestSeq = ++publisherStatusRequestSeqRef.current;
        const res = await fetch('/api/publisher-status');
        const data: { step: PipelineStepId | null; running: boolean } = await res.json();
        const sequenceDecision = decideSequencedResponse(
          publisherStatusAppliedSeqRef.current,
          requestSeq
        );
        if (!sequenceDecision.accepted) return;
        publisherStatusAppliedSeqRef.current = sequenceDecision.appliedRequestSeq;
        const wasRunning = prevPublisherRunningRef.current;
        prevPublisherRunningRef.current = data.running;

        if (data.running) {
          // Auto-publisher just started or is mid-run — activate step polling
          startPublisherPolling();
          if (data.step) setRealPublisherStep(data.step);
        } else if (wasRunning && !data.running) {
          // Run just finished — refresh data to reflect the new state
          stopPublisherPolling();
          setRealPublisherStep(null);
          fetchLogs();
          fetchStats();
          fetchControlPanel();
          fetchPublisherHistory();
        }
      } catch {
        // ignore poll errors
      }
    }, 5000);
    return () => clearInterval(interval);
  }, [startPublisherPolling, stopPublisherPolling, fetchLogs, fetchStats, fetchControlPanel, fetchPublisherHistory]);

  // When the scheduler auto-publishes, detect running=true and start step polling
  useEffect(() => {
    if (controlPanel.autoPublisher.running) {
      startPublisherPolling();
    } else {
      stopPublisherPolling();
      setRealPublisherStep(null);
    }
  }, [controlPanel.autoPublisher.running, startPublisherPolling, stopPublisherPolling]);

  // Action handlers
  const saveControlPanel = useCallback(async (override?: ControlPanelState) => {
    setControlSaving(true);
    try {
      const payload = override ?? controlPanel;
      const response = await fetch('/api/control-panel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...payload,
          expectedVersion: payload.stateVersion
        })
      });
      const data = await response.json();

      if (!response.ok) {
        if (response.status === 409 && data?.currentState) {
          applyServerControlPanelState(
            normalizeControlPanelState(data.currentState as Partial<ControlPanelState>)
          );
          setControlDirty(false);
          setActionMessage({
            type: 'error',
            text: 'Control panel changed in another request. Latest server state loaded; re-apply your edits and save again.'
          });
          return;
        }

        const errorText = typeof data?.error === 'string' ? data.error : 'Control panel save failed.';
        setActionMessage({ type: 'error', text: errorText });
        return;
      }

      applyServerControlPanelState(normalizeControlPanelState(data as Partial<ControlPanelState>));
      setControlDirty(false);
      setActionMessage({ type: 'success', text: 'Control panel settings saved.' });
    } catch (error) {
      setActionMessage({ type: 'error', text: 'Control panel save failed (network/API error).' });
    } finally {
      setControlSaving(false);
    }
  }, [controlPanel, normalizeControlPanelState, applyServerControlPanelState]);

  const runObserver = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/run-observer', { method: 'POST' });
      const data = await response.json();
      if (data.success) {
        setActionMessage({ type: 'success', text: 'Observer run completed successfully.', log: data.log });
        fetchLogs();
        fetchControlPanel();
      } else {
        const detail = stripTaggedErrorPrefix(data.error || 'Observer failed.');
        setActionMessage({ type: 'error', text: `Observer — ${detail}`, log: data.log });
      }
    } catch (error) {
      setActionMessage({ type: 'error', text: 'Observer — network error (could not reach API).' });
    } finally {
      setLoading(false);
    }
  }, [fetchLogs, fetchControlPanel]);

  const applyAiRecommendation = useCallback(async () => {
    try {
      const res = await fetch('/api/apply-ai-recommendation', { method: 'POST' });
      if (res.ok) {
        const data = await res.json() as {
          applied: boolean;
          intervalMinutes: number;
          gapThreshold: number;
          controlPanel?: Partial<ControlPanelState>;
        };
        setAiRecApplied(true);
        setAiAppliedValues({ intervalMinutes: data.intervalMinutes, gapThreshold: data.gapThreshold });
        setActionMessage({ type: 'success', text: 'AI recommendation applied to control panel.' });
        if (data.controlPanel) {
          applyServerControlPanelState(normalizeControlPanelState(data.controlPanel));
        } else {
          await fetchControlPanel();
        }
      } else {
        const data = await res.json();
        const reason = data.error === 'recommendation_stale'
          ? 'Recommendation is stale — run observer to refresh.'
          : 'No recommendation available.';
        setActionMessage({ type: 'error', text: `AI advisor — ${reason}` });
      }
    } catch {
      setActionMessage({ type: 'error', text: 'AI advisor — network error.' });
    }
  }, [fetchControlPanel, normalizeControlPanelState, applyServerControlPanelState]);

  const runPublisher = useCallback(async (force: boolean = false) => {
    setLoading(true);
    setRealPublisherStep(null);
    startPublisherPolling();
    try {
      const response = await fetch('/api/run-publisher', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force })
      });
      const data = await response.json();
      const label = force ? 'Publisher (manual override)' : 'Publisher (auto)';
      const runHint =
        typeof data.runId === 'string' && data.runId.length > 0 ? ` runId=${data.runId}` : '';
      if (data.success) {
        setActionMessage({ type: 'success', text: `${label} — ${data.message}${runHint}`, log: data.log });
      } else {
        const detail = stripTaggedErrorPrefix(data.error || data.message || 'Publisher failed.');
        setActionMessage({ type: 'error', text: `${label} — ${detail}${runHint}`, log: data.log });
      }
      fetchLogs();
      fetchPublisherHistory();
      silentRefreshObserver();
    } catch (error) {
      const label = force ? 'Publisher (manual override)' : 'Publisher (auto)';
      setActionMessage({ type: 'error', text: `${label} — network error (could not reach API).` });
    } finally {
      stopPublisherPolling();
      setRealPublisherStep(null);
      setLoading(false);
    }
  }, [fetchLogs, fetchPublisherHistory, silentRefreshObserver, startPublisherPolling, stopPublisherPolling]);

  return {
    logs, drafts, competitorStats, boardStats, trendInsights, publisherHistory,
    controlPanel, aiTokenStats, playbookData, loading, actionMessage, controlSaving, controlDirty,
    controlPanelSection,
    aiRec, aiRecBuiltAt, aiRecApplied, aiAppliedValues, aiRecRefreshAttempted,
    // UI-only state
    selectedLog, showOverrideModal, realPublisherStep,
    // Setters
    setControlPanel, setControlDirty, setControlPanelSection, setSelectedLog,
    setShowOverrideModal, setActionMessage,
    // Actions
    fetchLogs, fetchDrafts, fetchStats, fetchControlPanel, fetchPublisherHistory,
    fetchPlaybook, fetchAiTokenStats, refreshAiRecommendation, runObserver, runPublisher, saveControlPanel, silentRefreshObserver,
    applyAiRecommendation
  };
}
