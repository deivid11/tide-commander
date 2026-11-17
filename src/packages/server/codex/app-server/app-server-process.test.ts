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

describe('codexBinaryStamp', () => {
  it('reports the binary version and notices when the file is replaced (an upgrade)', async () => {
    const { codexBinaryStamp } = await import('./app-server-process.js');
    const fsMod = await import('node:fs');
    const osMod = await import('node:os');
    const pathMod = await import('node:path');
    const dir = fsMod.mkdtempSync(pathMod.join(osMod.tmpdir(), 'tc-codex-stamp-'));
    const bin = pathMod.join(dir, 'codex');
    try {
      fsMod.writeFileSync(bin, '#!/bin/sh\necho "codex-cli 0.159.1"\n', { mode: 0o755 });
      expect(codexBinaryStamp(bin)).toBe('codex-cli 0.159.1');
      // npm replaces the file on upgrade: new content, new mtime.
      fsMod.writeFileSync(bin, '#!/bin/sh\necho "codex-cli 0.169.0"\n', { mode: 0o755 });
      const later = new Date(Date.now() + 5000);
      fsMod.utimesSync(bin, later, later);
      expect(codexBinaryStamp(bin)).toBe('codex-cli 0.169.0');
    } finally {
      fsMod.rmSync(dir, { recursive: true, force: true });
    }
  });
});
