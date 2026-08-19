/**
 * Spreadsheet parsing for the file viewers — dependency-free.
 *
 * - `.xlsx` / `.xlsm` (OOXML): the file is a zip; the workbook, its shared
 *   strings, styles and one worksheet are inflated with node's zlib and read
 *   with a tolerant tag scanner (no XML library — the subset Excel/LibreOffice/
 *   openpyxl emit is regular enough). Dates are decoded from their serial +
 *   number format, percentages rendered as such, everything else as the
 *   display text Excel would show.
 * - `.csv` / `.tsv`: RFC 4180-ish parser (quotes, doubled quotes, embedded
 *   newlines), delimiter sniffed for .csv (`,` `;` tab `|`), utf-8 with BOM
 *   or latin1 fallback.
 * - `.xls` (BIFF5/BIFF8): CFB container + BIFF records — see spreadsheet-biff.ts.
 * - `.ods`: zip + content.xml, repeated rows/columns collapsed, rendered
 *   paragraph text preferred over raw values.
 * - Content is SNIFFED before dispatch (`sniffSpreadsheetBuffer`): a ".xls"
 *   that is really CSV or an HTML table (bank portals do this constantly)
 *   still opens; only BIFF2-4 worksheets are refused with a message.
 *
 * Only ONE sheet's grid is materialized per call (`sheetIndex`) and it is
 * capped (`maxRows` × `maxCols`); the sheet list is always complete. The
 * caller decides the caps, this module reports the real extent so the UI can
 * say "showing 500 of 12,340 rows".
 */

import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { classifyNumberFormat, formatGeneralNumber, formatPercent, formatSerialDate, type NumberFormat } from './spreadsheet-format.js';
import { isBiffLegacyStream, isCfbBuffer, parseXlsBuffer } from './spreadsheet-biff.js';
import {
  DELIMITED_EXTENSIONS,
  LEGACY_SPREADSHEET_EXTENSIONS,
  XLSX_EXTENSIONS,
  type SpreadsheetFormat,
  type SpreadsheetSheetData,
  type SpreadsheetSheetInfo,
} from '../../shared/spreadsheet-types.js';

export const SPREADSHEET_DEFAULT_MAX_ROWS = 500;
export const SPREADSHEET_HARD_MAX_ROWS = 20_000;
export const SPREADSHEET_DEFAULT_MAX_COLS = 100;
export const SPREADSHEET_HARD_MAX_COLS = 500;
/** Inflated size cap for any single zip member (a worksheet XML). */
const MAX_MEMBER_BYTES = 256 * 1024 * 1024;

export interface ParseOptions {
  sheetIndex?: number;
  maxRows?: number;
  maxCols?: number;
}

export interface ParsedSpreadsheet {
  format: SpreadsheetFormat;
  delimiter?: string;
  sheets: SpreadsheetSheetInfo[];
  sheetIndex: number;
  sheet: SpreadsheetSheetData;
}

export class UnsupportedSpreadsheetError extends Error {
  constructor(message: string, public readonly extension: string) {
    super(message);
    this.name = 'UnsupportedSpreadsheetError';
  }
}

export type SpreadsheetKind = 'xlsx' | 'csv' | 'tsv' | 'legacy';

export function detectSpreadsheetKind(filename: string): SpreadsheetKind | null {
  const ext = path.extname(filename).toLowerCase();
  if ((XLSX_EXTENSIONS as readonly string[]).includes(ext)) return 'xlsx';
  if ((DELIMITED_EXTENSIONS as readonly string[]).includes(ext)) return ext === '.tsv' ? 'tsv' : 'csv';
  if ((LEGACY_SPREADSHEET_EXTENSIONS as readonly string[]).includes(ext)) return 'legacy';
  return null;
}

function clampCaps(opts: ParseOptions): { maxRows: number; maxCols: number } {
  const maxRows = Math.min(SPREADSHEET_HARD_MAX_ROWS, Math.max(1, Math.floor(opts.maxRows ?? SPREADSHEET_DEFAULT_MAX_ROWS)));
  const maxCols = Math.min(SPREADSHEET_HARD_MAX_COLS, Math.max(1, Math.floor(opts.maxCols ?? SPREADSHEET_DEFAULT_MAX_COLS)));
  return { maxRows, maxCols };
}

// ── zip (in memory) ─────────────────────────────────────────────────────────

const SIG_EOCD = 0x06054b50;
const SIG_EOCD64_LOCATOR = 0x07064b50;
const SIG_EOCD64 = 0x06064b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_LOCAL = 0x04034b50;

interface ZipMember {
  name: string;
  method: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
}

