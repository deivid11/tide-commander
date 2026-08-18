import { describe, it, expect, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as zlib from 'zlib';
import { Readable } from 'stream';
import archiver from 'archiver';
import {
  detectArchiveFormat,
  listZipEntries,
  listTarEntries,
  listArchive,
  parse7zListing,
  parseUnrarListing,
  parseBsdtarListing,
  ARCHIVE_EXTENSIONS,
} from './archive-listing.js';

const tmpFiles: string[] = [];
const tmpFile = (name: string): string => {
  const p = path.join(os.tmpdir(), `tc-archive-test-${Math.random().toString(36).slice(2)}-${name}`);
  tmpFiles.push(p);
  return p;
};
afterAll(() => { for (const f of tmpFiles) { try { fs.unlinkSync(f); } catch { /* gone */ } } });

/** Build a real zip with archiver (a project dependency). */
async function buildZip(target: string, files: Array<{ name: string; content: string; date?: Date }>, dirs: string[] = []): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const out = fs.createWriteStream(target);
    const zip = archiver('zip', { zlib: { level: 6 } });
    out.on('close', () => resolve());
    zip.on('error', reject);
    zip.pipe(out);
    for (const d of dirs) zip.append('', { name: d.endsWith('/') ? d : `${d}/`, date: new Date('2026-08-17T10:00:00Z') });
    for (const f of files) zip.append(f.content, { name: f.name, date: f.date ?? new Date('2026-08-17T12:34:56Z') });
    void zip.finalize();
  });
}

/** Minimal ustar writer for tests (files, dirs, GNU long names, PAX headers). */
function tarHeader(name: string, size: number, typeflag: string, mtimeSec = 1_787_000_000, prefix = ''): Buffer {
  const hdr = Buffer.alloc(512, 0);
  hdr.write(name, 0, 100, 'utf8');
  hdr.write('0000644\0', 100, 8, 'latin1');
  hdr.write('0001000\0', 108, 8, 'latin1');
  hdr.write('0001000\0', 116, 8, 'latin1');
  hdr.write(size.toString(8).padStart(11, '0') + '\0', 124, 12, 'latin1');
  hdr.write(mtimeSec.toString(8).padStart(11, '0') + '\0', 136, 12, 'latin1');
  hdr.write('        ', 148, 8, 'latin1'); // checksum placeholder (spaces)
  hdr.write(typeflag, 156, 1, 'latin1');
  hdr.write('ustar\0', 257, 6, 'latin1');
  hdr.write('00', 263, 2, 'latin1');
  if (prefix) hdr.write(prefix, 345, 155, 'utf8');
  let sum = 0;
  for (const b of hdr) sum += b;
  hdr.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 8, 'latin1');
  return hdr;
}
function tarData(content: Buffer): Buffer {
  const padded = Buffer.alloc(Math.ceil(content.length / 512) * 512, 0);
  content.copy(padded);
  return padded;
}
function buildTar(parts: Buffer[]): Buffer {
  return Buffer.concat([...parts, Buffer.alloc(1024, 0)]);
}
function paxRecord(key: string, value: string): string {
  // "<len> key=value\n" where len counts the whole record including itself.
  const body = ` ${key}=${value}\n`;
  let len = body.length + 1;
  while (String(len).length + body.length !== len) len = String(len).length + body.length;
  return `${len}${body}`;
}

describe('detectArchiveFormat', () => {
  it('classifies zip / tar / single-file / other families and prefers .tar.<comp>', () => {
    expect(detectArchiveFormat('a.zip')).toEqual({ family: 'zip', compression: null, format: 'zip' });
    expect(detectArchiveFormat('app.jar')?.family).toBe('zip');
    expect(detectArchiveFormat('app-debug.apk')?.family).toBe('zip');
    expect(detectArchiveFormat('x.tar')).toEqual({ family: 'tar', compression: null, format: 'tar' });
    expect(detectArchiveFormat('x.tar.gz')).toEqual({ family: 'tar', compression: 'gzip', format: 'tar+gzip' });
    expect(detectArchiveFormat('x.tgz')?.compression).toBe('gzip');
    expect(detectArchiveFormat('x.tar.xz')?.compression).toBe('xz');
    expect(detectArchiveFormat('x.tar.zst')?.compression).toBe('zstd');
    expect(detectArchiveFormat('x.TAR.BZ2')?.compression).toBe('bzip2');
    expect(detectArchiveFormat('log.gz')).toEqual({ family: 'single', compression: 'gzip', format: 'gzip' });
    expect(detectArchiveFormat('model.bin.xz')?.family).toBe('single');
    expect(detectArchiveFormat('x.7z')).toEqual({ family: 'other', compression: null, format: '7z' });
    expect(detectArchiveFormat('x.rar')?.format).toBe('rar');
    expect(detectArchiveFormat('x.iso')?.family).toBe('other');
    expect(detectArchiveFormat('readme.md')).toBeNull();
    expect(detectArchiveFormat('doc.docx')).toBeNull(); // office docs keep their own semantics
    expect(ARCHIVE_EXTENSIONS).toContain('.zip');
    expect(ARCHIVE_EXTENSIONS).toContain('.tar.gz'.slice(4)); // '.gz' is routed (tar.gz + bare gz)
  });
});

