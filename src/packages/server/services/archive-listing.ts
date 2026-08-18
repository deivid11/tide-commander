/**
 * Archive listing — enumerate the entries of a compressed archive WITHOUT
 * extracting it, for the file viewers (FileViewerModal, guake diff modal).
 *
 * Strategy per format family (best available first, then fallbacks):
 *  - zip family (.zip .jar .war .apk .whl …): built-in central-directory
 *    reader — reads only the tail of the file (EOCD + central directory,
 *    zip64 aware), so a multi-GB archive lists in milliseconds.
 *  - tar family (.tar .tar.gz .tgz .tar.xz .tar.bz2 .tar.zst …): built-in
 *    streaming tar header parser (ustar / GNU longname / PAX), fed by zlib for
 *    gzip or by the matching decompressor CLI (xz, bzip2, zstd, lz4, lzip,
 *    gzip for .Z) — `7z x -so` as a second-chance decompressor.
 *  - everything else (.7z .rar .cab .iso .deb .rpm .dmg …) and any built-in
 *    failure: `7z l -slt` (structured), then `unrar lt`, then `bsdtar -tvf`.
 *  - single-file compression (.gz .bz2 .xz .zst … not a tar): one entry —
 *    `7z l -slt` when present, gzip header/trailer read in-process otherwise.
 *
 * Every path is fail-soft: a missing tool or a corrupt container yields the
 * next strategy, and the final error names what would have been needed.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import { execFile, spawn } from 'child_process';
import type { Readable } from 'stream';
import {
  ARCHIVE_EXTENSIONS,
  ZIP_ARCHIVE_EXTENSIONS,
  OTHER_ARCHIVE_EXTENSIONS,
  COMPRESSION_BY_EXTENSION,
  TAR_SHORTHAND_EXTENSIONS,
  type ArchiveCompression,
} from '../../shared/archive-types.js';

export interface ArchiveEntry {
  /** Entry path inside the archive (forward slashes, no leading `./`). */
  path: string;
  isDir: boolean;
  /** Uncompressed size; null when the container does not record it. */
  size: number | null;
  /** Stored/compressed size; null when unknown or not applicable. */
  compressedSize: number | null;
  /** Modification time (ISO 8601); null when unknown. */
  mtime: string | null;
}

export interface ArchiveListing {
  /** Human label of the container, e.g. `zip`, `tar+gzip`, `7z`, `rar`, `gzip`. */
  format: string;
  /** Which strategy produced the listing: `builtin`, `7z`, `unrar`, `bsdtar`. */
  tool: string;
  entries: ArchiveEntry[];
  /** True when the listing stopped at ARCHIVE_ENTRY_CAP entries. */
  truncated: boolean;
}

/** Entry cap — keeps the JSON payload and the tree render bounded. */
export const ARCHIVE_ENTRY_CAP = 20_000;

/** Decompressed-byte budget for streaming tar listings (a listing of a
 * multi-GB tarball would otherwise run for minutes). */
const TAR_STREAM_BYTE_BUDGET = 4 * 1024 * 1024 * 1024;

type Compression = ArchiveCompression;

export interface ArchiveFormat {
  family: 'zip' | 'tar' | 'single' | 'other';
  compression: Compression | null;
  /** Display label. */
  format: string;
}

const ZIP_EXTENSIONS = new Set(ZIP_ARCHIVE_EXTENSIONS);
const OTHER_EXTENSIONS = new Set(OTHER_ARCHIVE_EXTENSIONS);
const COMPRESSION_BY_EXT = COMPRESSION_BY_EXTENSION;
const TAR_SHORTHAND = TAR_SHORTHAND_EXTENSIONS;

export { ARCHIVE_EXTENSIONS };

/**
 * Classify a filename. Returns null when it is not an archive we list.
 * `.tar.<comp>` beats bare `.<comp>`; `.Z` is matched case-insensitively.
 */
export function detectArchiveFormat(filename: string): ArchiveFormat | null {
  const lower = filename.toLowerCase();
  const ext = path.extname(lower);
  if (ZIP_EXTENSIONS.has(ext)) return { family: 'zip', compression: null, format: 'zip' };
  if (OTHER_EXTENSIONS.has(ext)) return { family: 'other', compression: null, format: ext.slice(1) };
  if (ext in TAR_SHORTHAND) {
    const c = TAR_SHORTHAND[ext];
    return { family: 'tar', compression: c, format: c ? `tar+${c}` : 'tar' };
  }
  if (ext in COMPRESSION_BY_EXT) {
    const c = COMPRESSION_BY_EXT[ext];
    const inner = path.extname(lower.slice(0, -ext.length));
    if (inner === '.tar') return { family: 'tar', compression: c, format: `tar+${c}` };
    return { family: 'single', compression: c, format: c };
  }
  return null;
}

