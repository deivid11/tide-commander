import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { SlackWatermarkStore } from './slack-watermark-store.js';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'slack-wm-'));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('SlackWatermarkStore', () => {
  it('returns undefined for an unknown channel before any load', async () => {
    const store = new SlackWatermarkStore({ filePath: path.join(tmpDir, 'wm.json') });
    await store.load();
    expect(store.get('C001')).toBeUndefined();
    expect(store.has('C001')).toBe(false);
    expect(store.channels()).toEqual([]);
  });

  it('handles a missing file gracefully — starts fresh', async () => {
    const filePath = path.join(tmpDir, 'does-not-exist', 'wm.json');
    const store = new SlackWatermarkStore({ filePath });
    await store.load();
    expect(store.channels()).toEqual([]);
    // Setting on a missing file should auto-create the directory.
    await store.set('C100', '1700000000.000100');
    const onDisk = JSON.parse(await fs.readFile(filePath, 'utf-8'));
    expect(onDisk.channels.C100.lastTs).toBe('1700000000.000100');
  });

  it('treats a corrupt JSON file as empty rather than throwing', async () => {
    const filePath = path.join(tmpDir, 'wm.json');
    await fs.writeFile(filePath, '{ this is not json', 'utf-8');
    const store = new SlackWatermarkStore({ filePath });
    await store.load();
    expect(store.channels()).toEqual([]);
    await store.set('C200', '1700000001.000200');
    expect(store.get('C200')?.lastTs).toBe('1700000001.000200');
  });

  it('rejects a wrong-version file (forward-compat guard)', async () => {
    const filePath = path.join(tmpDir, 'wm.json');
    await fs.writeFile(
      filePath,
      JSON.stringify({ version: 99, channels: { C300: { lastTs: '1.0', lastSeenAt: 1 } } }),
      'utf-8',
    );
    const store = new SlackWatermarkStore({ filePath });
    await store.load();
    expect(store.has('C300')).toBe(false);
  });

  it('persists writes atomically (temp + rename)', async () => {
    const filePath = path.join(tmpDir, 'wm.json');
    const store = new SlackWatermarkStore({ filePath, now: () => 1_700_000_000_000 });
    await store.load();
    await store.set('C400', '1699999999.000400');
    const raw = await fs.readFile(filePath, 'utf-8');
    const parsed = JSON.parse(raw);
    expect(parsed.version).toBe(1);
    expect(parsed.channels.C400.lastTs).toBe('1699999999.000400');
    expect(parsed.channels.C400.lastSeenAt).toBe(1_700_000_000_000);
    // The .tmp file should not linger.
    const entries = await fs.readdir(tmpDir);
    expect(entries.some((e) => e.endsWith('.tmp'))).toBe(false);
  });

  it('rejects an older or equal ts (only advances forward)', async () => {
    const filePath = path.join(tmpDir, 'wm.json');
    const store = new SlackWatermarkStore({ filePath });
    await store.load();
    expect(await store.set('C500', '1700000000.000500')).toBe(true);
    expect(await store.set('C500', '1700000000.000500')).toBe(false); // equal
    expect(await store.set('C500', '1699999999.999000')).toBe(false); // older
    expect(await store.set('C500', '1700000001.000000')).toBe(true);  // newer
    expect(store.get('C500')?.lastTs).toBe('1700000001.000000');
  });

  it('round-trips state across instances via the file', async () => {
    const filePath = path.join(tmpDir, 'wm.json');
    const a = new SlackWatermarkStore({ filePath });
    await a.load();
    await a.set('C600', '1700000000.111111');
    await a.set('C601', '1700000000.222222');

    const b = new SlackWatermarkStore({ filePath });
    await b.load();
    expect(b.channels().sort()).toEqual(['C600', 'C601']);
    expect(b.get('C600')?.lastTs).toBe('1700000000.111111');
    expect(b.get('C601')?.lastTs).toBe('1700000000.222222');
  });

  it('forget() removes a channel and persists the deletion', async () => {
    const filePath = path.join(tmpDir, 'wm.json');
    const store = new SlackWatermarkStore({ filePath });
    await store.load();
    await store.set('C700', '1700000000.000700');
    await store.forget('C700');
    expect(store.has('C700')).toBe(false);
    const raw = JSON.parse(await fs.readFile(filePath, 'utf-8'));
    expect(raw.channels.C700).toBeUndefined();
  });

  it('serializes concurrent writes deterministically', async () => {
    const filePath = path.join(tmpDir, 'wm.json');
    const store = new SlackWatermarkStore({ filePath });
    await store.load();
    // Fire many sets in parallel — last one wins because each is strictly newer.
    await Promise.all([
      store.set('C800', '1700000000.000001'),
      store.set('C800', '1700000000.000002'),
      store.set('C800', '1700000000.000003'),
      store.set('C800', '1700000000.000004'),
      store.set('C800', '1700000000.000005'),
    ]);
    expect(store.get('C800')?.lastTs).toBe('1700000000.000005');
    const onDisk = JSON.parse(await fs.readFile(filePath, 'utf-8'));
    expect(onDisk.channels.C800.lastTs).toBe('1700000000.000005');
  });
});
