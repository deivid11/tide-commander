/**
 * Legacy Excel (.xls, BIFF5/BIFF8) reader — dependency-free.
 *
 * An .xls is an OLE2 Compound File (CFB) whose "Workbook" (BIFF8, Excel
 * 97-2003) or "Book" (BIFF5/7, Excel 5/95) stream is a sequence of BIFF
 * records: the workbook globals (code page, 1904 flag, FORMAT/XF tables, the
 * shared string table, BOUNDSHEET entries) followed by one substream per
 * sheet with the cell records. This module reads the CFB container, walks the
 * globals once, then decodes ONLY the requested sheet's substream into the
 * same capped grid shape as the xlsx reader (values as display strings,
 * dates/percentages resolved through the XF → number-format chain).
 *
 * Coverage: LABELSST / LABEL / RSTRING, NUMBER / RK / MULRK, BOOLERR,
 * FORMULA (+ STRING results), BLANK / MULBLANK (skipped), DIMENSIONS, hidden
 * sheets, SST spanning CONTINUE records (with the per-chunk char-width flag),
 * rich-text and phonetic payloads, code-page byte strings for BIFF5.
 * BIFF2/3/4 (single-sheet, no CFB) are detected and refused with a message.
 */

import type { ParseOptions, ParsedSpreadsheet } from './spreadsheet-parse.js';
import type { SpreadsheetSheetData, SpreadsheetSheetInfo } from '../../shared/spreadsheet-types.js';
import { classifyNumberFormat, EXCEL_ERROR_CODES, formatNumberCell, type NumberFormat } from './spreadsheet-format.js';

const CFB_MAGIC = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
const ENDOFCHAIN = 0xfffffffe;
const FREESECT = 0xffffffff;
const MAX_STREAM_BYTES = 256 * 1024 * 1024;

export function isCfbBuffer(buf: Buffer): boolean {
  return buf.length >= 8 && buf.subarray(0, 8).equals(CFB_MAGIC);
}

/** BIFF2/3/4 worksheet streams start with a bare BOF record (no CFB wrapper). */
export function isBiffLegacyStream(buf: Buffer): boolean {
  if (buf.length < 4) return false;
  const type = buf.readUInt16LE(0);
  return type === 0x0009 || type === 0x0209 || type === 0x0409;
}

// ── CFB container ───────────────────────────────────────────────────────────

interface CfbFile {
  sectorSize: number;
  miniSectorSize: number;
  fat: Uint32Array;
  miniFat: Uint32Array;
  miniStream: Buffer;
  miniCutoff: number;
  entries: CfbEntry[];
}

interface CfbEntry {
  name: string;
  type: number;
  startSector: number;
  size: number;
}

