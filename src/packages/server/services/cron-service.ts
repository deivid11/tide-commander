/**
 * Cron Service
 * Thin wrapper around setInterval-based cron scheduling.
 * Parses cron expressions and fires callbacks at the scheduled times.
 *
 * Uses a simple polling approach (checks every 30s) since node-cron
 * is not yet a dependency. Sufficient for minute-level cron expressions.
 */

import { createLogger } from '../utils/logger.js';

const log = createLogger('CronService');

export interface CronJob {
  id: string;
  expression: string;
  timezone: string;
  callback: () => void;
  timer: NodeJS.Timeout | null;
  lastFired: number | null;
}

const activeJobs = new Map<string, CronJob>();

// ─── Cron Expression Parsing ───

interface CronField {
  values: Set<number>;
  isWildcard: boolean;
}

function parseField(field: string, min: number, max: number): CronField {
  if (field === '*') {
    return { values: new Set(), isWildcard: true };
  }

  const values = new Set<number>();
  const parts = field.split(',');

  for (const part of parts) {
    // Handle step values: */5, 1-30/2
    const stepMatch = part.match(/^(.+)\/(\d+)$/);
    if (stepMatch) {
      const step = parseInt(stepMatch[2], 10);
      const range = stepMatch[1];
      let start = min;
      let end = max;

      if (range !== '*') {
        const rangeParts = range.split('-');
        start = parseInt(rangeParts[0], 10);
        end = rangeParts.length > 1 ? parseInt(rangeParts[1], 10) : max;
      }

      for (let i = start; i <= end; i += step) {
        values.add(i);
      }
      continue;
    }

    // Handle ranges: 1-5
    const rangeMatch = part.match(/^(\d+)-(\d+)$/);
    if (rangeMatch) {
      const start = parseInt(rangeMatch[1], 10);
      const end = parseInt(rangeMatch[2], 10);
      for (let i = start; i <= end; i++) {
        values.add(i);
      }
      continue;
    }

    // Handle day-of-week names: MON-FRI, SUN, etc.
    const dayNames: Record<string, number> = {
      SUN: 0, MON: 1, TUE: 2, WED: 3, THU: 4, FRI: 5, SAT: 6,
    };
    const dayRangeMatch = part.match(/^([A-Z]{3})-([A-Z]{3})$/);
    if (dayRangeMatch && dayNames[dayRangeMatch[1]] !== undefined && dayNames[dayRangeMatch[2]] !== undefined) {
      const start = dayNames[dayRangeMatch[1]];
      const end = dayNames[dayRangeMatch[2]];
      if (start <= end) {
        for (let i = start; i <= end; i++) values.add(i);
      } else {
        // Wrap around: FRI-MON = 5,6,0,1
        for (let i = start; i <= 6; i++) values.add(i);
        for (let i = 0; i <= end; i++) values.add(i);
      }
      continue;
    }

    if (dayNames[part] !== undefined) {
      values.add(dayNames[part]);
      continue;
    }

    // Simple number
    const num = parseInt(part, 10);
    if (!isNaN(num)) {
      values.add(num);
    }
  }

  return { values, isWildcard: false };
}

function parseCronExpression(expression: string): { minute: CronField; hour: CronField; dayOfMonth: CronField; month: CronField; dayOfWeek: CronField } | null {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) return null;

  try {
    return {
      minute: parseField(parts[0], 0, 59),
      hour: parseField(parts[1], 0, 23),
      dayOfMonth: parseField(parts[2], 1, 31),
      month: parseField(parts[3], 1, 12),
      dayOfWeek: parseField(parts[4], 0, 6),
    };
  } catch {
    return null;
  }
}

function fieldMatches(field: CronField, value: number): boolean {
  if (field.isWildcard) return true;
  return field.values.has(value);
}

function shouldFireAt(expression: string, date: Date): boolean {
  const parsed = parseCronExpression(expression);
  if (!parsed) return false;

  return (
    fieldMatches(parsed.minute, date.getMinutes()) &&
    fieldMatches(parsed.hour, date.getHours()) &&
    fieldMatches(parsed.dayOfMonth, date.getDate()) &&
    fieldMatches(parsed.month, date.getMonth() + 1) &&
    fieldMatches(parsed.dayOfWeek, date.getDay())
  );
}

function getDateInTimezone(timezone: string): Date {
  try {
    const now = new Date();
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
    const parts = formatter.formatToParts(now);
    const get = (type: string) => parts.find(p => p.type === type)?.value || '0';

    return new Date(
      parseInt(get('year')),
      parseInt(get('month')) - 1,
      parseInt(get('day')),
      parseInt(get('hour')),
      parseInt(get('minute')),
      parseInt(get('second'))
    );
  } catch {
    // Fallback to UTC
    return new Date();
  }
}

// ─── Public API ───

const CHECK_INTERVAL_MS = 30_000; // Check every 30 seconds

export function schedule(expression: string, timezone: string, callback: () => void): CronJob {
  const id = `cron_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  const job: CronJob = {
    id,
    expression,
    timezone,
    callback,
    timer: null,
    lastFired: null,
  };

  // Check at interval whether it's time to fire
  job.timer = setInterval(() => {
    const now = getDateInTimezone(timezone);
    const currentMinute = Math.floor(now.getTime() / 60000);

    // Only fire once per minute
    if (job.lastFired !== null && Math.floor(job.lastFired / 60000) === currentMinute) {
      return;
    }

    if (shouldFireAt(expression, now)) {
      job.lastFired = Date.now();
      log.log(`Cron job ${id} fired (expression: ${expression}, timezone: ${timezone})`);
      try {
        callback();
      } catch (err) {
        log.error(`Cron job ${id} callback error:`, err);
      }
    }
  }, CHECK_INTERVAL_MS);

  activeJobs.set(id, job);
  log.log(`Scheduled cron job ${id}: ${expression} (${timezone})`);

  return job;
}

export function stop(job: CronJob): void {
  if (job.timer) {
    clearInterval(job.timer);
    job.timer = null;
  }
  activeJobs.delete(job.id);
  log.log(`Stopped cron job ${job.id}`);
}

export function stopAll(): void {
  for (const job of activeJobs.values()) {
    if (job.timer) {
      clearInterval(job.timer);
      job.timer = null;
    }
  }
  activeJobs.clear();
  log.log('Stopped all cron jobs');
}

export function validate(expression: string): boolean {
  return parseCronExpression(expression) !== null;
}

export function getNextFireTimes(expression: string, timezone: string, count: number = 5): Date[] {
  const parsed = parseCronExpression(expression);
  if (!parsed) return [];

  const results: Date[] = [];
  const start = getDateInTimezone(timezone);
  // Start from next minute
  start.setSeconds(0, 0);
  start.setMinutes(start.getMinutes() + 1);

  // Check up to 366 days ahead to find next fire times
  const maxIterations = 366 * 24 * 60;
  let current = new Date(start);

  for (let i = 0; i < maxIterations && results.length < count; i++) {
    if (shouldFireAt(expression, current)) {
      results.push(new Date(current));
    }
    current.setMinutes(current.getMinutes() + 1);
  }

  return results;
}