// ── zip: central-directory reader ───────────────────────────────────────────

const SIG_EOCD = 0x06054b50;
const SIG_EOCD64_LOCATOR = 0x07064b50;
const SIG_EOCD64 = 0x06064b50;
const SIG_CENTRAL = 0x02014b50;
const MAX_CENTRAL_DIRECTORY_BYTES = 256 * 1024 * 1024;

function dosDateTimeToIso(dosTime: number, dosDate: number): string | null {
  if (!dosDate) return null;
  const year = ((dosDate >> 9) & 0x7f) + 1980;
  const month = (dosDate >> 5) & 0x0f;
  const day = dosDate & 0x1f;
  const hour = (dosTime >> 11) & 0x1f;
  const minute = (dosTime >> 5) & 0x3f;
  const second = (dosTime & 0x1f) * 2;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const d = new Date(year, month - 1, day, hour, minute, second); // DOS times are local
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function decodeZipName(bytes: Buffer, utf8Flag: boolean): string {
  if (utf8Flag) return bytes.toString('utf8');
  // Not flagged: most modern zips are still UTF-8. Accept it when it decodes
  // cleanly, else fall back to latin1 (a readable approximation of CP437).
  const utf8 = bytes.toString('utf8');
  return utf8.includes('�') ? bytes.toString('latin1') : utf8;
}

async function readAt(fd: fs.promises.FileHandle, position: number, length: number): Promise<Buffer> {
  const buf = Buffer.alloc(length);
  let done = 0;
  while (done < length) {
    const { bytesRead } = await fd.read(buf, done, length - done, position + done);
    if (bytesRead === 0) break;
    done += bytesRead;
  }
  return done === length ? buf : buf.subarray(0, done);
}

/** Read a zip's central directory. Throws when no EOCD is found (not a zip). */
export async function listZipEntries(filePath: string): Promise<{ entries: ArchiveEntry[]; truncated: boolean }> {
  const fd = await fs.promises.open(filePath, 'r');
  try {
    const { size } = await fd.stat();
    if (size < 22) throw new Error('not a zip archive (too small)');
    // EOCD is within the last 22 + 65535 (comment) bytes.
    const tailLen = Math.min(size, 22 + 0xffff);
    const tail = await readAt(fd, size - tailLen, tailLen);
    let eocdPos = -1;
    for (let i = tail.length - 22; i >= 0; i--) {
      if (tail.readUInt32LE(i) === SIG_EOCD) { eocdPos = i; break; }
    }
    if (eocdPos < 0) throw new Error('not a zip archive (no end-of-central-directory record)');
    let totalEntries: number = tail.readUInt16LE(eocdPos + 10);
    let cdSize: number = tail.readUInt32LE(eocdPos + 12);
    let cdOffset: number = tail.readUInt32LE(eocdPos + 16);

    // Zip64: the locator sits right before the EOCD.
    if (totalEntries === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
      const locPos = eocdPos - 20;
      if (locPos >= 0 && tail.readUInt32LE(locPos) === SIG_EOCD64_LOCATOR) {
        const eocd64Offset = Number(tail.readBigUInt64LE(locPos + 8));
        const rec = await readAt(fd, eocd64Offset, 56);
        if (rec.length >= 56 && rec.readUInt32LE(0) === SIG_EOCD64) {
          totalEntries = Number(rec.readBigUInt64LE(32));
          cdSize = Number(rec.readBigUInt64LE(40));
          cdOffset = Number(rec.readBigUInt64LE(48));
        }
      }
    }
    if (cdSize > MAX_CENTRAL_DIRECTORY_BYTES) throw new Error('zip central directory too large to list');
    if (cdOffset + cdSize > size) throw new Error('corrupt zip (central directory beyond end of file)');

    const cd = await readAt(fd, cdOffset, cdSize);
    const entries: ArchiveEntry[] = [];
    let pos = 0;
    let truncated = false;
    while (pos + 46 <= cd.length && cd.readUInt32LE(pos) === SIG_CENTRAL) {
      const flags = cd.readUInt16LE(pos + 8);
      const dosTime = cd.readUInt16LE(pos + 12);
      const dosDate = cd.readUInt16LE(pos + 14);
      let csize: number = cd.readUInt32LE(pos + 20);
      let usize: number = cd.readUInt32LE(pos + 24);
      const nameLen = cd.readUInt16LE(pos + 28);
      const extraLen = cd.readUInt16LE(pos + 30);
      const commentLen = cd.readUInt16LE(pos + 32);
      const extAttr = cd.readUInt32LE(pos + 38);
      const nameBytes = cd.subarray(pos + 46, pos + 46 + nameLen);
      const extra = cd.subarray(pos + 46 + nameLen, pos + 46 + nameLen + extraLen);
      let mtime = dosDateTimeToIso(dosTime, dosDate);

      // Extra fields: zip64 sizes (0x0001) and extended timestamp (0x5455).
      let ep = 0;
      while (ep + 4 <= extra.length) {
        const id = extra.readUInt16LE(ep);
        const len = extra.readUInt16LE(ep + 2);
        const body = extra.subarray(ep + 4, ep + 4 + len);
        if (id === 0x0001) {
          let bp = 0;
          if (usize === 0xffffffff && bp + 8 <= body.length) { usize = Number(body.readBigUInt64LE(bp)); bp += 8; }
          if (csize === 0xffffffff && bp + 8 <= body.length) { csize = Number(body.readBigUInt64LE(bp)); bp += 8; }
        } else if (id === 0x5455 && body.length >= 5 && (body[0] & 1)) {
          mtime = new Date(body.readInt32LE(1) * 1000).toISOString();
        }
        ep += 4 + len;
      }

      const name = decodeZipName(nameBytes, (flags & 0x800) !== 0);
      const unixMode = (extAttr >>> 16) & 0xffff;
      const isDir = name.endsWith('/') || (unixMode & 0o170000) === 0o040000 || (extAttr & 0x10) !== 0;
      entries.push({
        path: name.replace(/^\.\//, ''),
        isDir,
        size: usize,
        compressedSize: csize,
        mtime,
      });
      if (entries.length >= ARCHIVE_ENTRY_CAP) { truncated = true; break; }
      pos += 46 + nameLen + extraLen + commentLen;
    }
    if (entries.length === 0 && totalEntries > 0) throw new Error('corrupt zip (unreadable central directory)');
    return { entries, truncated };
  } finally {
    await fd.close();
  }
}

// ── tar: streaming header parser ────────────────────────────────────────────

const TAR_BLOCK = 512;

function parseOctalOrBase256(field: Buffer): number {
  if (field.length > 0 && (field[0] & 0x80) !== 0) {
    // GNU base-256 (for sizes ≥ 8 GiB): big-endian, first bit is the marker.
    let n = 0;
    for (let i = 0; i < field.length; i++) n = n * 256 + (i === 0 ? field[i] & 0x7f : field[i]);
    return n;
  }
  const str = field.toString('latin1').replace(/\0.*$/, '').trim();
  return str ? parseInt(str, 8) || 0 : 0;
}

function tarString(field: Buffer): string {
  const end = field.indexOf(0);
  return (end === -1 ? field : field.subarray(0, end)).toString('utf8');
}

/**
 * Consume a tar byte stream and collect its entries. Handles ustar prefix,
 * GNU long name/link (L/K), PAX extended headers (x; global g ignored) and
 * base-256 sizes. Stops at the end-of-archive zero blocks, at the entry cap,
 * or at the byte budget.
 */
export async function listTarEntries(stream: Readable): Promise<{ entries: ArchiveEntry[]; truncated: boolean }> {
  const entries: ArchiveEntry[] = [];
  let truncated = false;
  let pending = Buffer.alloc(0);   // bytes not yet consumed
  let skip = 0;                    // data bytes of the current entry still to drop
  let consumed = 0;                // decompressed bytes seen (budget)
  let zeroBlocks = 0;
  let longName: string | null = null;
  let paxNext: Record<string, string> | null = null;
  type CollectData = { size: number; buf: Buffer[]; kind: 'L' | 'K' | 'x' };
  let collectData: CollectData | null = null;
  let done = false;

  const finishData = () => {
    if (!collectData) return;
    const data = Buffer.concat(collectData.buf).subarray(0, collectData.size);
    if (collectData.kind === 'L') longName = tarString(data);
    else if (collectData.kind === 'x') {
      paxNext = paxNext ?? {};
      // PAX records: "<len> <key>=<value>\n"
      let p = 0;
      const text = data.toString('utf8');
      while (p < text.length) {
        const sp = text.indexOf(' ', p);
        if (sp === -1) break;
        const len = parseInt(text.slice(p, sp), 10);
        if (!len || len <= 0) break;
        const rec = text.slice(sp + 1, p + len - 1);
        const eq = rec.indexOf('=');
        if (eq > 0) paxNext[rec.slice(0, eq)] = rec.slice(eq + 1);
        p += len;
      }
    }
    collectData = null;
  };

  const processHeader = (hdr: Buffer): void => {
    if (hdr.every((b) => b === 0)) {
      zeroBlocks++;
      if (zeroBlocks >= 2) done = true;
      return;
    }
    zeroBlocks = 0;
    const size = parseOctalOrBase256(hdr.subarray(124, 136));
    const typeflag = String.fromCharCode(hdr[156] || 0x30);
    const dataBlocks = Math.ceil(size / TAR_BLOCK) * TAR_BLOCK;

    if (typeflag === 'L' || typeflag === 'K' || typeflag === 'x') {
      collectData = { size, buf: [], kind: typeflag };
      skip = dataBlocks;
      return;
    }
    if (typeflag === 'g') { skip = dataBlocks; return; } // global PAX: ignore

    let name = tarString(hdr.subarray(0, 100));
    const magic = hdr.subarray(257, 262).toString('latin1');
    if (magic === 'ustar') {
      const prefix = tarString(hdr.subarray(345, 500));
      if (prefix) name = `${prefix}/${name}`;
    }
    if (longName) { name = longName; longName = null; }
    let mtimeSec = parseOctalOrBase256(hdr.subarray(136, 148));
    let entrySize = size;
    if (paxNext) {
      if (paxNext.path) name = paxNext.path;
      if (paxNext.size) entrySize = parseInt(paxNext.size, 10) || entrySize;
      if (paxNext.mtime) mtimeSec = parseFloat(paxNext.mtime) || mtimeSec;
      paxNext = null;
    }
    const isDir = typeflag === '5' || name.endsWith('/');
    entries.push({
      path: name.replace(/^\.\//, ''),
      isDir,
      size: isDir ? 0 : entrySize,
      compressedSize: null,
      mtime: mtimeSec ? new Date(mtimeSec * 1000).toISOString() : null,
    });
    if (entries.length >= ARCHIVE_ENTRY_CAP) { truncated = true; done = true; return; }
    skip = dataBlocks;
  };

  for await (const chunk of stream) {
    if (done) break;
    let buf = chunk as Buffer;
    consumed += buf.length;
    if (consumed > TAR_STREAM_BYTE_BUDGET) { truncated = true; break; }
    while (buf.length > 0 && !done) {
      if (skip > 0) {
        const take = Math.min(skip, buf.length);
        // (assigned inside processHeader — a closure TS's flow analysis can't see)
        const collecting = collectData as CollectData | null;
        if (collecting) collecting.buf.push(buf.subarray(0, take));
        skip -= take;
        buf = buf.subarray(take);
        if (skip === 0) finishData();
        continue;
      }
      if (pending.length + buf.length < TAR_BLOCK) {
        pending = Buffer.concat([pending, buf]);
        buf = Buffer.alloc(0);
        break;
      }
      const need = TAR_BLOCK - pending.length;
      const hdr = pending.length ? Buffer.concat([pending, buf.subarray(0, need)]) : buf.subarray(0, need);
      pending = Buffer.alloc(0);
      buf = buf.subarray(need);
      processHeader(hdr);
    }
  }
  return { entries, truncated };
}

// ── CLI helpers ─────────────────────────────────────────────────────────────

const CLI_ENV = { ...process.env, LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8' };

function runTool(cmd: string, args: string[], timeoutMs = 60_000): Promise<{ stdout: string; code: number }> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { env: CLI_ENV, maxBuffer: 64 * 1024 * 1024, timeout: timeoutMs }, (err, stdout) => {
      if (err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
        reject(Object.assign(new Error(`${cmd} not installed`), { code: 'ENOENT' }));
        return;
      }
      // Non-zero exit still often carries a usable listing (warnings) — let
      // the parser decide; a totally empty result is treated as failure.
      const code = err && typeof (err as any).code === 'number' ? (err as any).code : err ? 1 : 0;
      resolve({ stdout: String(stdout ?? ''), code });
    });
  });
}