function readCfb(buf: Buffer): CfbFile {
  if (!isCfbBuffer(buf)) throw new Error('not an OLE2 compound file');
  const sectorShift = buf.readUInt16LE(0x1e);
  const miniShift = buf.readUInt16LE(0x20);
  const sectorSize = 1 << sectorShift;
  const miniSectorSize = 1 << miniShift;
  const numFatSectors = buf.readUInt32LE(0x2c);
  const firstDirSector = buf.readUInt32LE(0x30);
  const miniCutoff = buf.readUInt32LE(0x38);
  const firstMiniFatSector = buf.readUInt32LE(0x3c);
  const numMiniFatSectors = buf.readUInt32LE(0x40);
  const firstDifatSector = buf.readUInt32LE(0x44);
  const numDifatSectors = buf.readUInt32LE(0x48);
  const entriesPerSector = sectorSize / 4;

  const sectorOffset = (n: number) => (n + 1) * sectorSize;
  const readSector = (n: number): Buffer => {
    const off = sectorOffset(n);
    if (off + sectorSize > buf.length) {
      // Truncated files: pad the last sector instead of failing outright.
      const out = Buffer.alloc(sectorSize);
      if (off < buf.length) buf.copy(out, 0, off);
      return out;
    }
    return buf.subarray(off, off + sectorSize);
  };

  // DIFAT → list of FAT sectors.
  const fatSectors: number[] = [];
  for (let i = 0; i < 109 && fatSectors.length < numFatSectors; i++) {
    const s = buf.readUInt32LE(0x4c + i * 4);
    if (s === FREESECT || s === ENDOFCHAIN) break;
    fatSectors.push(s);
  }
  let difat = firstDifatSector;
  let guard = 0;
  while (difat !== ENDOFCHAIN && difat !== FREESECT && guard++ < numDifatSectors + 1) {
    const sec = readSector(difat);
    for (let i = 0; i < entriesPerSector - 1 && fatSectors.length < numFatSectors; i++) {
      const s = sec.readUInt32LE(i * 4);
      if (s === FREESECT || s === ENDOFCHAIN) break;
      fatSectors.push(s);
    }
    difat = sec.readUInt32LE((entriesPerSector - 1) * 4);
  }
  const fat = new Uint32Array(fatSectors.length * entriesPerSector);
  fatSectors.forEach((s, i) => {
    const sec = readSector(s);
    for (let j = 0; j < entriesPerSector; j++) fat[i * entriesPerSector + j] = sec.readUInt32LE(j * 4);
  });

  const readChain = (start: number, sizeHint?: number): Buffer => {
    const parts: Buffer[] = [];
    let s = start;
    let total = 0;
    let steps = 0;
    const maxSteps = fat.length + 2;
    while (s !== ENDOFCHAIN && s !== FREESECT && s < 0xfffffffa && steps++ < maxSteps) {
      parts.push(readSector(s));
      total += sectorSize;
      if (total > MAX_STREAM_BYTES) throw new Error('compound file stream too large');
      if (sizeHint !== undefined && total >= sizeHint) break;
      s = s < fat.length ? fat[s] : ENDOFCHAIN;
    }
    const joined = Buffer.concat(parts);
    return sizeHint !== undefined ? joined.subarray(0, Math.min(sizeHint, joined.length)) : joined;
  };

  // Directory entries.
  const dir = readChain(firstDirSector);
  const entries: CfbEntry[] = [];
  for (let off = 0; off + 128 <= dir.length; off += 128) {
    const nameLen = dir.readUInt16LE(off + 0x40);
    const type = dir[off + 0x42];
    if (type === 0 && nameLen === 0) continue;
    const name = dir.subarray(off, off + Math.max(0, Math.min(64, nameLen) - 2)).toString('utf16le');
    const startSector = dir.readUInt32LE(off + 0x74);
    // 64-bit size field; anything beyond 2^32 is nonsense for our purposes.
    const size = dir.readUInt32LE(off + 0x78);
    entries.push({ name, type, startSector, size });
  }
  const root = entries.find((e) => e.type === 5) ?? entries[0];

  // Mini FAT + mini stream (root entry's chain).
  let miniFat = new Uint32Array(0);
  let miniStream: Buffer = Buffer.alloc(0);
  if (root && numMiniFatSectors > 0 && firstMiniFatSector !== ENDOFCHAIN) {
    const mf = readChain(firstMiniFatSector);
    miniFat = new Uint32Array(Math.floor(mf.length / 4));
    for (let i = 0; i < miniFat.length; i++) miniFat[i] = mf.readUInt32LE(i * 4);
    miniStream = readChain(root.startSector, root.size);
  }

  return { sectorSize, miniSectorSize, fat, miniFat, miniStream, miniCutoff, entries };
}

function readCfbStream(cfb: CfbFile, entry: CfbEntry, buf: Buffer): Buffer {
  if (entry.size < cfb.miniCutoff) {
    const parts: Buffer[] = [];
    let s = entry.startSector;
    let total = 0;
    let steps = 0;
    while (s !== ENDOFCHAIN && s !== FREESECT && s < 0xfffffffa && steps++ < cfb.miniFat.length + 2 && total < entry.size) {
      const off = s * cfb.miniSectorSize;
      parts.push(cfb.miniStream.subarray(off, off + cfb.miniSectorSize));
      total += cfb.miniSectorSize;
      s = s < cfb.miniFat.length ? cfb.miniFat[s] : ENDOFCHAIN;
    }
    return Buffer.concat(parts).subarray(0, entry.size);
  }
  const parts: Buffer[] = [];
  let s = entry.startSector;
  let total = 0;
  let steps = 0;
  while (s !== ENDOFCHAIN && s !== FREESECT && s < 0xfffffffa && steps++ < cfb.fat.length + 2 && total < entry.size) {
    const off = (s + 1) * cfb.sectorSize;
    const sec = off + cfb.sectorSize <= buf.length ? buf.subarray(off, off + cfb.sectorSize) : Buffer.concat([buf.subarray(off), Buffer.alloc(Math.max(0, off + cfb.sectorSize - buf.length))]);
    parts.push(sec);
    total += cfb.sectorSize;
    if (total > MAX_STREAM_BYTES) throw new Error('compound file stream too large');
    s = s < cfb.fat.length ? cfb.fat[s] : ENDOFCHAIN;
  }
  return Buffer.concat(parts).subarray(0, entry.size);
}

