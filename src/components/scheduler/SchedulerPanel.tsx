import React, { useState, useEffect } from 'react';
import type { UseAppDataReturn } from '../../hooks/useAppData';
import type { AutoPublisherControlState } from '../../lib/controlPanel';
import { NumField, SectionHeading } from '../ui/FormFields';

const SECTIONS_KEY = 'scheduler-sections';
type SectionId = 'base' | 'time-of-day' | 'trend' | 'jitter' | 'gap-recheck' | 'target';

function loadSectionState(): Record<SectionId, boolean> {
  try {
    const raw = localStorage.getItem(SECTIONS_KEY);
    if (raw) return { ...defaultSections(), ...JSON.parse(raw) };
  } catch { /* ignore */ }
  return defaultSections();
}

function defaultSections(): Record<SectionId, boolean> {
  return { base: true, 'time-of-day': true, trend: true, jitter: true, 'gap-recheck': true, target: true };
}

function saveSectionState(state: Record<SectionId, boolean>) {
  try { localStorage.setItem(SECTIONS_KEY, JSON.stringify(state)); } catch { /* ignore */ }
}

/** Mirrors server.ts isHourInRange — keep in sync if server logic changes. */
function isHourInRange(hour: number, start: number, end: number): boolean {
  if (start === end) return true;
  if (start < end) return hour >= start && hour < end;
  return hour >= start || hour < end;
}

// ── Effective Interval Display ────────────────────────────────────────────────

type FactorChip = { label: string; value: string; muted?: boolean };

function computeBreakdown(
  s: AutoPublisherControlState,
  trendMultiplier: number,
  hour: number
): { effective: number; factors: FactorChip[]; finalEffective: number } {
  let multiplier = 1;
  const factors: FactorChip[] = [{ label: 'base', value: `${s.baseIntervalMinutes}m` }];

  if (isHourInRange(hour, s.quietHoursStart, s.quietHoursEnd)) {
    multiplier *= s.quietHoursMultiplier;
    factors.push({ label: 'quiet hrs', value: `×${s.quietHoursMultiplier}` });
  } else if (isHourInRange(hour, s.activeHoursStart, s.activeHoursEnd)) {
    multiplier *= s.activeHoursMultiplier;
    factors.push({ label: 'active hrs', value: `×${s.activeHoursMultiplier}` });
  } else {
    factors.push({ label: 'off-peak', value: '×1', muted: true });
  }

  if (s.trendAdaptiveEnabled) {
    multiplier *= trendMultiplier;
    factors.push({ label: 'trend', value: `×${trendMultiplier.toFixed(2)}` });
  } else {
    factors.push({ label: 'trend off', value: '×1', muted: true });
  }

  const effective = Math.min(Math.max(Math.round(s.baseIntervalMinutes * multiplier), 1), 1440);
  factors.push({ label: 'sub-total', value: `${effective}m` });

  let finalEffective = effective;
  if (s.targetPublishIntervalMinutes > 0) {
    finalEffective = Math.min(
      Math.max(Math.round(effective * 0.5 + s.targetPublishIntervalMinutes * 0.5), 1),
      1440
    );
    factors.push({ label: `50/50 target (${s.targetPublishIntervalMinutes}m)`, value: `→ ${finalEffective}m` });
  }

  return { effective, factors, finalEffective };
}

