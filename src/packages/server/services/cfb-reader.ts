/**
 * OLE2 / Compound File Binary (CFB) container reader — dependency-free.
 *
 * The envelope of every legacy Office binary: `.xls` keeps its BIFF records in
 * a "Workbook" stream, `.doc` keeps text and tables in "WordDocument" +
 * "0Table"/"1Table", `.ppt` in "PowerPoint Document". This module exposes the
 * directory and the streams; the format-specific readers live next to it
 * (spreadsheet-biff.ts, document-doc.ts).
 */

const CFB_MAGIC = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
const ENDOFCHAIN = 0xfffffffe;
const FREESECT = 0xffffffff;
const MAX_STREAM_BYTES = 256 * 1024 * 1024;

export function isCfbBuffer(buf: Buffer): boolean {
  return buf.length >= 8 && buf.subarray(0, 8).equals(CFB_MAGIC);
}

// ── CFB container ───────────────────────────────────────────────────────────

export interface CfbFile {
  sectorSize: number;
  miniSectorSize: number;
  fat: Uint32Array;
  miniFat: Uint32Array;
  miniStream: Buffer;
  miniCutoff: number;
  entries: CfbEntry[];
}

export interface CfbEntry {
  name: string;
  type: number;
  startSector: number;
  size: number;
}

export function readCfb(buf: Buffer): CfbFile {
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

export function readCfbStream(cfb: CfbFile, entry: CfbEntry, buf: Buffer): Buffer {
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

/** Read a stream by (case-insensitive) name; null when absent. */
export function readCfbStreamByName(buf: Buffer, cfb: CfbFile, name: string): Buffer | null {
  const target = name.toLowerCase();
  const entry = cfb.entries.find((e) => e.type === 2 && e.name.toLowerCase() === target);
  return entry ? readCfbStream(cfb, entry, buf) : null;
}

/** Names of the streams in the container (for diagnostics / sniffing). */
export function cfbStreamNames(cfb: CfbFile): string[] {
  return cfb.entries.filter((e) => e.type === 2).map((e) => e.name);
}
