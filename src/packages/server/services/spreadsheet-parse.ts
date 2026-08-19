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
/** Whole-file cap: the workbook is buffered in memory. */
export const SPREADSHEET_MAX_FILE_BYTES = 64 * 1024 * 1024;
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

/** Central-directory index of an in-memory zip. Throws when it isn't a zip. */
export function indexZip(buf: Buffer): Map<string, ZipMember> {
  if (buf.length < 22) throw new Error('not a zip archive (too small)');
  let eocdPos = -1;
  const scanFrom = Math.max(0, buf.length - 22 - 0xffff);
  for (let i = buf.length - 22; i >= scanFrom; i--) {
    if (buf.readUInt32LE(i) === SIG_EOCD) { eocdPos = i; break; }
  }
  if (eocdPos < 0) throw new Error('not a zip archive (no end-of-central-directory record)');
  let cdSize: number = buf.readUInt32LE(eocdPos + 12);
  let cdOffset: number = buf.readUInt32LE(eocdPos + 16);
  if (cdSize === 0xffffffff || cdOffset === 0xffffffff) {
    const locPos = eocdPos - 20;
    if (locPos >= 0 && buf.readUInt32LE(locPos) === SIG_EOCD64_LOCATOR) {
      const rec = Number(buf.readBigUInt64LE(locPos + 8));
      if (rec + 56 <= buf.length && buf.readUInt32LE(rec) === SIG_EOCD64) {
        cdSize = Number(buf.readBigUInt64LE(rec + 40));
        cdOffset = Number(buf.readBigUInt64LE(rec + 48));
      }
    }
  }
  if (cdOffset + cdSize > buf.length) throw new Error('corrupt zip (central directory beyond end of file)');

  const members = new Map<string, ZipMember>();
  let pos = cdOffset;
  const end = cdOffset + cdSize;
  while (pos + 46 <= end && buf.readUInt32LE(pos) === SIG_CENTRAL) {
    const flags = buf.readUInt16LE(pos + 8);
    const method = buf.readUInt16LE(pos + 10);
    let csize: number = buf.readUInt32LE(pos + 20);
    let usize: number = buf.readUInt32LE(pos + 24);
    const nameLen = buf.readUInt16LE(pos + 28);
    const extraLen = buf.readUInt16LE(pos + 30);
    const commentLen = buf.readUInt16LE(pos + 32);
    let localHeaderOffset: number = buf.readUInt32LE(pos + 42);
    const nameBytes = buf.subarray(pos + 46, pos + 46 + nameLen);
    const extra = buf.subarray(pos + 46 + nameLen, pos + 46 + nameLen + extraLen);
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

/** Inflate one member (stored or deflated). */
export function readZipMember(buf: Buffer, member: ZipMember): Buffer {
  const lh = member.localHeaderOffset;
  if (lh + 30 > buf.length || buf.readUInt32LE(lh) !== SIG_LOCAL) throw new Error(`corrupt zip (bad local header for ${member.name})`);
  const nameLen = buf.readUInt16LE(lh + 26);
  const extraLen = buf.readUInt16LE(lh + 28);
  const start = lh + 30 + nameLen + extraLen;
  const endPos = start + member.compressedSize;
  if (endPos > buf.length) throw new Error(`corrupt zip (member ${member.name} beyond end of file)`);
  if (member.uncompressedSize > MAX_MEMBER_BYTES) throw new Error(`${member.name} is too large to read (${member.uncompressedSize} bytes)`);
  const data = buf.subarray(start, endPos);
  if (member.method === 0) return data;
  if (member.method === 8) return zlib.inflateRawSync(data, { maxOutputLength: MAX_MEMBER_BYTES });
  throw new Error(`unsupported zip compression method ${member.method} for ${member.name}`);
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
  sharedStrings: string[];
  styles: Styles;
  date1904: boolean;
  maxRows: number;
  maxCols: number;
}

function cellDisplay(attrs: string, inner: string | undefined, ctx: SheetParseContext): string {
  const t = attr(attrs, 't') ?? 'n';
  if (t === 'inlineStr') return inner === undefined ? '' : textRuns(inner);
  const vm = inner === undefined ? null : /<(?:[\w.-]+:)?v\b[^>]*?(?:\/>|>([\s\S]*?)<\/(?:[\w.-]+:)?v>)/.exec(inner);
  const v = vm && vm[1] !== undefined ? decodeXmlEntities(vm[1]) : '';
  if (v === '') return '';
  switch (t) {
    case 's': {
      const idx = parseInt(v, 10);
      return Number.isFinite(idx) ? (ctx.sharedStrings[idx] ?? '') : '';
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

/** Parse an .xlsx/.xlsm buffer: full sheet list + ONE sheet's grid. */
export function parseXlsxBuffer(buf: Buffer, opts: ParseOptions = {}): ParsedSpreadsheet {
  const { maxRows, maxCols } = clampCaps(opts);
  const members = indexZip(buf);
  const read = (name: string): string | null => {
    const m = members.get(name);
    return m ? readZipMember(buf, m).toString('utf8') : null;
  };
  const workbookXml = read('xl/workbook.xml');
  if (workbookXml === null) throw new Error('not an Excel workbook (xl/workbook.xml missing)');
  const workbook = parseWorkbook(workbookXml);
  if (workbook.sheets.length === 0) throw new Error('workbook has no sheets');
  const rels = parseWorkbookRels(read('xl/_rels/workbook.xml.rels') ?? '');

  const sheets: SpreadsheetSheetInfo[] = workbook.sheets.map((s) => (s.hidden ? { name: s.name, hidden: true } : { name: s.name }));
  const sheetIndex = Math.min(Math.max(0, Math.floor(opts.sheetIndex ?? 0)), workbook.sheets.length - 1);
  const target = workbook.sheets[sheetIndex];
  let memberName = target.rId ? rels.get(target.rId) : undefined;
  if (!memberName || !members.has(memberName)) {
    // No rels (or a broken one): fall back to the conventional numbering.
    const fallback = `xl/worksheets/sheet${sheetIndex + 1}.xml`;
    memberName = members.has(fallback) ? fallback : memberName;
  }
  const sheetXml = memberName ? read(memberName) : null;
  if (sheetXml === null) throw new Error(`worksheet "${target.name}" not found in workbook`);

  const ctx: SheetParseContext = {
    sharedStrings: parseSharedStrings(read('xl/sharedStrings.xml') ?? ''),
    styles: parseStyles(read('xl/styles.xml') ?? ''),
    date1904: workbook.date1904,
    maxRows,
    maxCols,
  };
  const grid = parseWorksheet(sheetXml, ctx);
  return {
    format: 'xlsx',
    sheets,
    sheetIndex,
    sheet: { ...sheets[sheetIndex], ...grid },
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
  const { maxRows, maxCols } = clampCaps(opts);
  const members = indexZip(buf);
  const content = members.get('content.xml');
  if (!content) throw new Error('not an OpenDocument spreadsheet (content.xml missing)');
  const xml = readZipMember(buf, content).toString('utf8');

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

/** Read a spreadsheet file from disk. Throws `UnsupportedSpreadsheetError`
 * for recognized-but-unparseable formats and plain Errors for corrupt files. */
export async function readSpreadsheet(filePath: string, opts: ParseOptions = {}): Promise<ParsedSpreadsheet> {
  const kind = detectSpreadsheetKind(filePath);
  const ext = path.extname(filePath).toLowerCase();
  if (kind === null) throw new UnsupportedSpreadsheetError(`Not a spreadsheet: ${ext || 'no extension'}`, ext);
  const stat = await fs.promises.stat(filePath);
  if (stat.size > SPREADSHEET_MAX_FILE_BYTES) {
    throw new Error(`File too large to preview as a grid (${Math.round(stat.size / 1024 / 1024)} MB > ${SPREADSHEET_MAX_FILE_BYTES / 1024 / 1024} MB)`);
  }
  const buf = await fs.promises.readFile(filePath);
  return parseSpreadsheetBuffer(buf, filePath, opts);
}

/** Parse from memory: sniff the real format, then dispatch. */
export function parseSpreadsheetBuffer(buf: Buffer, filePath: string, opts: ParseOptions = {}): ParsedSpreadsheet {
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