/** Locate and read the BIFF workbook stream ("Workbook" for BIFF8, "Book" for BIFF5). */
export function extractWorkbookStream(buf: Buffer): { stream: Buffer; streamName: string } {
  const cfb = readCfb(buf);
  const byName = (n: string) => cfb.entries.find((e) => e.type === 2 && e.name.toLowerCase() === n);
  const entry = byName('workbook') ?? byName('book');
  if (!entry) {
    const names = cfb.entries.filter((e) => e.type === 2).map((e) => e.name).slice(0, 8).join(', ');
    throw new Error(`OLE2 file without a Workbook stream (streams: ${names || 'none'}) — not an Excel workbook`);
  }
  return { stream: readCfbStream(cfb, entry, buf), streamName: entry.name };
}

// ── BIFF records ────────────────────────────────────────────────────────────

const REC = {
  BOF_BIFF5_8: 0x0809,
  EOF: 0x000a,
  CODEPAGE: 0x0042,
  DATEMODE: 0x0022,
  FORMAT: 0x041e,
  XF: 0x00e0,
  BOUNDSHEET: 0x0085,
  SST: 0x00fc,
  CONTINUE: 0x003c,
  DIMENSIONS: 0x0200,
  BLANK: 0x0201,
  NUMBER: 0x0203,
  LABEL: 0x0204,
  BOOLERR: 0x0205,
  FORMULA: 0x0006,
  STRING: 0x0207,
  RK: 0x027e,
  MULRK: 0x00bd,
  MULBLANK: 0x00be,
  LABELSST: 0x00fd,
  RSTRING: 0x00d6,
  // BIFF5-era formula record id (Excel 5/95 writes 0x0406 in some files).
  FORMULA_ALT: 0x0406,
} as const;

interface BiffRecord {
  type: number;
  /** Absolute offset of the record header in the stream. */
  pos: number;
  data: Buffer;
  /** Offset just past this record (start of the next one). */
  next: number;
}

function readRecord(stream: Buffer, pos: number): BiffRecord | null {
  if (pos + 4 > stream.length) return null;
  const type = stream.readUInt16LE(pos);
  const len = stream.readUInt16LE(pos + 2);
  const end = Math.min(stream.length, pos + 4 + len);
  return { type, pos, data: stream.subarray(pos + 4, end), next: end };
}

/** Code page → TextDecoder label for BIFF5 byte strings and BIFF8 compressed
 * strings are latin1 by definition (low byte of UTF-16). */
function decoderFor(codepage: number): TextDecoder | null {
  const label = ({
    437: 'ibm437', 850: 'ibm850', 866: 'ibm866', 874: 'windows-874',
    932: 'shift_jis', 936: 'gbk', 949: 'euc-kr', 950: 'big5',
    1250: 'windows-1250', 1251: 'windows-1251', 1252: 'windows-1252', 1253: 'windows-1253',
    1254: 'windows-1254', 1255: 'windows-1255', 1256: 'windows-1256', 1257: 'windows-1257', 1258: 'windows-1258',
    10000: 'macintosh', 20127: 'ascii', 28591: 'iso-8859-1', 28592: 'iso-8859-2', 65001: 'utf-8',
  } as Record<number, string>)[codepage];
  if (!label) return null;
  try {
    return new TextDecoder(label);
  } catch {
    return null;
  }
}

