/**
 * Resolve the start epoch used by the Guake working timer.
 *
 * The authoritative timestamp can be absent after reload/reconnect or when a
 * different client started the turn. A stable local fallback keeps the timer
 * moving instead of leaving it at 0:00. Materially future server epochs are
 * rejected to tolerate clock skew on remote/mobile clients.
 */
export function resolveElapsedTimerStartedAt(
  timestamp: number | undefined,
  fallbackStartedAt: number | null,
  now: number,
): number {
  const validTimestamp = typeof timestamp === 'number'
    && Number.isFinite(timestamp)
    && timestamp > 0
    && timestamp <= now + 1000
    ? timestamp
    : null;
  return validTimestamp ?? fallbackStartedAt ?? now;
}