/** Parse a central directory blob into members (offsets are absolute file offsets). */
function parseCentralDirectory(cd: Buffer): Map<string, ZipMember> {
  const members = new Map<string, ZipMember>();
  let pos = 0;
  while (pos + 46 <= cd.length && cd.readUInt32LE(pos) === SIG_CENTRAL) {
    const flags = cd.readUInt16LE(pos + 8);
    const method = cd.readUInt16LE(pos + 10);
    let csize: number = cd.readUInt32LE(pos + 20);
    let usize: number = cd.readUInt32LE(pos + 24);
    const nameLen = cd.readUInt16LE(pos + 28);
    const extraLen = cd.readUInt16LE(pos + 30);
    const commentLen = cd.readUInt16LE(pos + 32);
    let localHeaderOffset: number = cd.readUInt32LE(pos + 42);
    const nameBytes = cd.subarray(pos + 46, pos + 46 + nameLen);
    const extra = cd.subarray(pos + 46 + nameLen, pos + 46 + nameLen + extraLen);
    let ep = 0;
    while (ep + 4 <= extra.length) {
      const id = extra.readUInt16LE(ep);
      const len = extra.readUInt16LE(ep + 2);
      if (id === 0x0001) {
        let bp = ep + 4;
        if (usize === 0xffffffff && bp + 8 <= ep + 4 + len) { usize = Number(extra.readBigUInt64LE(bp)); bp += 8; }
        if (csize === 0xffffffff && bp + 8 <= ep + 4 + len) { csize = Number(extra.readBigUInt64LE(bp)); bp += 8; }
        if (localHeaderOffset === 0xffffffff && bp + 8 <= ep + 4 + len) { localHeaderOffset = Number(extra.readBigUInt64LE(bp)); }
      }
      ep += 4 + len;
    }
    // Names are ASCII in every OOXML writer; decode as utf-8 regardless of the flag.
    const name = nameBytes.toString((flags & 0x800) ? 'utf8' : 'latin1').replace(/^\.?\//, '');
    members.set(name, { name, method, compressedSize: csize, uncompressedSize: usize, localHeaderOffset });
    pos += 46 + nameLen + extraLen + commentLen;
  }
  if (members.size === 0) throw new Error('corrupt zip (empty or unreadable central directory)');
  return members;
}

/** Find the central directory from a file TAIL (`tail` = the last bytes of
 * the file, starting at absolute offset `tailOffset`). */
function locateCentralDirectory(tail: Buffer, tailOffset: number): { cdOffset: number; cdSize: number } {
  if (tail.length < 22) throw new Error('not a zip archive (too small)');
  let eocdPos = -1;
  for (let i = tail.length - 22; i >= 0; i--) {
    if (tail.readUInt32LE(i) === SIG_EOCD) { eocdPos = i; break; }
  }
  if (eocdPos < 0) throw new Error('not a zip archive (no end-of-central-directory record)');
  let cdSize: number = tail.readUInt32LE(eocdPos + 12);
  let cdOffset: number = tail.readUInt32LE(eocdPos + 16);
  if (cdSize === 0xffffffff || cdOffset === 0xffffffff) {
    const locPos = eocdPos - 20;
    if (locPos >= 0 && tail.readUInt32LE(locPos) === SIG_EOCD64_LOCATOR) {
      const recAbs = Number(tail.readBigUInt64LE(locPos + 8));
      const rec = recAbs - tailOffset;
      if (rec >= 0 && rec + 56 <= tail.length && tail.readUInt32LE(rec) === SIG_EOCD64) {
        cdSize = Number(tail.readBigUInt64LE(rec + 40));
        cdOffset = Number(tail.readBigUInt64LE(rec + 48));
      }
    }
  }
  return { cdOffset, cdSize };
}

/** Central-directory index of an in-memory zip. Throws when it isn't a zip. */
export function indexZip(buf: Buffer): Map<string, ZipMember> {
  const { cdOffset, cdSize } = locateCentralDirectory(buf, 0);
  if (cdOffset + cdSize > buf.length) throw new Error('corrupt zip (central directory beyond end of file)');
  return parseCentralDirectory(buf.subarray(cdOffset, cdOffset + cdSize));
}

const ZIP_TAIL_BYTES = 22 + 0xffff + 20 + 56;
const MAX_CENTRAL_DIRECTORY_BYTES = 64 * 1024 * 1024;

async function readAt(fd: fs.promises.FileHandle, offset: number, length: number): Promise<Buffer> {
  const buf = Buffer.alloc(length);
  let done = 0;
  while (done < length) {
    const { bytesRead } = await fd.read(buf, done, length - done, offset + done);
    if (bytesRead <= 0) break;
    done += bytesRead;
  }
  return done === length ? buf : buf.subarray(0, done);
}

/** Central-directory index straight from an open file — reads only the tail
 * and the directory, never the members. */
export async function indexZipFromFd(fd: fs.promises.FileHandle, size: number): Promise<Map<string, ZipMember>> {
  const tailLen = Math.min(size, ZIP_TAIL_BYTES);
  const tail = await readAt(fd, size - tailLen, tailLen);
  const { cdOffset, cdSize } = locateCentralDirectory(tail, size - tailLen);
  if (cdSize > MAX_CENTRAL_DIRECTORY_BYTES) throw new Error('zip central directory too large');
  if (cdOffset + cdSize > size) throw new Error('corrupt zip (central directory beyond end of file)');
  return parseCentralDirectory(await readAt(fd, cdOffset, cdSize));
}

/** Local header → absolute offset of the member's compressed bytes. */
function memberDataStart(localHeader: Buffer, member: ZipMember): number {
  if (localHeader.length < 30 || localHeader.readUInt32LE(0) !== SIG_LOCAL) throw new Error(`corrupt zip (bad local header for ${member.name})`);
  return member.localHeaderOffset + 30 + localHeader.readUInt16LE(26) + localHeader.readUInt16LE(28);
}

/** Inflate one member (stored or deflated) from an in-memory zip. */
export function readZipMember(buf: Buffer, member: ZipMember): Buffer {
  const lh = member.localHeaderOffset;
  if (lh + 30 > buf.length) throw new Error(`corrupt zip (bad local header for ${member.name})`);
  const start = memberDataStart(buf.subarray(lh, lh + 30), member);
  const endPos = start + member.compressedSize;
  if (endPos > buf.length) throw new Error(`corrupt zip (member ${member.name} beyond end of file)`);
  return inflateWhole(buf.subarray(start, endPos), member);
}

function inflateWhole(data: Buffer, member: ZipMember): Buffer {
  if (member.uncompressedSize > MAX_MEMBER_BYTES) throw new Error(`${member.name} is too large to read (${member.uncompressedSize} bytes)`);
  if (member.method === 0) return data;
  if (member.method === 8) return zlib.inflateRawSync(data, { maxOutputLength: MAX_MEMBER_BYTES });
  throw new Error(`unsupported zip compression method ${member.method} for ${member.name}`);
}

/**
 * Inflate a deflated member only as far as the caller needs: `enough(chunk,
 * total)` is evaluated after every output chunk and, once true, the inflater
 * is torn down and the prefix returned (`complete: false`). The compressed
 * bytes are pulled through `readSlice(offset, length)` in 256 KB slices, so
 * an early stop also stops READING (from disk, for the fd source). This is
 * what keeps a 200k-row worksheet from being expanded to 200+ MB when the
 * viewer only asked for the first 500 rows.
 */
export function inflatePrefixFromSlices(
  readSlice: (offset: number, length: number) => Buffer | Promise<Buffer>,
  compressedSize: number,
  member: ZipMember,
  enough: (chunk: Buffer, total: number) => boolean,
): Promise<{ data: Buffer; complete: boolean }> {
  if (member.method === 0) {
    return Promise.resolve(readSlice(0, compressedSize)).then((data) => ({ data, complete: true }));
  }
  if (member.method !== 8) throw new Error(`unsupported zip compression method ${member.method} for ${member.name}`);
  return new Promise((resolve, reject) => {
    const inflate = zlib.createInflateRaw();
    const chunks: Buffer[] = [];
    let total = 0;
    let done = false;
    const finish = (complete: boolean) => {
      if (done) return;
      done = true;
      inflate.removeAllListeners();
      inflate.on('error', () => { /* torn down on purpose */ });
      inflate.destroy();
      resolve({ data: Buffer.concat(chunks, total), complete });
    };
    inflate.on('data', (chunk: Buffer) => {
      if (done) return;
      chunks.push(chunk);
      total += chunk.length;
      if (total > MAX_MEMBER_BYTES) { finish(false); return; }
      if (enough(chunk, total)) finish(false);
    });
    inflate.on('end', () => finish(true));
    inflate.on('error', (e) => { if (!done) { done = true; reject(e); } });
    const SLICE = 256 * 1024;
    let off = 0;
    const pump = async () => {
      try {
        while (!done) {
          if (off >= compressedSize) { inflate.end(); return; }
          const len = Math.min(SLICE, compressedSize - off);
          const slice = await readSlice(off, len);
          off += len;
          if (done) return;
          if (!inflate.write(slice)) {
            await new Promise<void>((r) => inflate.once('drain', () => r()));
          } else {
            await new Promise<void>((r) => setImmediate(r));
          }
        }
      } catch (e) {
        if (!done) { done = true; reject(e as Error); }
      }
    };
    void pump();
  });
}

/** In-memory convenience wrapper over `inflatePrefixFromSlices`. */
export function inflateZipMemberPrefix(
  buf: Buffer,
  member: ZipMember,
  enough: (chunk: Buffer, total: number) => boolean,
): Promise<{ data: Buffer; complete: boolean }> {
  const lh = member.localHeaderOffset;
  if (lh + 30 > buf.length) throw new Error(`corrupt zip (bad local header for ${member.name})`);
  const start = memberDataStart(buf.subarray(lh, lh + 30), member);
  if (start + member.compressedSize > buf.length) throw new Error(`corrupt zip (member ${member.name} beyond end of file)`);
  return inflatePrefixFromSlices((o, l) => buf.subarray(start + o, start + o + l), member.compressedSize, member, enough);
}

/**
 * Uniform access to a zip's members for the workbook readers — backed by an
 * in-memory buffer (tests, small files) or an open file (the route: only the
 * central directory + the members actually needed are read from disk).
 */
export interface ZipSource {
  members: Map<string, ZipMember>;
  /** Whole member, inflated; null when absent. */
  readMember(name: string): Promise<Buffer | null>;
  /** Streaming inflate with early stop (see inflatePrefixFromSlices). */
  inflatePrefix(member: ZipMember, enough: (chunk: Buffer, total: number) => boolean): Promise<{ data: Buffer; complete: boolean }>;
}

export function zipSourceFromBuffer(buf: Buffer): ZipSource {
  const members = indexZip(buf);
  return {
    members,
    readMember: (name) => {
      const m = members.get(name);
      return Promise.resolve(m ? readZipMember(buf, m) : null);
    },
    inflatePrefix: (member, enough) => inflateZipMemberPrefix(buf, member, enough),
  };
}

export async function zipSourceFromFd(fd: fs.promises.FileHandle, size: number): Promise<ZipSource> {
  const members = await indexZipFromFd(fd, size);
  const dataStart = async (member: ZipMember): Promise<number> => {
    const lh = await readAt(fd, member.localHeaderOffset, 30);
    const start = memberDataStart(lh, member);
    if (start + member.compressedSize > size) throw new Error(`corrupt zip (member ${member.name} beyond end of file)`);
    return start;
  };
  return {
    members,
    readMember: async (name) => {
      const m = members.get(name);
      if (!m) return null;
      const start = await dataStart(m);
      return inflateWhole(await readAt(fd, start, m.compressedSize), m);
    },
    inflatePrefix: async (member, enough) => {
      const start = await dataStart(member);
      return inflatePrefixFromSlices((o, l) => readAt(fd, start + o, l), member.compressedSize, member, enough);
    },
  };
}

/** Byte-level element counter for streamed XML — the predicate that stops
 * inflating once `stopAfter` complete elements are guaranteed (it fires when
 * element #stopAfter+1 OPENS, or when `endTag` closes the list). Keeps a few
 * bytes of overlap so a tag split across chunks is seen exactly once. */
export function makeTagCounter(tag: string, endTag: string, stopAfter: number): (chunk: Buffer, total: number) => boolean {
  let seen = 0;
  let sawEnd = false;
  const TAG = Buffer.from(tag);
  const END = Buffer.from(endTag);
  // A match needs `tag` + 1 byte of lookahead: keep tag.length bytes so a
  // split tag is seen once (a match that already had its lookahead cannot
  // start inside the kept tail, so it is never recounted).
  let carry: Buffer = Buffer.alloc(0);
  let endCarry: Buffer = Buffer.alloc(0);
  return (chunk) => {
    const hay = carry.length ? Buffer.concat([carry, chunk]) : chunk;
    let pos = 0;
    while (!sawEnd) {
      const at = hay.indexOf(TAG, pos);
      if (at === -1 || at + TAG.length >= hay.length) break;
      const nx = hay[at + TAG.length];
      // `<row ` / `<row>` / `<row/` (not `<rowBreaks`).
      if (nx === 0x20 || nx === 0x3e || nx === 0x2f || nx === 0x0a || nx === 0x0d || nx === 0x09) seen++;
      pos = at + TAG.length;
    }
    carry = hay.subarray(Math.max(0, hay.length - TAG.length));
    const endHay = endCarry.length ? Buffer.concat([endCarry, chunk]) : chunk;
    if (endHay.indexOf(END) !== -1) sawEnd = true;
    endCarry = chunk.subarray(Math.max(0, chunk.length - (END.length - 1)));
    return sawEnd || seen > stopAfter;
  };
}

/** Worksheet rows: enough once row #maxRows is closed. */
export function makeRowCounter(maxRows: number): (chunk: Buffer, total: number) => boolean {
  return makeTagCounter('<row', '</sheetData', maxRows);
}

// ── tolerant XML helpers ────────────────────────────────────────────────────

const ENTITY_MAP: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

export function decodeXmlEntities(s: string): string {
  if (s.indexOf('&') === -1) return s;
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (m, body: string) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
    }
    return ENTITY_MAP[body] ?? m;
  });
}