function EffectiveIntervalDisplay({
  s,
  trendMultiplier,
}: {
  s: AutoPublisherControlState;
  trendMultiplier: number;
}) {
  const [hour, setHour] = useState(() => new Date().getHours());
  useEffect(() => {
    const t = setInterval(() => setHour(new Date().getHours()), 60_000);
    return () => clearInterval(t);
  }, []);

  const { factors, finalEffective } = computeBreakdown(s, trendMultiplier, hour);

  return (
    <div className="p-4 rounded-xl bg-black/50 border border-white/10 space-y-3">
      <div className="flex items-baseline gap-3">
        <span className="font-mono text-3xl font-bold text-orange-400 leading-none">
          {finalEffective}m
        </span>
        <span className="text-xs opacity-40">effective interval (client estimate)</span>
      </div>
      <div className="flex flex-wrap gap-2">
        {factors.map((f, i) => (
          <div
            key={i}
            className={`flex flex-col items-center px-2 py-1 rounded-lg border text-center ${
              f.muted
                ? 'bg-white/3 border-white/5 opacity-30'
                : 'bg-white/5 border-white/10'
            }`}
          >
            <span className="font-mono text-sm font-bold">{f.value}</span>
            <span className="text-[9px] opacity-50 uppercase tracking-wider mt-0.5">{f.label}</span>
          </div>
        ))}
      </div>
      <p className="text-[10px] opacity-30 leading-relaxed">
        Live estimate using local time (hour {hour}). Actual server interval may differ slightly
        due to SoV adjustment and jitter applied at tick time.
      </p>
    </div>
  );
}

// ── 24-Hour Time-of-Day Bar ───────────────────────────────────────────────────

