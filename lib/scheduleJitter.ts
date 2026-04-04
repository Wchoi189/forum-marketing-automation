export type ScheduleJitterMode = "none" | "uniform";

export function clampScheduleMinutes(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.max(1, Math.min(1440, Math.round(value)));
}

/**
 * Apply random slack around the effective interval (uniform in ±percent).
 * `random` should return values in [0, 1).
 */
export function applyScheduleJitter(
  effectiveMinutes: number,
  jitterPercent: number,
  jitterMode: ScheduleJitterMode,
  random: () => number
): number {
  const base = clampScheduleMinutes(effectiveMinutes);
  if (jitterMode === "none" || jitterPercent <= 0) {
    return base;
  }
  const p = Math.min(50, Math.max(0, jitterPercent)) / 100;
  const factor = 1 + (2 * random() - 1) * p;
  return clampScheduleMinutes(base * factor);
}