/** Attribute value from a tag's attribute string (`name="…"` or `name='…'`).
 * Matches the bare name or any namespace-prefixed variant (`r:id`, `d2p1:id`)
 * when `allowPrefix` is set. */
const ATTR_RE_CACHE = new Map<string, RegExp>();
function attr(tagAttrs: string, name: string, allowPrefix = false): string | undefined {
  const key = allowPrefix ? `*${name}` : name;
  let re = ATTR_RE_CACHE.get(key);
  if (!re) {
    re = allowPrefix
      ? new RegExp(`(?:^|\\s)(?:[\\w.-]+:)?${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`)
      : new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`);
    ATTR_RE_CACHE.set(key, re);
  }
  const m = re.exec(tagAttrs);
  if (!m) return undefined;
  return m[1] !== undefined ? m[1] : m[2];
}

/** All `<t>` text runs inside a fragment (rich text = several runs), joined.
 * Phonetic guides (`<rPh>`) are dropped — they're annotations, not content. */
function textRuns(fragment: string): string {
  const cleaned = fragment.indexOf('<rPh') === -1 ? fragment : fragment.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '');
  let out = '';
  const re = /<t\b[^>]*?(?:\/>|>([\s\S]*?)<\/t>)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(cleaned)) !== null) {
    if (m[1] !== undefined) out += decodeXmlEntities(m[1]);
  }
  return out;
}

// ── xlsx ────────────────────────────────────────────────────────────────────

/** `AB` → 28 (1-based). */
export function columnLetterToIndex(letters: string): number {
  let n = 0;
  for (let i = 0; i < letters.length; i++) {
    const c = letters.charCodeAt(i);
    if (c < 65 || c > 90) break;
    n = n * 26 + (c - 64);
  }
  return n;
}

/** `B12` → { col: 2, row: 12 }. */
function parseCellRef(ref: string): { col: number; row: number } | null {
  const m = /^([A-Z]{1,3})(\d+)$/.exec(ref);
  if (!m) return null;
  return { col: columnLetterToIndex(m[1]), row: parseInt(m[2], 10) };
}

interface WorkbookInfo {
  sheets: Array<{ name: string; rId?: string; hidden: boolean }>;
  date1904: boolean;
}

function parseWorkbook(xml: string): WorkbookInfo {
  const sheets: WorkbookInfo['sheets'] = [];
  const re = /<(?:[\w.-]+:)?sheet\b([^>]*?)\/?>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const attrs = m[1];
    const name = attr(attrs, 'name');
    if (name === undefined) continue;
    const state = attr(attrs, 'state');
    sheets.push({
      name: decodeXmlEntities(name),
      rId: attr(attrs, 'id', true),
      hidden: state === 'hidden' || state === 'veryHidden',
    });
  }
  const pr = /<(?:[\w.-]+:)?workbookPr\b([^>]*?)\/?>/.exec(xml);
  const d1904 = pr ? attr(pr[1], 'date1904') : undefined;
  return { sheets, date1904: d1904 === '1' || d1904 === 'true' };
}

/** rId → zip member name, from xl/_rels/workbook.xml.rels. */
function parseWorkbookRels(xml: string): Map<string, string> {
  const map = new Map<string, string>();
  const re = /<(?:[\w.-]+:)?Relationship\b([^>]*?)\/?>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const id = attr(m[1], 'Id');
    let target = attr(m[1], 'Target');
    if (!id || !target) continue;
    target = decodeXmlEntities(target);
    if (target.startsWith('/')) target = target.slice(1);
    else if (!target.startsWith('xl/')) target = `xl/${target.replace(/^\.\//, '')}`;
    // Collapse "xl/../foo" style paths.
    const parts: string[] = [];
    for (const seg of target.split('/')) {
      if (seg === '..') parts.pop(); else if (seg !== '.' && seg !== '') parts.push(seg);
    }
    map.set(id, parts.join('/'));
  }
  return map;
}

function parseSharedStrings(xml: string): string[] {
  const out: string[] = [];
  const re = /<(?:[\w.-]+:)?si\b[^>]*?(?:\/>|>([\s\S]*?)<\/(?:[\w.-]+:)?si>)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    out.push(m[1] === undefined ? '' : textRuns(m[1]));
  }
  return out;
}

interface Styles {
  /** cellXfs index → number format classification. */
  xfFormats: NumberFormat[];
}

function parseStyles(xml: string): Styles {
  const custom = new Map<number, string>();
  const numFmtRe = /<(?:[\w.-]+:)?numFmt\b([^>]*?)\/?>/g;
  let m: RegExpExecArray | null;
  while ((m = numFmtRe.exec(xml)) !== null) {
    const id = attr(m[1], 'numFmtId');
    const code = attr(m[1], 'formatCode');
    if (id !== undefined && code !== undefined) custom.set(parseInt(id, 10), decodeXmlEntities(code));
  }
  const xfFormats: NumberFormat[] = [];
  const cellXfs = /<(?:[\w.-]+:)?cellXfs\b[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?cellXfs>/.exec(xml);
  if (cellXfs) {
    const xfRe = /<(?:[\w.-]+:)?xf\b([^>]*?)(?:\/>|>[\s\S]*?<\/(?:[\w.-]+:)?xf>)/g;
    while ((m = xfRe.exec(cellXfs[1])) !== null) {
      const id = parseInt(attr(m[1], 'numFmtId') ?? '0', 10) || 0;
      xfFormats.push(classifyNumberFormat(id, custom.get(id)));
    }
  }
  return { xfFormats };
}

interface SheetParseContext {
  /** Resolved shared strings — or null to DEFER: `t="s"` cells then record
   * their index in `sstRefs` and get a placeholder, so the shared-strings
   * member can be inflated only up to the highest index the window uses. */
  sharedStrings: string[] | null;
  sstRefs?: Array<[row: number, col: number, idx: number]>;
  styles: Styles;
  date1904: boolean;
  maxRows: number;
  maxCols: number;
}

const SST_PLACEHOLDER = '\u0000';

function cellDisplay(attrs: string, inner: string | undefined, ctx: SheetParseContext): string {
  const t = attr(attrs, 't') ?? 'n';
  if (t === 'inlineStr') return inner === undefined ? '' : textRuns(inner);
  const vm = inner === undefined ? null : /<(?:[\w.-]+:)?v\b[^>]*?(?:\/>|>([\s\S]*?)<\/(?:[\w.-]+:)?v>)/.exec(inner);
  const v = vm && vm[1] !== undefined ? decodeXmlEntities(vm[1]) : '';
  if (v === '') return '';
  switch (t) {
    case 's': {
      const idx = parseInt(v, 10);
      if (!Number.isFinite(idx)) return '';
      if (ctx.sharedStrings) return ctx.sharedStrings[idx] ?? '';
      return SST_PLACEHOLDER; // resolved after the scan (see resolveSstRefs)
    }
    case 'str': return v;          // formula string result
    case 'b': return v === '1' || v.toLowerCase() === 'true' ? 'TRUE' : 'FALSE';
    case 'e': return v;            // #N/A, #DIV/0!, …
    case 'd': return v;            // ISO 8601 date literal
    default: {
      const s = attr(attrs, 's');
      const fmt = s !== undefined ? ctx.styles.xfFormats[parseInt(s, 10)] : undefined;
      if (fmt && fmt.kind !== 'general') {
        const n = Number(v);
        if (Number.isFinite(n)) {
          if (fmt.kind === 'percent') return formatPercent(v, fmt.decimals ?? 0);
          return formatSerialDate(n, fmt.kind, ctx.date1904);
        }
      }
      return formatGeneralNumber(v);
    }
  }
}

/** Parse one worksheet XML into a capped grid. */
function parseWorksheet(xml: string, ctx: SheetParseContext): Omit<SpreadsheetSheetData, 'name' | 'hidden'> {
  const rows: string[][] = [];
  let colCount = 0;
  let truncatedCols = false;
  let lastRowSeen = 0;
  let stoppedEarly = false;

  const rowRe = /<(?:[\w.-]+:)?row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:[\w.-]+:)?row>)/g;
  const cellRe = /<(?:[\w.-]+:)?c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:[\w.-]+:)?c>)/g;
  let rm: RegExpExecArray | null;
  let sequentialRow = 0;
  while ((rm = rowRe.exec(xml)) !== null) {
    sequentialRow++;
    const rAttr = attr(rm[1], 'r');
    const rowNum = rAttr !== undefined ? parseInt(rAttr, 10) || sequentialRow : sequentialRow;
    lastRowSeen = Math.max(lastRowSeen, rowNum);
    if (rowNum > ctx.maxRows) { stoppedEarly = true; break; }
    const cells: string[] = [];
    let lastCol = 0;
    if (rm[2] !== undefined) {
      cellRe.lastIndex = 0;
      let cm: RegExpExecArray | null;
      while ((cm = cellRe.exec(rm[2])) !== null) {
        const ref = attr(cm[1], 'r');
        const parsed = ref !== undefined ? parseCellRef(ref) : null;
        const col = parsed ? parsed.col : lastCol + 1;
        lastCol = col;
        if (col > colCount) colCount = col;
        if (col > ctx.maxCols) { truncatedCols = true; continue; }
        const text = cellDisplay(cm[1], cm[2], ctx);
        if (text === '') continue;
        if (text === SST_PLACEHOLDER && ctx.sstRefs) {
          const vm = cm[2] === undefined ? null : /<(?:[\w.-]+:)?v\b[^>]*?>([\s\S]*?)<\/(?:[\w.-]+:)?v>/.exec(cm[2]);
          ctx.sstRefs.push([rowNum - 1, col - 1, vm ? parseInt(vm[1], 10) : -1]);
        }
        while (cells.length < col - 1) cells.push('');
        cells[col - 1] = text;
      }
    }
    while (rows.length < rowNum - 1) rows.push([]);
    rows[rowNum - 1] = cells;
  }

  // Real extent without walking the rest: rows are emitted in ascending order,
  // so the LAST <row r="…"> in the document is the row count.
  let rowCount = lastRowSeen;
  if (stoppedEarly) {
    const at = Math.max(xml.lastIndexOf('<row '), xml.lastIndexOf(':row '));
    if (at !== -1) {
      const tagEnd = xml.indexOf('>', at);
      const r = attr(xml.slice(at, tagEnd === -1 ? undefined : tagEnd), 'r');
      if (r !== undefined) rowCount = Math.max(rowCount, parseInt(r, 10) || 0);
    }
    // Rows past the cap were never scanned, so their width is unknown — the
    // <dimension ref="A1:H500"/> hint fills that in.
    const dim = /<(?:[\w.-]+:)?dimension\b([^>]*?)\/?>/.exec(xml);
    const dimRef = dim ? attr(dim[1], 'ref') : undefined;
    if (dimRef) {
      const endRef = dimRef.split(':')[1] ?? dimRef.split(':')[0];
      const parsedEnd = parseCellRef(endRef);
      if (parsedEnd && parsedEnd.col > colCount) colCount = parsedEnd.col;
    }
  }
  if (colCount > ctx.maxCols) truncatedCols = true;

  return {
    rows,
    rowCount,
    colCount,
    truncatedRows: stoppedEarly,
    truncatedCols,
  };
}

