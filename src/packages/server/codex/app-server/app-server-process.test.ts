import { describe, expect, it } from 'vitest';
import { isDaemonAccountCurrent } from './app-server-process.js';

/**
 * The daemon caches ~/.codex/auth.json at startup, so rejoining one that is
 * signed in as a different account silently keeps every agent on the old
 * (usually rate-limited) login. Unknowns must never trigger a kill.
 */
describe('isDaemonAccountCurrent', () => {
  it('treats a daemon on a different account as stale', () => {
    expect(isDaemonAccountCurrent('david@tide.mx', 'felipe@tide.mx')).toBe(false);
  });

  it('accepts the same account regardless of case or padding', () => {
    expect(isDaemonAccountCurrent('David@Tide.MX', ' david@tide.mx ')).toBe(true);
  });

  it('keeps the daemon when either side is unknown (API key auth, probe failure)', () => {
    expect(isDaemonAccountCurrent(null, 'felipe@tide.mx')).toBe(true);
    expect(isDaemonAccountCurrent('felipe@tide.mx', null)).toBe(true);
    expect(isDaemonAccountCurrent(null, null)).toBe(true);
  });
});