const DECOMPRESSOR: Record<Compression, [string, string[]]> = {
  gzip: ['gzip', ['-dc']],
  bzip2: ['bzip2', ['-dc']],
  xz: ['xz', ['-dc']],
  zstd: ['zstd', ['-dc', '-q']],
  lz4: ['lz4', ['-dc']],
  lzip: ['lzip', ['-dc']],
  lzma: ['xz', ['--format=lzma', '-dc']],
  compress: ['gzip', ['-dc']],
};

/** Open a decompressed byte stream for a compressed tar. gzip is in-process
 * (zlib); everything else spawns the native tool, then `7z x -so`. */
async function openDecompressedStream(filePath: string, compression: Compression | null): Promise<{ stream: Readable; cleanup: () => void }> {
  if (!compression) {
    return { stream: fs.createReadStream(filePath), cleanup: () => {} };
  }
  if (compression === 'gzip') {
    const gunzip = zlib.createGunzip();
    const file = fs.createReadStream(filePath);
    file.on('error', (e) => gunzip.destroy(e));
    return { stream: file.pipe(gunzip), cleanup: () => { file.destroy(); gunzip.destroy(); } };
  }
  const candidates: Array<[string, string[]]> = [DECOMPRESSOR[compression], ['7z', ['x', '-so', filePath]]];
  let lastErr: Error | null = null;
  for (const [cmd, args] of candidates) {
    const useStdin = cmd !== '7z';
    try {
      const child = spawn(cmd, args, { env: CLI_ENV, stdio: [useStdin ? 'pipe' : 'ignore', 'pipe', 'ignore'] });
      // ENOENT surfaces asynchronously — wait for spawn or error.
      await new Promise<void>((resolve, reject) => {
        child.once('spawn', () => resolve());
        child.once('error', (e) => reject(e));
      });
      let file: fs.ReadStream | null = null;
      if (useStdin) {
        file = fs.createReadStream(filePath);
        file.pipe(child.stdin!);
        file.on('error', () => child.kill());
        child.stdin!.on('error', () => { /* consumer closed early */ });
      }
      return {
        stream: child.stdout!,
        cleanup: () => { file?.destroy(); child.kill(); },
      };
    } catch (e) {
      lastErr = e as Error;
    }
  }
  throw new Error(`no decompressor for ${compression} (install ${DECOMPRESSOR[compression][0]} or 7z): ${lastErr?.message ?? ''}`);
}