describe('listZipEntries (built-in central directory reader)', () => {
  it('lists files and directories with sizes, compressed sizes and mtimes — reading only the tail', async () => {
    const zipPath = tmpFile('basic.zip');
    await buildZip(zipPath, [
      { name: 'README.md', content: 'hello world\n'.repeat(50) },
      { name: 'src/index.ts', content: 'export const x = 1;\n' },
      { name: 'src/util/helpers.ts', content: 'export function h() {}\n' },
      { name: 'ñandú/ünïcode name.txt', content: 'utf8 name' },
    ], ['assets']);

    const { entries, truncated } = await listZipEntries(zipPath);

    expect(truncated).toBe(false);
    const byPath = Object.fromEntries(entries.map((e) => [e.path, e]));
    expect(byPath['README.md'].size).toBe(600);
    expect(byPath['README.md'].compressedSize).toBeLessThan(600); // deflated
    expect(byPath['README.md'].isDir).toBe(false);
    expect(byPath['src/util/helpers.ts'].size).toBe('export function h() {}\n'.length);
    expect(byPath['assets/'].isDir).toBe(true);
    expect(byPath['ñandú/ünïcode name.txt']).toBeDefined();
    expect(byPath['README.md'].mtime).toMatch(/^2026-08-17T/);
  });

  it('rejects a non-zip file with a clear error', async () => {
    const notZip = tmpFile('fake.zip');
    fs.writeFileSync(notZip, 'this is not a zip archive at all, just text that is long enough to scan');
    await expect(listZipEntries(notZip)).rejects.toThrow(/not a zip archive/);
  });
});

describe('listTarEntries (built-in streaming tar parser)', () => {
  it('parses ustar entries, prefixes, dirs, GNU long names and PAX paths', async () => {
    const longName = 'very/deep/' + 'segment/'.repeat(14) + 'file-with-a-long-name.txt'; // > 100 chars
    const paxName = 'pax/' + 'p'.repeat(120) + '.log';
    const paxBody = Buffer.from(paxRecord('path', paxName) + paxRecord('mtime', '1787000123.5'), 'utf8');
    const tarBuf = buildTar([
      tarHeader('dir/', 0, '5'),
      tarHeader('dir/a.txt', 5, '0'), tarData(Buffer.from('hello')),
      tarHeader('b.txt', 3, '0', 1_787_000_000, 'prefixed/path'), tarData(Buffer.from('abc')),
      // GNU long name: 'L' entry carrying the real name, then the file with a truncated name.
      tarHeader('././@LongLink', longName.length + 1, 'L'), tarData(Buffer.from(longName + '\0')),
      tarHeader(longName.slice(0, 99), 4, '0'), tarData(Buffer.from('long')),
      // PAX extended header for the next entry.
      tarHeader('PaxHeader/x', paxBody.length, 'x'), tarData(paxBody),
      tarHeader('pax/truncated.log', 2, '0'), tarData(Buffer.from('ok')),
    ]);

    const { entries, truncated } = await listTarEntries(Readable.from([tarBuf]));

    expect(truncated).toBe(false);
    expect(entries.map((e) => e.path)).toEqual(['dir/', 'dir/a.txt', 'prefixed/path/b.txt', longName, paxName]);
    expect(entries[0].isDir).toBe(true);
    expect(entries[1].size).toBe(5);
    expect(entries[3].size).toBe(4);
    expect(entries[4].mtime).toBe(new Date(1787000123.5 * 1000).toISOString());
    expect(entries[1].mtime).toBe(new Date(1_787_000_000 * 1000).toISOString());
  });

  it('works chunk-by-chunk (headers split across stream chunks) and through gzip', async () => {
    const tarBuf = buildTar([
      tarHeader('one.txt', 3, '0'), tarData(Buffer.from('one')),
      tarHeader('two.txt', 3, '0'), tarData(Buffer.from('two')),
    ]);
    // Feed in awkward 100-byte chunks.
    const chunks: Buffer[] = [];
    for (let i = 0; i < tarBuf.length; i += 100) chunks.push(tarBuf.subarray(i, i + 100));
    const split = await listTarEntries(Readable.from(chunks));
    expect(split.entries.map((e) => e.path)).toEqual(['one.txt', 'two.txt']);

    // And the real thing: a .tar.gz on disk through listArchive (zlib path).
    const tgz = tmpFile('x.tar.gz');
    fs.writeFileSync(tgz, zlib.gzipSync(tarBuf));
    const listing = await listArchive(tgz);
    expect(listing.format).toBe('tar+gzip');
    expect(listing.tool).toBe('builtin');
    expect(listing.entries.map((e) => e.path)).toEqual(['one.txt', 'two.txt']);
  });
});