/**
 * Cursor over the concatenated data of an SST record and its CONTINUE
 * records. Character runs may break at a chunk boundary, where the next
 * chunk restarts with its own 1-byte "16-bit chars?" flag; rich-text runs
 * and phonetic blobs are raw bytes that just continue across the boundary.
 */
class ChunkCursor {
  private chunk = 0;
  private off = 0;
  constructor(private readonly chunks: Buffer[]) {}

  get atEnd(): boolean {
    return this.chunk >= this.chunks.length || (this.chunk === this.chunks.length - 1 && this.off >= this.chunks[this.chunk].length);
  }

  private normalize(): void {
    while (this.chunk < this.chunks.length && this.off >= this.chunks[this.chunk].length) {
      this.chunk++;
      this.off = 0;
    }
  }

  /** True when positioned exactly at the start of a continuation chunk. */
  get atChunkStart(): boolean {
    this.normalize();
    return this.chunk > 0 && this.off === 0 && this.chunk < this.chunks.length;
  }

  private remainingInChunk(): number {
    this.normalize();
    return this.chunk < this.chunks.length ? this.chunks[this.chunk].length - this.off : 0;
  }

  u8(): number {
    this.normalize();
    if (this.chunk >= this.chunks.length) throw new Error('SST truncated');
    return this.chunks[this.chunk][this.off++];
  }

  u16(): number {
    return this.u8() | (this.u8() << 8);
  }

  u32(): number {
    return (this.u16() | (this.u16() << 16)) >>> 0;
  }

  skip(n: number): void {
    while (n > 0) {
      const avail = this.remainingInChunk();
      if (avail === 0) throw new Error('SST truncated');
      const take = Math.min(avail, n);
      this.off += take;
      n -= take;
    }
  }

  /** Read `count` characters, honoring the width flag reset at chunk starts. */
  chars(count: number, wide: boolean, byteDecoder: TextDecoder | null): string {
    let out = '';
    let remaining = count;
    let isWide = wide;
    while (remaining > 0) {
      this.normalize();
      if (this.chunk >= this.chunks.length) throw new Error('SST truncated');
      if (this.atChunkStart) {
        // Continuation: the flag byte says how the REST of this string is stored.
        isWide = (this.u8() & 1) !== 0;
        this.normalize();
        if (this.chunk >= this.chunks.length) throw new Error('SST truncated');
      }
      const avail = this.chunks[this.chunk].length - this.off;
      const bytesPer = isWide ? 2 : 1;
      const take = Math.min(remaining, Math.floor(avail / bytesPer));
      if (take === 0) {
        // Odd trailing byte before a boundary (shouldn't happen for wide runs); skip it.
        this.off = this.chunks[this.chunk].length;
        continue;
      }
      const slice = this.chunks[this.chunk].subarray(this.off, this.off + take * bytesPer);
      out += isWide ? slice.toString('utf16le') : (byteDecoder ? byteDecoder.decode(slice) : slice.toString('latin1'));
      this.off += take * bytesPer;
      remaining -= take;
    }
    return out;
  }
}

/** BIFF8 unicode string (long form: 16-bit length) from a cursor. */
function readUnicodeStringLong(cur: ChunkCursor): string {
  const cch = cur.u16();
  return readUnicodeStringBody(cur, cch);
}

function readUnicodeStringBody(cur: ChunkCursor, cch: number): string {
  const flags = cur.u8();
  const wide = (flags & 0x01) !== 0;
  const hasExt = (flags & 0x04) !== 0;
  const hasRich = (flags & 0x08) !== 0;
  const richRuns = hasRich ? cur.u16() : 0;
  const extSize = hasExt ? cur.u32() : 0;
  // BIFF8 compressed chars are the low byte of UTF-16 → latin1, never the code page.
  const text = cur.chars(cch, wide, null);
  if (richRuns) cur.skip(richRuns * 4);
  if (extSize) cur.skip(extSize);
  return text;
}