/** Row extent promised by `<dimension ref="A1:H500"/>` (undefined when absent). */
function dimensionRowExtent(xml: string): { rows: number; cols: number } | undefined {
  const dim = /<(?:[\w.-]+:)?dimension\b([^>]*?)\/?>/.exec(xml);
  const dimRef = dim ? attr(dim[1], 'ref') : undefined;
  if (!dimRef) return undefined;
  const endRef = dimRef.split(':')[1] ?? dimRef.split(':')[0];
  const parsedEnd = parseCellRef(endRef);
  return parsedEnd ? { rows: parsedEnd.row, cols: parsedEnd.col } : undefined;
}

/** Parse an .xlsx/.xlsm buffer: full sheet list + ONE sheet's grid. */
export function parseXlsxBuffer(buf: Buffer, opts: ParseOptions = {}): Promise<ParsedSpreadsheet> {
  return parseXlsxSource(zipSourceFromBuffer(buf), opts);
}

/**
 * Parse an OOXML workbook from a zip source. The worksheet member is inflated
 * in streaming mode and stopped as soon as the requested window is complete;
 * the shared-strings member is inflated only up to the highest index that
 * window references (writers append strings in row order, so a window near
 * the top touches a tiny prefix of a 30 MB SST). Workbook, rels and styles
 * are small and read whole.
 */
