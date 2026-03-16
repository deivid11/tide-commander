export const BOTTOM_PM2_LOG_RETENTION_STORAGE_KEY = 'tide:bottom-pm2-log-retention';
export const DEFAULT_BOTTOM_PM2_LOG_RETENTION = 5000;

export const BOTTOM_PM2_LOG_RETENTION_OPTIONS: Array<number | null> = [
  1000,
  2500,
  5000,
  10000,
  null,
];

export function readBottomPm2LogRetention(): number | null {
  if (typeof window === 'undefined') {
    return DEFAULT_BOTTOM_PM2_LOG_RETENTION;
  }

  try {
    const raw = window.localStorage.getItem(BOTTOM_PM2_LOG_RETENTION_STORAGE_KEY);
    if (!raw) return DEFAULT_BOTTOM_PM2_LOG_RETENTION;
    if (raw === 'unlimited') return null;

    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed > 0) {
      return Math.floor(parsed);
    }
  } catch {
    // Ignore localStorage failures and fall back to default.
  }

  return DEFAULT_BOTTOM_PM2_LOG_RETENTION;
}

export function writeBottomPm2LogRetention(value: number | null): void {
  if (typeof window === 'undefined') return;

  try {
    window.localStorage.setItem(
      BOTTOM_PM2_LOG_RETENTION_STORAGE_KEY,
      value === null ? 'unlimited' : String(value)
    );
  } catch {
    // Ignore localStorage failures.
  }
}

export function trimLogBufferByLines(logs: string, maxLines: number | null): string {
  if (!logs || maxLines === null) return logs;

  const lines = logs.split('\n');
  if (lines.length <= maxLines) return logs;

  return lines.slice(-maxLines).join('\n');
}