/** `7z l -slt`: structured blocks after a `----------` line. */
export function parse7zListing(stdout: string): ArchiveEntry[] {
  const lines = stdout.split(/\r?\n/);
  const start = lines.findIndex((l) => /^-{5,}$/.test(l.trim()));
  if (start === -1) return [];
  const entries: ArchiveEntry[] = [];
  let cur: Record<string, string> | null = null;
  const flush = () => {
    if (cur && cur.Path !== undefined) {
      const attrs = cur.Attributes || '';
      const isDir = cur.Folder === '+' || attrs.startsWith('D') || /^D/.test(attrs);
      const size = cur.Size !== undefined && cur.Size !== '' ? Number(cur.Size) : null;
      const packed = cur['Packed Size'] !== undefined && cur['Packed Size'] !== '' ? Number(cur['Packed Size']) : null;
      const mtime = cur.Modified ? new Date(cur.Modified.replace(' ', 'T')).toISOString() : null;
      entries.push({
        path: cur.Path.replace(/\\/g, '/'),
        isDir,
        size: Number.isFinite(size as number) ? size : null,
        compressedSize: Number.isFinite(packed as number) ? packed : null,
        mtime: mtime && mtime !== 'Invalid Date' ? mtime : null,
      });
    }
    cur = null;
  };
  for (const raw of lines.slice(start + 1)) {
    const line = raw.trimEnd();
    if (!line.trim()) { flush(); continue; }
    const eq = line.indexOf(' = ');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 3);
    if (key === 'Path') { flush(); cur = {}; }
    if (cur) cur[key] = value;
  }
  flush();
  return entries;
}