export async function parseXlsxSource(src: ZipSource, opts: ParseOptions = {}): Promise<ParsedSpreadsheet> {
  const { maxRows, maxCols } = clampCaps(opts);
  const members = src.members;
  const readText = async (name: string): Promise<string | null> => {
    const b = await src.readMember(name);
    return b ? b.toString('utf8') : null;
  };
  const workbookXml = await readText('xl/workbook.xml');
  if (workbookXml === null) throw new Error('not an Excel workbook (xl/workbook.xml missing)');
  const workbook = parseWorkbook(workbookXml);
  if (workbook.sheets.length === 0) throw new Error('workbook has no sheets');
  const rels = parseWorkbookRels((await readText('xl/_rels/workbook.xml.rels')) ?? '');

  const sheets: SpreadsheetSheetInfo[] = workbook.sheets.map((s) => (s.hidden ? { name: s.name, hidden: true } : { name: s.name }));
  const sheetIndex = Math.min(Math.max(0, Math.floor(opts.sheetIndex ?? 0)), workbook.sheets.length - 1);
  const target = workbook.sheets[sheetIndex];
  let memberName = target.rId ? rels.get(target.rId) : undefined;
  if (!memberName || !members.has(memberName)) {
    // No rels (or a broken one): fall back to the conventional numbering.
    const fallback = `xl/worksheets/sheet${sheetIndex + 1}.xml`;
    memberName = members.has(fallback) ? fallback : memberName;
  }
  const sheetMember = memberName ? members.get(memberName) : undefined;
  if (!sheetMember) throw new Error(`worksheet "${target.name}" not found in workbook`);

  const sstMember = members.get('xl/sharedStrings.xml');
  const ctx: SheetParseContext = {
    sharedStrings: sstMember ? null : [],
    sstRefs: sstMember ? [] : undefined,
    styles: parseStyles((await readText('xl/styles.xml')) ?? ''),
    date1904: workbook.date1904,
    maxRows,
    maxCols,
  };
  // Stream the worksheet: stop after maxRows+1 row elements (or </sheetData>).
  const { data: sheetBytes, complete } = await src.inflatePrefix(sheetMember, makeRowCounter(maxRows));
  const sheetXml = sheetBytes.toString('utf8');
  const grid = parseWorksheet(sheetXml, ctx);

  // Resolve deferred shared strings from a prefix of the SST.
  if (sstMember && ctx.sstRefs && ctx.sstRefs.length > 0) {
    let maxIdx = -1;
    for (const ref of ctx.sstRefs) if (ref[2] > maxIdx) maxIdx = ref[2];
    const { data: sstBytes } = await src.inflatePrefix(sstMember, makeTagCounter('<si', '</sst', maxIdx + 1));
    const sst = parseSharedStrings(sstBytes.toString('utf8'));
    for (const [r, c, idx] of ctx.sstRefs) {
      const row = grid.rows[r];
      if (!row) continue;
      row[c] = idx >= 0 ? (sst[idx] ?? '') : '';
    }
    // Keep the "row ends at its last non-empty cell" invariant.
    for (const [r] of ctx.sstRefs) {
      const row = grid.rows[r];
      if (!row) continue;
      let end = row.length;
      while (end > 0 && row[end - 1] === '') end--;
      if (end !== row.length) row.length = end;
    }
  }

  const sawEnd = complete || sheetXml.includes('</sheetData');
  let rowCountApprox = false;
  if (!sawEnd) {
    // The tail was never inflated. The extent comes from <dimension> when the
    // sheet declares one (Excel, LibreOffice, Google Sheets do); a streaming
    // writer without it (openpyxl, POI SXSSF) gets an ESTIMATE from the
    // bytes-per-row seen so far vs. the member's inflated size — flagged
    // approximate — instead of a 200 MB full inflate.
    const dim = dimensionRowExtent(sheetXml);
    const lastRowTag = Math.max(sheetXml.lastIndexOf('<row '), sheetXml.lastIndexOf(':row '));
    let lastRowSeen = grid.rowCount;
    if (lastRowTag !== -1) {
      const tagEnd = sheetXml.indexOf('>', lastRowTag);
      lastRowSeen = Math.max(lastRowSeen, parseInt(attr(sheetXml.slice(lastRowTag, tagEnd === -1 ? undefined : tagEnd), 'r') ?? '0', 10) || 0);
    }
    if (dim && dim.rows >= lastRowSeen) {
      grid.rowCount = dim.rows;
      grid.colCount = Math.max(grid.colCount, dim.cols);
    } else {
      const bytesSoFar = sheetBytes.length;
      const ratio = bytesSoFar > 0 && lastRowSeen > 0 ? sheetMember.uncompressedSize / bytesSoFar : 1;
      grid.rowCount = Math.max(lastRowSeen, Math.round(lastRowSeen * ratio));
      rowCountApprox = true;
    }
    grid.truncatedRows = grid.rowCount > grid.rows.length;
    grid.truncatedCols = grid.truncatedCols || grid.colCount > maxCols;
  }
  return {
    format: 'xlsx',
    sheets,
    sheetIndex,
    sheet: rowCountApprox ? { ...sheets[sheetIndex], ...grid, rowCountApprox: true } : { ...sheets[sheetIndex], ...grid },
  };
}

// ── csv / tsv ───────────────────────────────────────────────────────────────

const CSV_CANDIDATES = [',', ';', '\t', '|'];

/** Pick the delimiter that splits the first lines most consistently. */
export function sniffDelimiter(text: string): string {
  const lines = text.split(/\r\n|\n|\r/).filter((l) => l.trim() !== '').slice(0, 20);
  if (lines.length === 0) return ',';
  let best = ',';
  let bestScore = -1;
  for (const cand of CSV_CANDIDATES) {
    const counts = lines.map((l) => {
      let n = 0;
      let inQ = false;
      for (let i = 0; i < l.length; i++) {
        const ch = l[i];
        if (ch === '"') inQ = !inQ;
        else if (!inQ && ch === cand) n++;
      }
      return n;
    });
    const min = Math.min(...counts);
    const max = Math.max(...counts);
    if (min === 0) continue;
    // Consistent column counts beat raw frequency; frequency breaks ties.
    const score = (max === min ? 1000 : 0) + min - (max - min);
    if (score > bestScore) { bestScore = score; best = cand; }
  }
  return best;
}

