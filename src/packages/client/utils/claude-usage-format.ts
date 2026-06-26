/**
 * Shared formatting helpers for the Claude usage / rate-limit gauges.
 *
 * Kept in one place so the ContextViewModal (full panel) and the FlatView
 * status-bar plan-limits tooltip render identical colors and reset-time strings.
 */

// Color for a "percent used" gauge — green healthy → red critical.
export function getUsedPercentColor(percent: number): string {
  if (percent >= 80) return '#ff4a4a'; // Red - critical
  if (percent >= 60) return '#ff9e4a'; // Orange - warning
  if (percent >= 40) return '#ffd700'; // Yellow - moderate
  return '#4aff9e'; // Green - healthy
}

// Format a rate-limit reset timestamp the way the CLI's /usage tab does:
// time-of-day for same-day resets, "Jun 15, 1pm" style otherwise, with the
// local IANA timezone appended.
export function formatResetTime(isoTimestamp: string): string {
  const date = new Date(isoTimestamp);
  if (Number.isNaN(date.getTime())) return isoTimestamp;
  const now = new Date();
  const time = date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const sameDay = date.toDateString() === now.toDateString();
  const datePart = sameDay ? time : `${date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}, ${time}`;
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return timeZone ? `${datePart} (${timeZone})` : datePart;
}