/** `unrar lt`: labelled blocks (`Name:`, `Type:`, `Size:`, `Packed size:`, `mtime:`). */
export function parseUnrarListing(stdout: string): ArchiveEntry[] {
  const entries: ArchiveEntry[] = [];
  let cur: Record<string, string> | null = null;
  const flush = () => {
    if (cur && cur.Name) {
      const size = cur.Size ? Number(cur.Size) : null;
      const packed = cur['Packed size'] ? Number(cur['Packed size']) : null;
      const m = cur.mtime ? new Date(cur.mtime.replace(',', '.').replace(' ', 'T')) : null;
      entries.push({
        path: cur.Name.replace(/\\/g, '/'),
        isDir: /^dir/i.test(cur.Type || ''),
        size: Number.isFinite(size as number) ? size : null,
        compressedSize: Number.isFinite(packed as number) ? packed : null,
        mtime: m && !Number.isNaN(m.getTime()) ? m.toISOString() : null,
      });
    }
    cur = null;
  };
  for (const raw of stdout.split(/\r?\n/)) {
    const m = /^\s*([A-Za-z][A-Za-z ]*?):\s(.*)$/.exec(raw);
    if (!m) { if (!raw.trim()) flush(); continue; }
    const key = m[1].trim();
    if (key === 'Name') { flush(); cur = {}; }
    if (cur) cur[key] = m[2].trim();
  }
  flush();
  return entries;
}

