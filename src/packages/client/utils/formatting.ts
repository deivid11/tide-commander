import type { i18n as I18nType } from 'i18next';

// Lazy-load i18n to avoid circular dependencies
let _i18nInstance: I18nType | null = null;
function _getI18n(): I18nType | null {
  if (!_i18nInstance) {
    try {
      // Dynamic import resolved at module level after init
      _i18nInstance = (globalThis as Record<string, unknown>).__i18n as I18nType | null;
    } catch { /* i18n not yet initialized */ }
  }
  return _i18nInstance;
}

// Allow i18n instance to be set externally (called from i18n.ts after init)
export function setI18nInstance(instance: I18nType): void {
  _i18nInstance = instance;
}

// Format number with K/M suffix
export function formatNumber(n: number): string {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
  return n.toString();
}

// Format tokens with K suffix
export function formatTokens(tokens: number): string {
  if (tokens >= 1000000) return (tokens / 1000000).toFixed(1) + 'M';
  if (tokens >= 1000) return (tokens / 1000).toFixed(1) + 'K';
  return tokens.toString();
}

// Format relative time ago
export function formatTimeAgo(timestamp: number): string {
  const i18n = _getI18n();
  const t = i18n?.t?.bind(i18n);
  const seconds = Math.floor((Date.now() - timestamp) / 1000);

  if (seconds < 60) return t ? t('common:time.seconds', { count: seconds }) : `${seconds}s`;
  if (seconds < 3600) return t ? t('common:time.minutes', { count: Math.floor(seconds / 60) }) : `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return t ? t('common:time.hours', { count: Math.floor(seconds / 3600) }) : `${Math.floor(seconds / 3600)}h`;
  return t ? t('common:time.days', { count: Math.floor(seconds / 86400) }) : `${Math.floor(seconds / 86400)}d`;
}

// Format idle time in human readable format (for agent idle display)
export function formatIdleTime(timestamp: number): string {
  const i18n = _getI18n();
  const t = i18n?.t?.bind(i18n);
  const seconds = Math.floor((Date.now() - timestamp) / 1000);

  if (seconds < 5) return t ? t('common:time.justNow') : 'just now';
  if (seconds < 60) return t ? t('common:time.secondsAgo', { count: seconds }) : `${seconds}s ago`;

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    const secs = seconds % 60;
    if (secs > 0) return t ? t('common:time.minutesSecondsAgo', { minutes, seconds: secs }) : `${minutes}m ${secs}s ago`;
    return t ? t('common:time.minutesAgo', { count: minutes }) : `${minutes}m ago`;
  }

  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hours < 24) {
    if (mins > 0) return t ? t('common:time.hoursMinutesAgo', { hours, minutes: mins }) : `${hours}h ${mins}m ago`;
    return t ? t('common:time.hoursAgo', { count: hours }) : `${hours}h ago`;
  }

  const days = Math.floor(hours / 24);
  const hrs = hours % 24;
  if (hrs > 0) return t ? t('common:time.daysHoursAgo', { days, hours: hrs }) : `${days}d ${hrs}h ago`;
  return t ? t('common:time.daysAgo', { count: days }) : `${days}d ago`;
}

// getIdleTimerColor has been moved to utils/colors.ts
// Re-export for backwards compatibility
export { getIdleTimerColor } from './colors';

// Filter out cost/price mentions from text
// Used globally when hideCost setting is enabled
export function filterCostText(text: string | undefined, hideCost: boolean): string {
  if (!text) return '';
  if (!hideCost) return text;
  // Remove patterns like "$0.05", "cost: $1.23", "(cost $0.50)", "~$0.10", etc.
  return text
    .replace(/\s*\(?\s*~?\$[\d,.]+\s*\)?/g, '')
    .replace(/\s*cost[:\s]+~?\$[\d,.]+/gi, '')
    .replace(/\s*price[:\s]+~?\$[\d,.]+/gi, '')
    .replace(/\s*\(~?\$[\d,.]+\s*(?:USD|cost|spent)?\)/gi, '')
    .replace(/\s*-\s*~?\$[\d,.]+\s*$/g, '')  // trailing " - $0.05"
    .replace(/[^\S\n]+/g, ' ')  // normalize whitespace but preserve newlines
    .trim();
}