/** In-record string helpers (no CONTINUE handling; used for LABEL/BOUNDSHEET/FORMAT/STRING). */
function readInlineString(data: Buffer, offset: number, biff8: boolean, lengthBytes: 1 | 2, decoder: TextDecoder | null): { text: string; next: number } {
  let pos = offset;
  if (pos + lengthBytes > data.length) return { text: '', next: data.length };
  const cch = lengthBytes === 1 ? data[pos] : data.readUInt16LE(pos);
  pos += lengthBytes;
  if (!biff8) {
    const slice = data.subarray(pos, pos + cch);
    return { text: decoder ? decoder.decode(slice) : slice.toString('latin1'), next: pos + cch };
  }
  const cur = new ChunkCursor([data.subarray(pos)]);
  try {
    const text = readUnicodeStringBody(cur, cch);
    // Where the cursor ended is not exposed; recompute conservatively.
    return { text, next: data.length };
  } catch {
    return { text: '', next: data.length };
  }
}

/** RK number decoding (§2.5.198.112 MS-XLS). */
function decodeRk(rk: number): number {
  const mul100 = (rk & 0x01) !== 0;
  const isInt = (rk & 0x02) !== 0;
  let value: number;
  if (isInt) {
    value = rk >> 2; // signed 30-bit
  } else {
    const b = Buffer.alloc(8);
    b.writeUInt32LE(0, 0);
    b.writeUInt32LE((rk & 0xfffffffc) >>> 0, 4);
    value = b.readDoubleLE(0);
  }
  return mul100 ? value / 100 : value;
}

interface WorkbookGlobals {
  biff8: boolean;
  codepage: number;
  decoder: TextDecoder | null;
  date1904: boolean;
  formats: Map<number, string>;
  xfFormats: NumberFormat[];
  sst: string[];
  sheets: Array<{ name: string; offset: number; hidden: boolean; isWorksheet: boolean }>;
  /** Offset just past the globals EOF (first sheet BOF, when BOUNDSHEET offsets are unusable). */
  globalsEnd: number;
}

function parseGlobals(stream: Buffer): WorkbookGlobals {
  const first = readRecord(stream, 0);
  if (!first || first.type !== REC.BOF_BIFF5_8 || first.data.length < 4) {
    throw new Error('workbook stream does not start with a BIFF5/BIFF8 BOF record');
  }
  const version = first.data.readUInt16LE(0);
  const biff8 = version >= 0x0600;
  const g: WorkbookGlobals = {
    biff8,
    codepage: 1252,
    decoder: decoderFor(1252),
    date1904: false,
    formats: new Map(),
    xfFormats: [],
    sst: [],
    sheets: [],
    globalsEnd: stream.length,
  };
  // XF number-format ids are resolved after FORMAT records are all known.
  const xfNumFmtIds: number[] = [];

  let pos = first.next;
  let rec: BiffRecord | null;
  while ((rec = readRecord(stream, pos)) !== null) {
    pos = rec.next;
    const d = rec.data;
    switch (rec.type) {
      case REC.EOF:
        g.globalsEnd = pos;
        pos = stream.length; // stop the loop
        break;
      case REC.CODEPAGE:
        if (d.length >= 2) {
          g.codepage = d.readUInt16LE(0);
          g.decoder = g.codepage === 1200 ? null : decoderFor(g.codepage);
        }
        break;
      case REC.DATEMODE:
        if (d.length >= 2) g.date1904 = d.readUInt16LE(0) === 1;
        break;
      case REC.FORMAT: {
        if (d.length < 3) break;
        const id = d.readUInt16LE(0);
        const { text } = readInlineString(d, 2, biff8, biff8 ? 2 : 1, g.decoder);
        g.formats.set(id, text);
        break;
      }
      case REC.XF:
        if (d.length >= 4) xfNumFmtIds.push(d.readUInt16LE(2));
        break;
      case REC.BOUNDSHEET: {
        if (d.length < 6) break;
        const offset = d.readUInt32LE(0);
        const visibility = d[4] & 0x03;
        const sheetType = d[5];
        const { text } = readInlineString(d, 6, biff8, 1, g.decoder);
        g.sheets.push({ name: text, offset, hidden: visibility !== 0, isWorksheet: sheetType === 0 });
        break;
      }
      case REC.SST: {
        // Gather CONTINUE chunks that belong to this SST.
        const chunks: Buffer[] = [d];
        let p = pos;
        let cont: BiffRecord | null;
        while ((cont = readRecord(stream, p)) !== null && cont.type === REC.CONTINUE) {
          chunks.push(cont.data);
          p = cont.next;
        }
        pos = p;
        const cur = new ChunkCursor(chunks);
        try {
          cur.u32(); // total string count (with duplicates)
          const unique = cur.u32();
          for (let i = 0; i < unique && !cur.atEnd; i++) {
            g.sst.push(readUnicodeStringLong(cur));
          }
        } catch {
          // Truncated SST: keep what we decoded; missing strings render empty.
        }
        break;
      }
      default:
        break;
    }
    if (pos >= stream.length) break;
  }
  g.xfFormats = xfNumFmtIds.map((id) => classifyNumberFormat(id, g.formats.get(id)));
  return g;
}