/** `bsdtar -tvf` (ls -l style): `perms links user group size Mon DD (YYYY|HH:MM) name[ -> target]`. */
export function parseBsdtarListing(stdout: string): ArchiveEntry[] {
  const entries: ArchiveEntry[] = [];
  const re = /^([-dlbcps][-rwxsStT]{9})\s+\d+\s+\S+\s+\S+\s+(\d+)\s+([A-Za-z]{3}\s+\d{1,2}\s+(?:\d{4}|\d{1,2}:\d{2}))\s+(.+)$/;
  const now = new Date();
  for (const raw of stdout.split(/\r?\n/)) {
    const m = re.exec(raw.trimEnd());
    if (!m) continue;
    const isDir = m[1].startsWith('d');
    let name = m[4];
    if (m[1].startsWith('l')) name = name.replace(/\s->\s.*$/, '');
    // "Aug 17 12:00" (this year) or "Aug 17 2024".
    const [mon, day, tail] = m[3].split(/\s+/);
    const hasYear = /^\d{4}$/.test(tail);
    const stamp = new Date(`${mon} ${day} ${hasYear ? tail : now.getFullYear()}${hasYear ? '' : ` ${tail}`}`);
    entries.push({
      path: name.replace(/\/$/, ''),
      isDir,
      size: isDir ? 0 : Number(m[2]),
      compressedSize: null,
      mtime: Number.isNaN(stamp.getTime()) ? null : stamp.toISOString(),
    });
  }
  return entries;
}

function cap(entries: ArchiveEntry[]): { entries: ArchiveEntry[]; truncated: boolean } {
  return entries.length > ARCHIVE_ENTRY_CAP
    ? { entries: entries.slice(0, ARCHIVE_ENTRY_CAP), truncated: true }
    : { entries, truncated: false };
}

async function listVia7z(filePath: string): Promise<{ entries: ArchiveEntry[]; truncated: boolean }> {
  const { stdout } = await runTool('7z', ['l', '-slt', filePath]).catch(async (e) => {
    if (e.code === 'ENOENT') return runTool('7za', ['l', '-slt', filePath]);
    throw e;
  });
  const entries = parse7zListing(stdout);
  if (entries.length === 0) throw new Error(/Can not open|Unsupported|ERROR/i.test(stdout) ? '7z could not read the archive' : '7z listed no entries');
  return cap(entries);
}

async function listViaUnrar(filePath: string): Promise<{ entries: ArchiveEntry[]; truncated: boolean }> {
  const { stdout } = await runTool('unrar', ['lt', '-p-', filePath]);
  const entries = parseUnrarListing(stdout);
  if (entries.length === 0) throw new Error('unrar could not read the archive');
  return cap(entries);
}

async function listViaBsdtar(filePath: string): Promise<{ entries: ArchiveEntry[]; truncated: boolean }> {
  const { stdout } = await runTool('bsdtar', ['-tvf', filePath]);
  const entries = parseBsdtarListing(stdout);
  if (entries.length === 0) throw new Error('bsdtar could not read the archive');
  return cap(entries);
}