export function decodeTextBuffer(buf: Buffer): string {
  let body = buf;
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) body = buf.subarray(3);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(body);
  } catch {
    return body.toString('latin1');
  }
}

/** RFC 4180-ish parse: quotes, doubled quotes, embedded newlines, CRLF/LF/CR. */
export function parseDelimited(text: string, delimiter: string, opts: ParseOptions = {}): Omit<SpreadsheetSheetData, 'name' | 'hidden'> {
  const { maxRows, maxCols } = clampCaps(opts);
  const rows: string[][] = [];
  let rowCount = 0;
  let colCount = 0;
  let truncatedCols = false;

  let field = '';
  let record: string[] = [];
  let fieldsInRecord = 0;
  let inQuotes = false;
  let fieldHadQuotes = false;
  const len = text.length;

  const endField = () => {
    fieldsInRecord++;
    if (record.length < maxCols) record.push(field);
    else truncatedCols = true;
    field = '';
    fieldHadQuotes = false;
  };
  const endRecord = () => {
    // A lone empty field on an empty line still counts as a (blank) record;
    // the final newline of the file must NOT produce an extra empty record.
    endField();
    rowCount++;
    if (fieldsInRecord > colCount) colCount = fieldsInRecord;
    if (rows.length < maxRows) {
      // Trim trailing empties so the client's padding rule holds.
      let end = record.length;
      while (end > 0 && record[end - 1] === '') end--;
      rows.push(end === record.length ? record : record.slice(0, end));
    }
    record = [];
    fieldsInRecord = 0;
  };

  for (let i = 0; i < len; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"' && field === '' && !fieldHadQuotes) { inQuotes = true; fieldHadQuotes = true; continue; }
    if (ch === delimiter) { endField(); continue; }
    if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      endRecord();
      continue;
    }
    field += ch;
  }
  // Last record without a trailing newline.
  if (field !== '' || record.length > 0 || fieldHadQuotes) endRecord();

  return {
    rows,
    rowCount,
    colCount,
    truncatedRows: rowCount > rows.length,
    truncatedCols,
  };
}

// ── ods (OpenDocument spreadsheet) ──────────────────────────────────────────

/** Text of a `<text:p>` fragment: nested spans flattened, `<text:s/>` → spaces,
 * `<text:tab/>` → tab, `<text:line-break/>` → newline, tags stripped. */
function odsParagraphText(fragment: string): string {
  return decodeXmlEntities(
    fragment
      .replace(/<text:s\b([^>]*?)\/>/g, (_m, a: string) => ' '.repeat(parseInt(attr(a, 'c', true) ?? '1', 10) || 1))
      .replace(/<text:tab\b[^>]*\/>/g, '\t')
      .replace(/<text:line-break\b[^>]*\/>/g, '\n')
      .replace(/<[^>]+>/g, ''),
  );
}

/** Display text of an ODS cell: the rendered paragraphs when present (what
 * LibreOffice showed — locale formatting included), else the typed value. */
function odsCellText(attrs: string, inner: string | undefined): string {
  if (inner !== undefined) {
    const paras: string[] = [];
    const re = /<text:p\b[^>]*?(?:\/>|>([\s\S]*?)<\/text:p>)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(inner)) !== null) paras.push(m[1] === undefined ? '' : odsParagraphText(m[1]));
    if (paras.length > 0) return paras.join('\n');
  }
  const type = attr(attrs, 'value-type', true);
  if (type === 'date') return attr(attrs, 'date-value', true) ?? '';
  if (type === 'time') return (attr(attrs, 'time-value', true) ?? '').replace(/^PT/, '').toLowerCase();
  if (type === 'boolean') return (attr(attrs, 'boolean-value', true) ?? '').toUpperCase();
  const v = attr(attrs, 'value', true);
  if (v !== undefined) return type === 'percentage' ? formatPercent(v, 2) : formatGeneralNumber(v);
  return '';
}

/** Parse an .ods buffer (zip + content.xml): full table list + ONE table's grid. */
export function parseOdsBuffer(buf: Buffer, opts: ParseOptions = {}): ParsedSpreadsheet {
  const members = indexZip(buf);
  const content = members.get('content.xml');
  if (!content) throw new Error('not an OpenDocument spreadsheet (content.xml missing)');
  return parseOdsContentXml(readZipMember(buf, content).toString('utf8'), opts);
}

/** Parse the content.xml of an OpenDocument spreadsheet. */
export function parseOdsContentXml(xml: string, opts: ParseOptions = {}): ParsedSpreadsheet {
  const { maxRows, maxCols } = clampCaps(opts);

  // Hidden sheets are expressed through the table's automatic style:
  // <style:style style:name="ta2" style:family="table"><style:table-properties table:display="false"/>.
  const hiddenStyles = new Set<string>();
  const styleRe = /<style:style\b([^>]*?)>([\s\S]*?)<\/style:style>/g;
  let sm: RegExpExecArray | null;
  while ((sm = styleRe.exec(xml)) !== null) {
    if (attr(sm[1], 'family', true) === 'table' && /table:display="false"/.test(sm[2])) {
      const nm = attr(sm[1], 'name', true);
      if (nm) hiddenStyles.add(nm);
    }
  }
  // Tables: name + body. LibreOffice writes `<table:table table:name="…" …>`.
  const tables: Array<{ name: string; hidden: boolean; body: string }> = [];
  const tableRe = /<table:table\b([^>]*?)>([\s\S]*?)<\/table:table>/g;
  let tm: RegExpExecArray | null;
  while ((tm = tableRe.exec(xml)) !== null) {
    const styleName = attr(tm[1], 'style-name', true);
    tables.push({
      name: decodeXmlEntities(attr(tm[1], 'name', true) ?? `Sheet${tables.length + 1}`),
      hidden: /table:display="false"/.test(tm[1]) || (styleName !== undefined && hiddenStyles.has(styleName)),
      body: tm[2],
    });
  }
  if (tables.length === 0) throw new Error('OpenDocument file has no spreadsheet tables');
  const sheets: SpreadsheetSheetInfo[] = tables.map((t) => (t.hidden ? { name: t.name, hidden: true } : { name: t.name }));
  const sheetIndex = Math.min(Math.max(0, Math.floor(opts.sheetIndex ?? 0)), tables.length - 1);
  const body = tables[sheetIndex].body;

  const rows: string[][] = [];
  let rowCursor = 0;          // next spreadsheet row index (0-based), repeats included
  let lastDataRow = -1;       // last row with a non-empty cell
  let colCount = 0;
  let truncatedCols = false;
  // Rows can be wrapped in <table:table-row-group>/<table:table-header-rows>;
  // scanning for the row elements directly is enough (order is preserved).
  const rowRe = /<table:table-row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/table:table-row>)/g;
  const cellRe = /<table:(?:covered-)?table-cell\b([^>]*?)(?:\/>|>([\s\S]*?)<\/table:(?:covered-)?table-cell>)/g;
  let rm: RegExpExecArray | null;
  while ((rm = rowRe.exec(body)) !== null) {
    const repeat = Math.max(1, parseInt(attr(rm[1], 'number-rows-repeated', true) ?? '1', 10) || 1);
    // Cells of this (possibly repeated) row.
    const cells: string[] = [];
    let colCursor = 0;
    let rowHasData = false;
    if (rm[2] !== undefined) {
      cellRe.lastIndex = 0;
      let cm: RegExpExecArray | null;
      while ((cm = cellRe.exec(rm[2])) !== null) {
        const crep = Math.max(1, parseInt(attr(cm[1], 'number-columns-repeated', true) ?? '1', 10) || 1);
        const text = odsCellText(cm[1], cm[2]);
        if (text !== '') {
          rowHasData = true;
          // Repeated non-empty cells (rare, e.g. a filled range) expand up to the cap.
          for (let k = 0; k < crep; k++) {
            const col = colCursor + k;
            if (col >= maxCols) { truncatedCols = true; break; }
            while (cells.length < col) cells.push('');
            cells[col] = text;
          }
          if (colCursor + crep > colCount) colCount = colCursor + crep;
        }
        colCursor += crep;
      }
    }
    if (rowHasData) {
      // Materialize the row `repeat` times, but only within the cap.
      for (let k = 0; k < repeat; k++) {
        const r = rowCursor + k;
        if (r >= maxRows) break;
        while (rows.length < r) rows.push([]);
        rows[r] = k === 0 ? cells : cells.slice();
      }
      lastDataRow = rowCursor + repeat - 1;
    }
    rowCursor += repeat;
  }
  const rowCount = lastDataRow + 1;
  // Trailing padded empty rows past the last data row are not part of the grid.
  while (rows.length > rowCount) rows.pop();
  if (colCount > maxCols) truncatedCols = true;
  return {
    format: 'ods',
    sheets,
    sheetIndex,
    sheet: {
      ...sheets[sheetIndex],
      rows,
      rowCount,
      colCount,
      truncatedRows: rowCount > maxRows,
      truncatedCols,
    },
  };
}