describe('listArchive dispatch', () => {
  it('lists a zip through the built-in reader (tool = builtin)', async () => {
    const zipPath = tmpFile('dispatch.zip');
    await buildZip(zipPath, [{ name: 'a.txt', content: 'a' }]);
    const listing = await listArchive(zipPath);
    expect(listing.format).toBe('zip');
    expect(listing.tool).toBe('builtin');
    expect(listing.entries).toHaveLength(1);
  });

  it('lists a single-file gzip member (name from FNAME, size from the trailer) even without 7z', async () => {
    const gz = tmpFile('notes.txt.gz');
    // Node's gzip writes no FNAME; the fallback name is the file minus .gz.
    fs.writeFileSync(gz, zlib.gzipSync(Buffer.from('x'.repeat(1234))));
    const listing = await listArchive(gz);
    expect(listing.format).toBe('gzip');
    expect(listing.entries).toHaveLength(1);
    expect(listing.entries[0].size).toBe(1234);
    expect(listing.entries[0].path).toMatch(/notes\.txt$/);
  });

  it('rejects unsupported types', async () => {
    const txt = tmpFile('plain.txt');
    fs.writeFileSync(txt, 'x');
    await expect(listArchive(txt)).rejects.toThrow(/not a supported archive/);
  });
});

describe('CLI listing parsers', () => {
  it('parses `7z l -slt` blocks (Path/Folder/Size/Packed Size/Modified/Attributes)', () => {
    const out = [
      '', '7-Zip [64] 16.02', '', 'Scanning the drive for archives:', 'Listing archive: x.7z', '',
      '--', 'Path = x.7z', 'Type = 7z', 'Physical Size = 200', '', '----------',
      'Path = docs', 'Size = 0', 'Packed Size = 0', 'Modified = 2026-08-17 10:00:00', 'Attributes = D_ drwxr-xr-x', 'Folder = +', '',
      'Path = docs/readme.md', 'Size = 1024', 'Packed Size = 400', 'Modified = 2026-08-17 12:00:01', 'Attributes = A_ -rw-r--r--', 'CRC = ABCDEF01', '',
      'Path = bin\\tool.exe', 'Size = 2048', 'Packed Size = ', 'Modified = ', 'Attributes = A', '',
    ].join('\n');
    const entries = parse7zListing(out);
    expect(entries.map((e) => e.path)).toEqual(['docs', 'docs/readme.md', 'bin/tool.exe']);
    expect(entries[0].isDir).toBe(true);
    expect(entries[1]).toMatchObject({ isDir: false, size: 1024, compressedSize: 400 });
    expect(entries[1].mtime).toMatch(/^2026-08-17T/);
    expect(entries[2]).toMatchObject({ size: 2048, compressedSize: null, mtime: null });
  });

  it('parses `unrar lt` blocks', () => {
    const out = [
      'UNRAR 6.24 freeware', '', 'Archive: x.rar', 'Details: RAR 5', '',
      '        Name: folder', '        Type: Directory', '       mtime: 2026-08-17 10:00:00,000000000', '  Attributes: drwxr-xr-x', '',
      '        Name: folder/data.csv', '        Type: File', '        Size: 5000', ' Packed size: 1200', '       Ratio: 24%', '       mtime: 2026-08-17 12:00:00,000000000', '  Attributes: -rw-r--r--', '       CRC32: 12345678', '',
    ].join('\n');
    const entries = parseUnrarListing(out);
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({ path: 'folder', isDir: true });
    expect(entries[1]).toMatchObject({ path: 'folder/data.csv', isDir: false, size: 5000, compressedSize: 1200 });
    expect(entries[1].mtime).toMatch(/^2026-08-17T/);
  });

  it('parses `bsdtar -tvf` ls-style lines (with and without year, symlinks)', () => {
    const out = [
      'drwxr-xr-x  0 riven riven       0 Aug 17 12:00 pkg/',
      '-rw-r--r--  0 riven riven    4096 Aug 17 12:01 pkg/lib.so',
      '-rw-r--r--  0 riven riven      12 Jan  3  2024 pkg/OLD',
      'lrwxr-xr-x  0 riven riven       0 Aug 17 12:02 pkg/link -> lib.so',
      'garbage line',
    ].join('\n');
    const entries = parseBsdtarListing(out);
    expect(entries.map((e) => e.path)).toEqual(['pkg', 'pkg/lib.so', 'pkg/OLD', 'pkg/link']);
    expect(entries[0].isDir).toBe(true);
    expect(entries[1].size).toBe(4096);
    expect(entries[2].mtime).toMatch(/^2024-01-03/);
  });
});