/** Single-file gzip member: original name from the FNAME header field, size
 * from the ISIZE trailer (mod 2^32 — exact below 4 GiB). */
async function listGzipMember(filePath: string): Promise<{ entries: ArchiveEntry[]; truncated: boolean }> {
  const fd = await fs.promises.open(filePath, 'r');
  try {
    const { size } = await fd.stat();
    const head = await readAt(fd, 0, Math.min(size, 4096));
    if (head.length < 10 || head[0] !== 0x1f || head[1] !== 0x8b) throw new Error('not a gzip file');
    const flg = head[3];
    const mtimeSec = head.readUInt32LE(4);
    let p = 10;
    if (flg & 0x04) { const xlen = head.readUInt16LE(p); p += 2 + xlen; } // FEXTRA
    let name: string | null = null;
    if (flg & 0x08) { // FNAME
      const end = head.indexOf(0, p);
      name = head.subarray(p, end === -1 ? head.length : end).toString('latin1');
    }
    const trailer = await readAt(fd, size - 8, 8);
    const isize = trailer.length === 8 ? trailer.readUInt32LE(4) : null;
    const fallback = path.basename(filePath).replace(/\.(gz|z)$/i, '');
    return {
      entries: [{ path: name || fallback, isDir: false, size: isize, compressedSize: size, mtime: mtimeSec ? new Date(mtimeSec * 1000).toISOString() : null }],
      truncated: false,
    };
  } finally {
    await fd.close();
  }
}

/**
 * List an archive's entries. Throws with a user-facing message when no
 * strategy could read it (unsupported container / missing tool / corrupt).
 */
export async function listArchive(filePath: string): Promise<ArchiveListing> {
  const fmt = detectArchiveFormat(path.basename(filePath));
  if (!fmt) throw new Error('not a supported archive type');
  const errors: string[] = [];
  const attempt = async (tool: string, fn: () => Promise<{ entries: ArchiveEntry[]; truncated: boolean }>): Promise<ArchiveListing | null> => {
    try {
      const r = await fn();
      return { format: fmt.format, tool, entries: r.entries, truncated: r.truncated };
    } catch (e) {
      errors.push(`${tool}: ${(e as Error).message}`);
      return null;
    }
  };

  if (fmt.family === 'zip') {
    return (await attempt('builtin', () => listZipEntries(filePath)))
      ?? (await attempt('7z', () => listVia7z(filePath)))
      ?? (await attempt('bsdtar', () => listViaBsdtar(filePath)))
      ?? fail(errors);
  }
  if (fmt.family === 'tar') {
    const builtin = await attempt('builtin', async () => {
      const { stream, cleanup } = await openDecompressedStream(filePath, fmt.compression);
      try {
        return await listTarEntries(stream);
      } finally {
        cleanup();
      }
    });
    if (builtin && builtin.entries.length > 0) return builtin;
    if (builtin) errors.push('builtin: no entries found');
    return (await attempt('bsdtar', () => listViaBsdtar(filePath)))
      ?? (await attempt('7z', () => listVia7z(filePath)))
      ?? fail(errors);
  }
  if (fmt.family === 'single') {
    return (await attempt('7z', () => listVia7z(filePath)))
      ?? (fmt.compression === 'gzip' || fmt.compression === 'compress' ? await attempt('builtin', () => listGzipMember(filePath)) : null)
      ?? {
        format: fmt.format,
        tool: 'name',
        entries: [{ path: path.basename(filePath).replace(/\.[^.]+$/, ''), isDir: false, size: null, compressedSize: fs.statSync(filePath).size, mtime: null }],
        truncated: false,
      };
  }
  // 7z, rar, iso, cab, deb, rpm, dmg, …
  const isRar = /\.(rar|cbr)$/i.test(filePath);
  return (isRar ? await attempt('unrar', () => listViaUnrar(filePath)) : null)
    ?? (await attempt('7z', () => listVia7z(filePath)))
    ?? (!isRar ? await attempt('unrar', () => listViaUnrar(filePath)) : null)
    ?? (await attempt('bsdtar', () => listViaBsdtar(filePath)))
    ?? fail(errors);
}

function fail(errors: string[]): never {
  throw new Error(`Could not list archive — ${errors.join('; ')}`);
}