function TimeOfDayBar({
  quietStart,
  quietEnd,
  activeStart,
  activeEnd,
}: {
  quietStart: number;
  quietEnd: number;
  activeStart: number;
  activeEnd: number;
}) {
  const [currentHour, setCurrentHour] = useState(() => new Date().getHours());
  useEffect(() => {
    const t = setInterval(() => setCurrentHour(new Date().getHours()), 60_000);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="space-y-1">
      <div className="flex gap-px h-5 rounded overflow-hidden">
        {Array.from({ length: 24 }, (_, h) => {
          const isQuiet = isHourInRange(h, quietStart, quietEnd);
          const isActive = isHourInRange(h, activeStart, activeEnd);
          const isCurrent = h === currentHour;
          return (
            <div
              key={h}
              className={`flex-1 relative transition-colors ${
                isCurrent
                  ? 'bg-orange-500'
                  : isQuiet
                  ? 'bg-blue-500/50'
                  : isActive
                  ? 'bg-emerald-500/40'
                  : 'bg-white/8'
              }`}
              title={`${String(h).padStart(2, '0')}:00${isQuiet ? ' · quiet' : isActive ? ' · active' : ''}`}
            />
          );
        })}
      </div>
      <div className="flex justify-between text-[9px] opacity-30 font-mono">
        <span>0</span><span>6</span><span>12</span><span>18</span><span>23</span>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[10px] opacity-50">
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-2.5 h-2.5 rounded-sm bg-blue-500/50" />
          Quiet ({quietStart}–{quietEnd}h) ×{'{'}slower{'}'}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-2.5 h-2.5 rounded-sm bg-emerald-500/40" />
          Active ({activeStart}–{activeEnd}h) ×{'{'}faster{'}'}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-2.5 h-2.5 rounded-sm bg-orange-500" />
          Now
        </span>
      </div>
    </div>
  );
}

// ── Main SchedulerPanel ───────────────────────────────────────────────────────

export default function SchedulerPanel({ app }: { app: UseAppDataReturn }) {
  const s = app.controlPanel.autoPublisher;
  const setSch = (patch: Partial<AutoPublisherControlState>) =>
    app.setControlPanel((c) => ({ ...c, autoPublisher: { ...c.autoPublisher, ...patch } }));

  const trendMultiplier = app.trendInsights?.trendMultiplier ?? 1;

  const [sections, setSections] = useState<Record<SectionId, boolean>>(loadSectionState);

  const toggleSection = (id: SectionId) => {
    setSections((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      saveSectionState(next);
      return next;
    });
  };

  return (
    <div className="space-y-5 p-4 rounded-2xl bg-white/5 border border-white/10 lg:col-span-2">
      <p className="text-[11px] font-bold uppercase tracking-wider opacity-60">
        Auto-Publisher Scheduler
      </p>

      {/* Live effective interval display */}
      <EffectiveIntervalDisplay s={s} trendMultiplier={trendMultiplier} />

      {/* ── Base Cadence ─────────────────────────────────────────────────── */}
      <SectionHeading label="Base Cadence" collapsible open={sections.base} onToggle={() => toggleSection('base')} />
      {sections.base && (
        <NumField
          label="Base interval (minutes) — starting point before multipliers"
          value={s.baseIntervalMinutes}
          min={1}
          onChange={(v) => setSch({ baseIntervalMinutes: Math.max(1, v) })}
        />
      )}

      {/* ── Time-of-Day Windows ──────────────────────────────────────────── */}
      <SectionHeading label="Time-of-Day Windows" collapsible open={sections['time-of-day']} onToggle={() => toggleSection('time-of-day')} />
      {sections['time-of-day'] && (
        <>
          <TimeOfDayBar
            quietStart={s.quietHoursStart}
            quietEnd={s.quietHoursEnd}
            activeStart={s.activeHoursStart}
            activeEnd={s.activeHoursEnd}
          />
          <div className="grid grid-cols-2 gap-x-4 gap-y-3">
            <div className="col-span-2 grid grid-cols-2 gap-3">
              <NumField
                label="Quiet hours start (0–23)"
                value={s.quietHoursStart}
                min={0}
                max={23}
                onChange={(v) => setSch({ quietHoursStart: Math.max(0, Math.min(23, v)) })}
              />
              <NumField
                label="Quiet hours end (0–23)"
                value={s.quietHoursEnd}
                min={0}
                max={23}
                onChange={(v) => setSch({ quietHoursEnd: Math.max(0, Math.min(23, v)) })}
              />
            </div>
            <div className="col-span-2">
              <NumField
                label="Quiet-hours multiplier"
                tooltip="Multiplies the base interval during quiet hours. Values > 1 slow cadence (e.g. 1.8 = 80% longer wait). Range 0.2–5."
                value={s.quietHoursMultiplier}
                step={0.1}
                min={0.2}
                max={5}
                onChange={(v) => setSch({ quietHoursMultiplier: Math.max(0.2, Math.min(5, v)) })}
              />
            </div>
            <div className="col-span-2 grid grid-cols-2 gap-3">
              <NumField
                label="Active hours start (0–23)"
                value={s.activeHoursStart}
                min={0}
                max={23}
                onChange={(v) => setSch({ activeHoursStart: Math.max(0, Math.min(23, v)) })}
              />
              <NumField
                label="Active hours end (0–23)"
                value={s.activeHoursEnd}
                min={0}
                max={23}
                onChange={(v) => setSch({ activeHoursEnd: Math.max(0, Math.min(23, v)) })}
              />
            </div>
            <div className="col-span-2">
              <NumField
                label="Active-hours multiplier"
                tooltip="Multiplies the base interval during active hours. Values < 1 speed cadence (e.g. 0.8 = 20% shorter wait). Range 0.2–5."
                value={s.activeHoursMultiplier}
                step={0.1}
                min={0.2}
                max={5}
                onChange={(v) => setSch({ activeHoursMultiplier: Math.max(0.2, Math.min(5, v)) })}
              />
            </div>
          </div>
        </>
      )}

      {/* ── Trend Adaptation ─────────────────────────────────────────────── */}
      <SectionHeading
        label="Trend Adaptation"
        collapsible
        open={sections.trend}
        onToggle={() => toggleSection('trend')}
      >
        <label className="flex items-center gap-2 cursor-pointer">
          <span className="text-[10px] opacity-50">{s.trendAdaptiveEnabled ? 'On' : 'Off'}</span>
          <button
            type="button"
            onClick={() => setSch({ trendAdaptiveEnabled: !s.trendAdaptiveEnabled })}
            className={`relative inline-flex h-5 w-9 shrink-0 rounded-full border-2 transition-all focus:outline-none ${
              s.trendAdaptiveEnabled ? 'bg-emerald-600 border-emerald-500' : 'bg-white/10 border-white/20'
            }`}
            aria-label="Toggle trend adaptive scheduling"
          >
            <span
              className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow-md transition-transform mt-px ${
                s.trendAdaptiveEnabled ? 'translate-x-3.5' : 'translate-x-0.5'
              }`}
            />
          </button>
        </label>
      </SectionHeading>

      {sections.trend && (
        <>
          <p className="text-[10px] opacity-40 leading-relaxed -mt-2">
            Adjusts interval based on competitor post rate over the trend window. Current trend
            multiplier: <span className="font-mono text-white/60">{trendMultiplier.toFixed(2)}×</span>
          </p>
          {s.trendAdaptiveEnabled && (
            <div className="grid grid-cols-2 gap-3">
              <NumField
                label="Trend window (days)"
                value={s.trendWindowDays}
                min={1}
                max={60}
                onChange={(v) => setSch({ trendWindowDays: Math.max(1, Math.min(60, v)) })}
              />
              <NumField
                label="Recalibration cycle (days)"
                value={s.trendRecalibrationDays}
                min={1}
                max={30}
                onChange={(v) => setSch({ trendRecalibrationDays: Math.max(1, Math.min(30, v)) })}
              />
            </div>
          )}
        </>
      )}

      {/* ── Jitter & Variance ────────────────────────────────────────────── */}
      <SectionHeading label="Jitter & Variance" collapsible open={sections.jitter} onToggle={() => toggleSection('jitter')} />
      {sections.jitter && (
        <>
          <NumField
            label="Schedule jitter ±%"
            tooltip="Each tick fires within ±N% of the effective interval. 0 = fixed; 15 = up to 15% early or late. Requires Uniform mode."
            value={s.scheduleJitterPercent}
            min={0}
            max={50}
            onChange={(v) => setSch({ scheduleJitterPercent: Math.max(0, Math.min(50, v)) })}
          />
          <div>
            <label className="block text-xs opacity-60 mb-1">Jitter mode</label>
            <select
              value={s.scheduleJitterMode}
              onChange={(e) =>
                setSch({ scheduleJitterMode: e.target.value === 'none' ? 'none' : 'uniform' })
              }
              className="w-full px-3 py-2 rounded-lg bg-black/40 border border-white/10 text-sm"
            >
              <option value="uniform">Uniform random slack</option>
              <option value="none">None (fixed interval)</option>
            </select>
          </div>
        </>
      )}

      {/* ── Gap Recheck ─────────────────────────────────────────────────── */}
      <SectionHeading label="Gap Recheck" collapsible open={sections['gap-recheck']} onToggle={() => toggleSection('gap-recheck')} />
      {sections['gap-recheck'] && (
        <NumField
          label="Gap recheck interval (minutes) — how often to re-check when gap is not yet safe"
          value={s.gapRecheckIntervalMinutes}
          min={1}
          max={60}
          onChange={(v) => setSch({ gapRecheckIntervalMinutes: Math.max(1, Math.min(60, v)) })}
        />
      )}

      {/* ── Target Cadence ───────────────────────────────────────────────── */}
      <SectionHeading label="Target Cadence (optional)" collapsible open={sections.target} onToggle={() => toggleSection('target')} />
      {sections.target && (
        <>
          <NumField
            label="Target interval (minutes) — 0 = off; blends 50/50 with the trend-adjusted interval"
            value={s.targetPublishIntervalMinutes}
            min={0}
            max={1440}
            onChange={(v) => setSch({ targetPublishIntervalMinutes: Math.max(0, Math.min(1440, v)) })}
          />
          {s.targetPublishIntervalMinutes > 0 && (
            <p className="text-[10px] opacity-40 leading-relaxed -mt-2">
              When set, the effective interval is averaged 50/50 between the trend-adjusted value and
              this target. Trend adaptive must be enabled for the dynamic part to apply.
            </p>
          )}
        </>
      )}
    </div>
  );
}
