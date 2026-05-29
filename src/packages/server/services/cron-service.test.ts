import { describe, it, expect, afterEach, vi } from 'vitest';
import * as cronService from './cron-service.js';

// cronService.schedule's same-minute guard compares `job.lastFired` (real
// `Date.now()`) against `currentMinute` derived from `getDateInTimezone(tz)`,
// which constructs a Date with LOCAL-tz semantics from the formatted parts of
// the requested tz. The two minute integers only line up when local tz === tz.
// We pin the cron tz to the runner's local tz so the math is consistent
// regardless of where the suite executes (CI under UTC, dev box in CDMX, etc).
const LOCAL_TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;

// All schedule calls install a setInterval — clean up after each spec so timers
// don't leak between tests and the spec doesn't keep vitest's event loop alive.
const startedJobs: cronService.CronJob[] = [];

afterEach(() => {
  for (const job of startedJobs) cronService.stop(job);
  startedJobs.length = 0;
  vi.useRealTimers();
});

describe('cronService.schedule initialLastFired', () => {
  it('defaults job.lastFired to null when initialLastFired is omitted (back-compat)', () => {
    const job = cronService.schedule('* * * * *', 'UTC', () => {});
    startedJobs.push(job);
    expect(job.lastFired).toBeNull();
  });

  it('seeds job.lastFired from initialLastFired when provided', () => {
    const seed = 1_700_000_000_000;
    const job = cronService.schedule('* * * * *', 'UTC', () => {}, { initialLastFired: seed });
    startedJobs.push(job);
    expect(job.lastFired).toBe(seed);
  });

  it('treats initialLastFired: null as "no seed" (same as omitting it)', () => {
    const job = cronService.schedule('* * * * *', 'UTC', () => {}, { initialLastFired: null });
    startedJobs.push(job);
    expect(job.lastFired).toBeNull();
  });

  it('seeded job does NOT fire on the same-minute poll (regression: cron double-fire)', () => {
    // Anchor wall clock so getDateInTimezone returns a stable minute.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-28T15:30:15Z'));

    const cb = vi.fn();
    // initialLastFired anchored inside the current minute — guard must trip.
    const job = cronService.schedule('* * * * *', LOCAL_TZ, cb, { initialLastFired: Date.now() });
    startedJobs.push(job);

    // Advance through the next interval tick (30s default) while staying in the
    // same minute — fake clock lands at 15:30:45Z.
    vi.advanceTimersByTime(30_000);
    expect(cb).not.toHaveBeenCalled();
  });

  it('seeded job DOES fire once the wall clock crosses into the next minute', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-28T15:30:15Z'));

    const cb = vi.fn();
    const job = cronService.schedule('* * * * *', LOCAL_TZ, cb, { initialLastFired: Date.now() });
    startedJobs.push(job);

    // Two interval ticks: 30s lands at 15:30:45Z (same minute → guarded),
    // 60s lands at 15:31:15Z (new minute → fires).
    vi.advanceTimersByTime(60_000);
    expect(cb).toHaveBeenCalledTimes(1);
  });
});