// ── html table (portals that name an HTML page ".xls") ──────────────────────

function htmlCellText(fragment: string): string {
  return decodeXmlEntities(
    fragment
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/gi, ' ')
      .replace(/[ \t\r\f\v]+/g, ' ')
      .replace(/ *\n */g, '\n'),
  ).trim();
}

/** Parse the LARGEST `<table>` of an HTML document into a grid; every other
 * table (layout, headers) is ignored. `<th>` cells are plain header text. */
export function parseHtmlTable(html: string, opts: ParseOptions = {}): Omit<SpreadsheetSheetData, 'name' | 'hidden'> {
  const { maxRows, maxCols } = clampCaps(opts);
  const cleaned = html.replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, '').replace(/<!--[\s\S]*?-->/g, '');
  const tableRe = /<table\b[^>]*>([\s\S]*?)<\/table>/gi;
  let best: string | null = null;
  let bestRows = -1;
  let tm: RegExpExecArray | null;
  while ((tm = tableRe.exec(cleaned)) !== null) {
    const n = (tm[1].match(/<tr\b/gi) || []).length;
    if (n > bestRows) { bestRows = n; best = tm[1]; }
  }
  if (best === null) {
    // No <table>: fall back to the whole body as one column of paragraphs.
    const text = htmlCellText(cleaned.replace(/<\/(p|div|tr|li|h[1-6])>/gi, '\n'));
    const lines = text.split('\n').filter((l) => l.trim() !== '');
    return { rows: lines.slice(0, maxRows).map((l) => [l]), rowCount: lines.length, colCount: 1, truncatedRows: lines.length > maxRows, truncatedCols: false };
  }
  const rows: string[][] = [];
  let rowCount = 0;
  let colCount = 0;
  let truncatedCols = false;
  const rowRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  const cellRe = /<t([dh])\b([^>]*)>([\s\S]*?)<\/t\1>/gi;
  let rm: RegExpExecArray | null;
  while ((rm = rowRe.exec(best)) !== null) {
    const cells: string[] = [];
    let colCursor = 0;
    cellRe.lastIndex = 0;
    let cm: RegExpExecArray | null;
    while ((cm = cellRe.exec(rm[1])) !== null) {
      const span = Math.max(1, parseInt(attr(cm[2], 'colspan') ?? '1', 10) || 1);
      const text = htmlCellText(cm[3]);
      if (colCursor < maxCols) {
        while (cells.length < colCursor) cells.push('');
        cells[colCursor] = text;
      } else if (text !== '') {
        truncatedCols = true;
      }
      colCursor += span;
    }
    if (colCursor > colCount) colCount = colCursor;
    rowCount++;
    if (rows.length < maxRows) {
      let end = cells.length;
      while (end > 0 && cells[end - 1] === '') end--;
      rows.push(end === cells.length ? cells : cells.slice(0, end));
    }
  }
  if (colCount > maxCols) truncatedCols = true;
  return { rows, rowCount, colCount, truncatedRows: rowCount > maxRows, truncatedCols };
}

// ── content sniffing + entry point ──────────────────────────────────────────

export type SniffedKind = 'xlsx' | 'ods' | 'xls' | 'biff-legacy' | 'html' | 'delimited' | 'zip-unknown';

/** Decide what a buffer IS from its bytes; the extension only breaks ties for
 * delimited text (tsv vs csv) — portals ship CSV/HTML named ".xls" all the time. */
export function sniffSpreadsheetBuffer(buf: Buffer): SniffedKind {
  if (isCfbBuffer(buf)) return 'xls';
  if (buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04) {
    try {
      const members = indexZip(buf);
      if (members.has('xl/workbook.xml')) return 'xlsx';
      if (members.has('content.xml')) {
        const mime = members.get('mimetype');
        const mimeText = mime ? readZipMember(buf, mime).toString('utf8') : '';
        if (!mimeText || /spreadsheet/.test(mimeText)) return 'ods';
      }
    } catch {
      /* fall through */
    }
    return 'zip-unknown';
  }
  if (isBiffLegacyStream(buf)) return 'biff-legacy';
  const head = decodeTextBuffer(buf.subarray(0, 4096)).trimStart().toLowerCase();
  if (/^<\?xml[^>]*>\s*<(?:[\w:]*:)?workbook\b/.test(head) || /<(?:!doctype\s+)?html\b|<table\b|<tr\b|<body\b/.test(head)) return 'html';
  return 'delimited';
}

/** Cheap sniff on the first bytes of a file (no central directory needed). */
export type SniffedHead = 'zip' | 'xls' | 'biff-legacy' | 'html' | 'delimited';
export function sniffSpreadsheetHead(head: Buffer): SniffedHead {
  if (isCfbBuffer(head)) return 'xls';
  if (head.length >= 4 && head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04) return 'zip';
  if (isBiffLegacyStream(head)) return 'biff-legacy';
  const text = decodeTextBuffer(head.subarray(0, 4096)).trimStart().toLowerCase();
  if (/^<\?xml[^>]*>\s*<(?:[\w:]*:)?workbook\b/.test(text) || /<(?:!doctype\s+)?html\b|<table\b|<tr\b|<body\b/.test(text)) return 'html';
  return 'delimited';
}

/** Whole-file cap for containers that must be in memory (xlsx/xls/ods/html). */
export const SPREADSHEET_MAX_CONTAINER_BYTES = 256 * 1024 * 1024;
/** Delimited files are read by WINDOW (any size); this bounds the prefix. */
const DELIMITED_PREFIX_MAX_BYTES = 64 * 1024 * 1024;
const DELIMITED_FIRST_CHUNK = 1024 * 1024;

async function readFilePrefix(fd: fs.promises.FileHandle, bytes: number): Promise<Buffer> {
  const buf = Buffer.alloc(bytes);
  const { bytesRead } = await fd.read(buf, 0, bytes, 0);
  return bytesRead === bytes ? buf : buf.subarray(0, bytesRead);
}

