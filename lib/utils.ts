/** Extract an error code from an Error object or string (e.g. "TIMEOUT: ..."). */
export function extractErrorCode(input: unknown): string {
  const message = String((input as { message?: unknown })?.message ?? input ?? '').trim();
  const matched = message.match(/^([A-Z0-9_]+):/);
  return matched ? matched[1] : 'UNCLASSIFIED_ERROR';
}

/** Clamp a number to [min, max]. Handles unknown values with a fallback. */
export function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === 'number' ? value : fallback;
  return Math.max(min, Math.min(max, n));
}

/** Clamp a known number to [min, max]. Convenience wrapper when fallback is not needed. */
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
