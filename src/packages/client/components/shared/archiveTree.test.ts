import { describe, it, expect } from 'vitest';
import { buildArchiveTree, collectArchiveDirPaths, countArchiveNodes, formatArchiveSize, type ArchiveEntryDto } from './archiveTree';

const f = (path: string, size: number | null, compressedSize: number | null = null, mtime: string | null = null): ArchiveEntryDto =>
  ({ path, isDir: false, size, compressedSize, mtime });
const d = (path: string, mtime: string | null = null): ArchiveEntryDto =>
  ({ path, isDir: true, size: 0, compressedSize: 0, mtime });

describe('buildArchiveTree', () => {
  it('materialises intermediate directories, rolls up sizes/counts and sorts dirs first (natural order)', () => {
    const root = buildArchiveTree([
      f('resultados/actividad_10/payload_2.json', 300, 30),
      f('resultados/actividad_10/payload_10.json', 200, 20),
      f('resultados/actividad_3/x.json', 100, 10),
      f('README.md', 50, 25),
      d('resultados/', '2026-08-17T00:00:00.000Z'),
      f('zeta.txt', 1, 1),
    ]);
    // Root children: dirs first, then files by name.
    expect(root.children.map((c) => c.name)).toEqual(['resultados', 'README.md', 'zeta.txt']);
    const resultados = root.children[0];
    expect(resultados.isDir).toBe(true);
    expect(resultados.mtime).toBe('2026-08-17T00:00:00.000Z');
    // Implicit intermediate dirs exist and are naturally sorted (3 before 10).
    expect(resultados.children.map((c) => c.name)).toEqual(['actividad_3', 'actividad_10']);
    // Natural sort inside a dir: payload_2 before payload_10.
    expect(resultados.children[1].children.map((c) => c.name)).toEqual(['payload_2.json', 'payload_10.json']);
    // Aggregates: sizes, compressed sizes and file counts roll up.
    expect(resultados.size).toBe(600);
    expect(resultados.compressedSize).toBe(60);
    expect(resultados.fileCount).toBe(3);
    expect(root.size).toBe(651);
    expect(root.fileCount).toBe(5);
  });

  it('propagates unknown sizes as null (tar has no stored size; some tools omit sizes)', () => {
    const root = buildArchiveTree([f('a/b.txt', 10, null), f('a/c.txt', null, null)]);
    const a = root.children[0];
    expect(a.size).toBeNull();
    expect(a.compressedSize).toBeNull();
    expect(root.size).toBeNull();
  });

  it('normalises backslashes, leading slashes and trailing slashes', () => {
    const root = buildArchiveTree([f('\\win\\style\\file.txt', 1), d('/lead/'), f('trail/', 2)]);
    // "trail/" flagged as a FILE is a file named "trail" — trailing slashes are trimmed, isDir decides.
    expect(collectArchiveDirPaths(root).sort()).toEqual(['lead', 'win', 'win/style']);
    expect(root.children.find((c) => c.name === 'trail')?.isDir).toBe(false);
    expect(countArchiveNodes(root)).toBe(5); // win, win/style, file.txt, lead, trail
  });
});

describe('formatArchiveSize', () => {
  it('formats bytes / KB / MB / GB with sensible precision and a dash for unknown', () => {
    expect(formatArchiveSize(0)).toBe('0 B');
    expect(formatArchiveSize(512)).toBe('512 B');
    expect(formatArchiveSize(2048)).toBe('2.00 KB');
    expect(formatArchiveSize(13_547_198)).toBe('12.9 MB');
    expect(formatArchiveSize(95_217_272)).toBe('90.8 MB');
    expect(formatArchiveSize(2 * 1024 ** 3)).toBe('2.00 GB');
    expect(formatArchiveSize(null)).toBe('—');
    expect(formatArchiveSize(undefined)).toBe('—');
  });
});