/** Count `\n` from `offset` to EOF in 4 MB chunks (native indexOf — fast). */
async function countNewlinesFrom(fd: fs.promises.FileHandle, offset: number, size: number): Promise<{ newlines: number; endsWithNewline: boolean }> {
  const CHUNK = 4 * 1024 * 1024;
  const buf = Buffer.alloc(CHUNK);
  let pos = offset;
  let newlines = 0;
  let last = 0x0a;
  while (pos < size) {
    const { bytesRead } = await fd.read(buf, 0, Math.min(CHUNK, size - pos), pos);
    if (bytesRead <= 0) break;
    let i = 0;
    for (;;) {
      const at = buf.indexOf(0x0a, i);
      if (at === -1 || at >= bytesRead) break;
      newlines++;
      i = at + 1;
    }
    last = buf[bytesRead - 1];
    pos += bytesRead;
  }
  return { newlines, endsWithNewline: last === 0x0a };
}

/**
 * Delimited file by window: read a prefix just big enough for `maxRows`
 * complete records (growing 1 → 4 → 16 → 64 MB), parse it, then count the
 * remaining newlines to report the total. Files of any size open in ~O(window);
 * a quoted field containing newlines makes the tail count an overestimate,
 * which the response flags as approximate.
 */
async function readDelimitedWindow(fd: fs.promises.FileHandle, size: number, ext: string, opts: ParseOptions): Promise<ParsedSpreadsheet> {
  const { maxRows, maxCols } = clampCaps(opts);
  let prefixBytes = Math.min(size, DELIMITED_FIRST_CHUNK);
  let text = '';
  let delimiter = ext === '.tsv' ? '\t' : ',';
  let grid = parseDelimited('', delimiter, opts);
  let usedBytes = 0;
  for (;;) {
    const raw = await readFilePrefix(fd, prefixBytes);
    // Cut at the last newline unless this is the whole file.
    let cut = raw.length;
    if (raw.length < size) {
      const nl = raw.lastIndexOf(0x0a);
      cut = nl === -1 ? 0 : nl + 1;
    }
    usedBytes = cut;
    text = decodeTextBuffer(raw.subarray(0, cut));
    delimiter = ext === '.tsv' ? '\t' : sniffDelimiter(text);
    grid = parseDelimited(text, delimiter, { ...opts, maxRows, maxCols });
    const enough = grid.rowCount > maxRows || raw.length >= size;
    if (enough || prefixBytes >= DELIMITED_PREFIX_MAX_BYTES) break;
    prefixBytes = Math.min(size, Math.max(prefixBytes * 4, DELIMITED_FIRST_CHUNK));
  }
  let rowCountApprox = false;
  if (usedBytes < size) {
    const tail = await countNewlinesFrom(fd, usedBytes, size);
    grid.rowCount += tail.newlines + (tail.endsWithNewline ? 0 : 1);
    grid.truncatedRows = grid.rowCount > grid.rows.length;
    rowCountApprox = true;
  }
  return {
    format: ext === '.tsv' ? 'tsv' : 'csv',
    delimiter,
    sheets: [{ name: '' }],
    sheetIndex: 0,
    sheet: rowCountApprox ? { name: '', ...grid, rowCountApprox: true } : { name: '', ...grid },
  };
}

/** Read a spreadsheet file from disk. Throws `UnsupportedSpreadsheetError`
 * for recognized-but-unparseable formats and plain Errors for corrupt files. */
export async function readSpreadsheet(filePath: string, opts: ParseOptions = {}): Promise<ParsedSpreadsheet> {
  const kind = detectSpreadsheetKind(filePath);
  const ext = path.extname(filePath).toLowerCase();
  const name = path.basename(filePath, ext);
  if (kind === null) throw new UnsupportedSpreadsheetError(`Not a spreadsheet: ${ext || 'no extension'}`, ext);
  const fd = await fs.promises.open(filePath, 'r');
  try {
    const { size } = await fd.stat();
    const head = await readFilePrefix(fd, Math.min(size, 64 * 1024));
    const sniffed = sniffSpreadsheetHead(head);
    if (sniffed === 'delimited') {
      const parsed = await readDelimitedWindow(fd, size, ext, opts);
      parsed.sheets = [{ name }];
      parsed.sheet = { ...parsed.sheet, name };
      return parsed;
    }
    if (sniffed === 'zip') {
      // Workbooks/ODS: index the central directory from the tail and read only
      // the members needed — the file itself is never loaded whole.
      const src = await zipSourceFromFd(fd, size);
      if (src.members.has('xl/workbook.xml')) return await parseXlsxSource(src, opts);
      if (src.members.has('content.xml')) {
        const mime = await src.readMember('mimetype');
        const mimeText = mime ? mime.toString('utf8') : '';
        if (!mimeText || /spreadsheet/.test(mimeText)) {
          const content = await src.readMember('content.xml');
          if (!content) throw new Error('not an OpenDocument spreadsheet (content.xml missing)');
          return parseOdsContentXml(content.toString('utf8'), opts);
        }
      }
      throw new Error('zip container is neither an Excel workbook nor an OpenDocument spreadsheet');
    }
    if (size > SPREADSHEET_MAX_CONTAINER_BYTES) {
      throw new Error(`File too large to preview as a grid (${Math.round(size / 1024 / 1024)} MB > ${SPREADSHEET_MAX_CONTAINER_BYTES / 1024 / 1024} MB)`);
    }
    const buf = Buffer.alloc(size);
    let off = 0;
    while (off < size) {
      const { bytesRead } = await fd.read(buf, off, size - off, off);
      if (bytesRead <= 0) break;
      off += bytesRead;
    }
    // `await` inside the try: a rejection must be observed before `finally`
    // yields to close the fd, or Node reports it as unhandled for a tick.
    return await parseSpreadsheetBuffer(buf, filePath, opts);
  } finally {
    await fd.close();
  }
}

/** Parse from memory: sniff the real format, then dispatch. */
export async function parseSpreadsheetBuffer(buf: Buffer, filePath: string, opts: ParseOptions = {}): Promise<ParsedSpreadsheet> {
  const ext = path.extname(filePath).toLowerCase();
  const name = path.basename(filePath, ext);
  const { maxRows, maxCols } = clampCaps(opts);
  const sniffed = sniffSpreadsheetBuffer(buf);
  switch (sniffed) {
    case 'xlsx': return parseXlsxBuffer(buf, opts);
    case 'ods': return parseOdsBuffer(buf, opts);
    case 'xls': return parseXlsBuffer(buf, { ...opts, maxRows, maxCols });
    case 'biff-legacy':
      throw new UnsupportedSpreadsheetError('This is an Excel 2.x/3.0/4.0 worksheet (BIFF2-4) — too old for the built-in viewer; open it in LibreOffice and save as .xlsx.', ext);
    case 'zip-unknown':
      throw new Error('zip container is neither an Excel workbook nor an OpenDocument spreadsheet');
    case 'html': {
      const grid = parseHtmlTable(decodeTextBuffer(buf), opts);
      return { format: 'html', sheets: [{ name }], sheetIndex: 0, sheet: { name, ...grid } };
    }
    case 'delimited':
    default: {
      const text = decodeTextBuffer(buf);
      const format = ext === '.tsv' ? 'tsv' : 'csv';
      const delimiter = format === 'tsv' ? '\t' : sniffDelimiter(text);
      const grid = parseDelimited(text, delimiter, opts);
      return { format, delimiter, sheets: [{ name }], sheetIndex: 0, sheet: { name, ...grid } };
    }
  }
}