type SheetGrid = Omit<SpreadsheetSheetData, 'name' | 'hidden'>;

function parseSheetSubstream(stream: Buffer, start: number, g: WorkbookGlobals, maxRows: number, maxCols: number): SheetGrid {
  const rows: string[][] = [];
  let maxRowSeen = -1;
  let maxColSeen = -1;
  let dimRows: number | undefined;
  let dimCols: number | undefined;
  let truncatedCols = false;

  // Cell records come in ascending row blocks, so once a cell past the cap
  // shows up (and DIMENSIONS already told us the extent) the rest of the
  // substream can be skipped without decoding — the window is complete.
  let stopEarly = false;
  const put = (row: number, col: number, text: string) => {
    if (row > maxRowSeen) maxRowSeen = row;
    if (col > maxColSeen) maxColSeen = col;
    if (row >= maxRows) { if (dimRows !== undefined) stopEarly = true; return; }
    if (col >= maxCols) { truncatedCols = true; return; }
    if (text === '') return;
    while (rows.length <= row) rows.push([]);
    const r = rows[row];
    while (r.length < col) r.push('');
    r[col] = text;
  };
  const numText = (value: number, xf: number) => formatNumberCell(value, g.xfFormats[xf], g.date1904);

  const bof = readRecord(stream, start);
  if (!bof || bof.type !== REC.BOF_BIFF5_8) throw new Error('sheet substream does not start with BOF');
  let pos = bof.next;
  let rec: BiffRecord | null;
  // FORMULA whose result is a string: the STRING record that follows carries it.
  let pendingString: { row: number; col: number } | null = null;

  while ((rec = readRecord(stream, pos)) !== null) {
    pos = rec.next;
    const d = rec.data;
    if (rec.type === REC.EOF || stopEarly) break;
    switch (rec.type) {
      case REC.DIMENSIONS:
        if (g.biff8 && d.length >= 12) {
          dimRows = d.readUInt32LE(4);
          dimCols = d.readUInt16LE(10);
        } else if (!g.biff8 && d.length >= 8) {
          dimRows = d.readUInt16LE(2);
          dimCols = d.readUInt16LE(6);
        }
        break;
      case REC.LABELSST: {
        if (d.length < 10) break;
        const row = d.readUInt16LE(0);
        const col = d.readUInt16LE(2);
        const idx = d.readUInt32LE(6);
        put(row, col, g.sst[idx] ?? '');
        break;
      }
      case REC.LABEL:
      case REC.RSTRING: {
        if (d.length < 8) break;
        const row = d.readUInt16LE(0);
        const col = d.readUInt16LE(2);
        const { text } = readInlineString(d, 6, g.biff8, 2, g.decoder);
        put(row, col, text);
        break;
      }
      case REC.NUMBER: {
        if (d.length < 14) break;
        put(d.readUInt16LE(0), d.readUInt16LE(2), numText(d.readDoubleLE(6), d.readUInt16LE(4)));
        break;
      }
      case REC.RK: {
        if (d.length < 10) break;
        put(d.readUInt16LE(0), d.readUInt16LE(2), numText(decodeRk(d.readInt32LE(6)), d.readUInt16LE(4)));
        break;
      }
      case REC.MULRK: {
        if (d.length < 12) break;
        const row = d.readUInt16LE(0);
        const colFirst = d.readUInt16LE(2);
        const n = Math.floor((d.length - 6) / 6);
        for (let i = 0; i < n; i++) {
          const xf = d.readUInt16LE(4 + i * 6);
          const rk = d.readInt32LE(6 + i * 6);
          put(row, colFirst + i, numText(decodeRk(rk), xf));
        }
        break;
      }
      case REC.BOOLERR: {
        if (d.length < 8) break;
        const row = d.readUInt16LE(0);
        const col = d.readUInt16LE(2);
        const value = d[6];
        const isError = d[7] === 1;
        put(row, col, isError ? (EXCEL_ERROR_CODES[value] ?? `#ERR${value}`) : value ? 'TRUE' : 'FALSE');
        break;
      }
      case REC.FORMULA:
      case REC.FORMULA_ALT: {
        if (d.length < 14) break;
        const row = d.readUInt16LE(0);
        const col = d.readUInt16LE(2);
        const xf = d.readUInt16LE(4);
        if (d.readUInt16LE(12) === 0xffff) {
          const kind = d[6];
          if (kind === 0) pendingString = { row, col };
          else if (kind === 1) put(row, col, d[8] ? 'TRUE' : 'FALSE');
          else if (kind === 2) put(row, col, EXCEL_ERROR_CODES[d[8]] ?? `#ERR${d[8]}`);
          else put(row, col, '');
        } else {
          put(row, col, numText(d.readDoubleLE(6), xf));
        }
        break;
      }
      case REC.STRING: {
        if (!pendingString) break;
        const { text } = readInlineString(d, 0, g.biff8, 2, g.decoder);
        put(pendingString.row, pendingString.col, text);
        pendingString = null;
        break;
      }
      case REC.BOF_BIFF5_8:
        // Embedded chart/macro substream inside the sheet: skip to its EOF.
        {
          let depth = 1;
          let r2: BiffRecord | null;
          while (depth > 0 && (r2 = readRecord(stream, pos)) !== null) {
            pos = r2.next;
            if (r2.type === REC.BOF_BIFF5_8) depth++;
            else if (r2.type === REC.EOF) depth--;
          }
        }
        break;
      default:
        break;
    }
  }

  // Extent = cells that carry a value (every cell record passes through `put`,
  // capped or not), which matches what xlrd/VisiData report; DIMENSIONS also
  // counts formatted-but-empty rows/cols, so it only serves as a fallback.
  // When the scan stopped early the tail was never seen: DIMENSIONS is the
  // extent (Excel/LibreOffice write it exactly; it may include formatted
  // empty rows/cols, which is acceptable for a truncated view).
  const rowCount = stopEarly ? Math.max(maxRowSeen + 1, dimRows ?? 0) : (maxRowSeen >= 0 ? maxRowSeen + 1 : (dimRows ?? 0));
  const colCount = stopEarly ? Math.max(maxColSeen + 1, dimCols ?? 0) : (maxColSeen >= 0 ? maxColSeen + 1 : (dimCols ?? 0));
  if (colCount > maxCols) truncatedCols = true;
  return {
    rows,
    rowCount,
    colCount,
    truncatedRows: rowCount > maxRows,
    truncatedCols,
  };
}

/** Parse a BIFF5/BIFF8 .xls buffer: full sheet list + ONE sheet's grid. */
export function parseXlsBuffer(buf: Buffer, opts: ParseOptions & { maxRows: number; maxCols: number }): ParsedSpreadsheet {
  const { stream } = extractWorkbookStream(buf);
  const g = parseGlobals(stream);
  const worksheets = g.sheets.filter((s) => s.isWorksheet);
  const all = worksheets.length > 0 ? worksheets : g.sheets;
  if (all.length === 0) throw new Error('workbook has no sheets');
  const sheets: SpreadsheetSheetInfo[] = all.map((s) => (s.hidden ? { name: s.name, hidden: true } : { name: s.name }));
  const sheetIndex = Math.min(Math.max(0, Math.floor(opts.sheetIndex ?? 0)), all.length - 1);
  const target = all[sheetIndex];
  let start = target.offset;
  if (start <= 0 || start >= stream.length) start = g.globalsEnd;
  const grid = parseSheetSubstream(stream, start, g, opts.maxRows, opts.maxCols);
  return {
    format: 'xls',
    sheets,
    sheetIndex,
    sheet: { ...sheets[sheetIndex], ...grid },
  };
}
