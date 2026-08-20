/**
 * Legacy Word (.doc, Word 97-2003) reader — dependency-free, text + structure.
 *
 * A .doc is an OLE2 compound file (see cfb-reader.ts). The "WordDocument"
 * stream starts with the FIB (File Information Block), whose `fcClx` /`lcbClx`
 * point into the table stream ("1Table" or "0Table", chosen by the FIB's
 * `fWhichTblStm` flag). The Clx ends with a Pcdt: a PlcPcd — an array of
 * character positions followed by 8-byte piece descriptors. Each piece says
 * where its text lives in WordDocument and whether it is UTF-16 or CP1252
 * (bit 30 of the fc field, with the offset halved when set).
 *
 * What we recover: the document text split into paragraphs (Word separates
 * them with CR = 0x0D), with the field/footnote/header sentinels and the
 * cell/row marks turned into readable structure. Formatting (bold, styles)
 * lives in the CHPX/PAPX binary tables and is deliberately NOT parsed — the
 * viewer marks these documents `plainTextOnly` and suggests converting to
 * .docx for full fidelity.
 */

import type { DocBlock, DocParagraph } from '../../shared/document-types.js';
import type { ParsedDocument } from './document-parse.js';
import { cfbStreamNames, isCfbBuffer, readCfb, readCfbStreamByName } from './cfb-reader.js';

const FIB_MAGIC_WORD = 0xa5ec; // wIdent for Word 97+ (0xA5DC/0xA5DB are Word 6/95)

export interface PieceDescriptor {
  /** Character position (CP) where this piece starts. */
  cpStart: number;
  cpEnd: number;
  /** Byte offset of the piece's text in the WordDocument stream. */
  fc: number;
  /** true → CP1252 single bytes, false → UTF-16LE. */
  compressed: boolean;
}

/** Parse the PlcPcd (piece table) out of the Clx blob. */
export function parsePieceTable(clx: Buffer): PieceDescriptor[] {
  // Clx = Prc* Pcdt. Skip Prc entries (0x01 + 2-byte cbGrpprl + data).
  let pos = 0;
  while (pos < clx.length && clx[pos] === 0x01) {
    if (pos + 3 > clx.length) return [];
    const cb = clx.readUInt16LE(pos + 1);
    pos += 3 + cb;
  }
  if (pos >= clx.length || clx[pos] !== 0x02) return [];
  if (pos + 5 > clx.length) return [];
  const lcb = clx.readUInt32LE(pos + 1);
  const plc = clx.subarray(pos + 5, pos + 5 + lcb);
  // PlcPcd: (n+1) CPs (4 bytes each) then n PCDs (8 bytes each).
  const n = Math.floor((plc.length - 4) / 12);
  if (n <= 0) return [];
  const pieces: PieceDescriptor[] = [];
  for (let i = 0; i < n; i++) {
    const cpStart = plc.readUInt32LE(i * 4);
    const cpEnd = plc.readUInt32LE((i + 1) * 4);
    const pcdOff = (n + 1) * 4 + i * 8;
    if (pcdOff + 8 > plc.length) break;
    const fcValue = plc.readUInt32LE(pcdOff + 2);
    const compressed = (fcValue & 0x40000000) !== 0;
    const fc = compressed ? (fcValue & 0x3fffffff) / 2 : (fcValue & 0x3fffffff);
    pieces.push({ cpStart, cpEnd, fc: Math.floor(fc), compressed });
  }
  return pieces;
}

/** CP1252 high range (0x80-0x9F) — the rest of latin1 maps 1:1. */
const CP1252_HIGH = '€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ';

function decodeCp1252(bytes: Buffer): string {
  let out = '';
  for (const b of bytes) out += b >= 0x80 && b <= 0x9f ? CP1252_HIGH[b - 0x80] : String.fromCharCode(b);
  return out;
}

/** Concatenate the text of every piece, in CP order. */
export function readPieceText(wordDocument: Buffer, pieces: PieceDescriptor[]): string {
  const parts: string[] = [];
  for (const p of pieces) {
    const chars = Math.max(0, p.cpEnd - p.cpStart);
    if (chars === 0) continue;
    const bytes = p.compressed ? chars : chars * 2;
    if (p.fc < 0 || p.fc >= wordDocument.length) continue;
    const slice = wordDocument.subarray(p.fc, Math.min(wordDocument.length, p.fc + bytes));
    parts.push(p.compressed ? decodeCp1252(slice) : slice.toString('utf16le'));
  }
  return parts.join('');
}

/**
 * Word control characters that must not reach the reader:
 *  0x01 picture placeholder · 0x02 footnote/annotation ref · 0x05 comment
 *  0x08 drawn object · 0x13/0x14/0x15 field begin/separator/end · 0x0C page
 *  break · 0x0E column break · 0x1E non-breaking hyphen · 0x1F optional hyphen.
 * Field instructions (between 0x13 and 0x14) are metadata (HYPERLINK "…",
 * PAGE, TOC) — dropped; the field RESULT (0x14…0x15) is kept.
 */
export function docTextToParagraphs(text: string, maxBlocks: number): { blocks: DocBlock[]; blockCount: number; truncated: boolean } {
  const blocks: DocBlock[] = [];
  let blockCount = 0;
  let truncated = false;
  let current = '';
  let inFieldInstruction = false;
  let cellFlush = false;

  const push = () => {
    const cleaned = current.replace(/[\u0000-\u0008\u000e-\u001f]/g, '').replace(/\u00a0/g, ' ').trimEnd();
    current = '';
    if (cleaned.trim() === '') return;
    blockCount++;
    if (blocks.length >= maxBlocks) { truncated = true; return; }
    const para: DocParagraph = { type: 'paragraph', runs: [{ text: cleaned }] };
    blocks.push(para);
  };

  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    switch (code) {
      case 0x13: inFieldInstruction = true; continue;      // field begin
      case 0x14: inFieldInstruction = false; continue;     // field separator
      case 0x15: continue;                                  // field end
      case 0x0d: case 0x0a:                                 // paragraph end
        push();
        continue;
      case 0x07:
        // Every cell ends with 0x07; the ROW ends with one more right after
        // the last cell's — so two in a row mean "end of line", one means
        // "next cell" (rendered as a tab, like the .doc → text convention).
        if (cellFlush) { push(); cellFlush = false; }
        else { current += '\t'; cellFlush = true; }
        continue;
      case 0x0b: current += '\n'; continue;                  // line break
      case 0x0c: push(); continue;                           // page break
      case 0x1e: current += '-'; continue;                   // non-breaking hyphen
      case 0x1f: continue;                                   // optional hyphen
      default:
        if (inFieldInstruction) continue;
        if (code < 0x20 && code !== 0x09) continue;
        current += text[i];
    }
    // Only a SECOND consecutive 0x07 is a row mark, so the flag survives only
    // until the next character.
    cellFlush = false;
  }
  push();
  return { blocks, blockCount, truncated };
}

/** Parse a Word 97-2003 .doc buffer into plain paragraphs. */
export function parseDocBuffer(buf: Buffer, maxBlocks: number): ParsedDocument {
  if (!isCfbBuffer(buf)) throw new Error('not an OLE2 compound file');
  const cfb = readCfb(buf);
  const wordDocument = readCfbStreamByName(buf, cfb, 'WordDocument');
  if (!wordDocument) {
    const names = cfbStreamNames(cfb).slice(0, 8).join(', ');
    throw new Error(`OLE2 file without a WordDocument stream (streams: ${names || 'none'}) — not a Word document`);
  }
  if (wordDocument.length < 0x0200) throw new Error('WordDocument stream is too small to hold a FIB');
  const wIdent = wordDocument.readUInt16LE(0);
  if (wIdent !== FIB_MAGIC_WORD) {
    throw new Error(
      wIdent === 0xa5db || wIdent === 0xa5dc
        ? 'This is a Word 6/95 document — too old for the built-in viewer; open it in LibreOffice and save as .docx.'
        : `unrecognized Word file header (0x${wIdent.toString(16)})`,
    );
  }
  // FIB base: flags at 0x0A, fWhichTblStm is bit 9 (0x0200).
  const flags = wordDocument.readUInt16LE(0x0a);
  const tableName = (flags & 0x0200) ? '1Table' : '0Table';
  const table = readCfbStreamByName(buf, cfb, tableName) ?? readCfbStreamByName(buf, cfb, tableName === '1Table' ? '0Table' : '1Table');
  if (!table) throw new Error('Word document without a table stream (0Table/1Table)');

  // The FibRgFcLcb array starts after the FIB base (0x0020) + csw (2 + 2*csw)
  // + cslw (2 + 4*cslw) + cbRgFcLcb (2). Its entries are (fc, lcb) u32 pairs;
  // fcClx/lcbClx is entry 33 of FibRgFcLcb97 (unchanged in the 2000-2007
  // extensions, which only append).
  let pos = 0x0020;
  const csw = wordDocument.readUInt16LE(pos);
  pos += 2 + csw * 2;
  const cslw = wordDocument.readUInt16LE(pos);
  pos += 2 + cslw * 4;
  const cbRgFcLcb = wordDocument.readUInt16LE(pos);
  pos += 2;
  const rgFcLcb = wordDocument.subarray(pos, pos + cbRgFcLcb * 8);
  const CLX_INDEX = 33;
  if (rgFcLcb.length < (CLX_INDEX + 1) * 8) throw new Error('Word FIB is truncated (no Clx pointer)');
  let fcClx = rgFcLcb.readUInt32LE(CLX_INDEX * 8);
  let lcbClx = rgFcLcb.readUInt32LE(CLX_INDEX * 8 + 4);
  let pieces = lcbClx > 0 && fcClx + lcbClx <= table.length
    ? parsePieceTable(table.subarray(fcClx, fcClx + lcbClx))
    : [];
  if (pieces.length === 0) {
    // Writers that lay the FIB out differently (or files repaired by other
    // tools) still keep a Clx in the table stream: find the entry that points
    // at one and yields a usable piece table.
    for (let i = 0; i < cbRgFcLcb && pieces.length === 0; i++) {
      const fc = rgFcLcb.readUInt32LE(i * 8);
      const lcb = rgFcLcb.readUInt32LE(i * 8 + 4);
      if (lcb <= 8 || fc + lcb > table.length) continue;
      if (table[fc] !== 0x01 && table[fc] !== 0x02) continue;
      const candidate = parsePieceTable(table.subarray(fc, fc + lcb));
      if (candidate.length > 0) { pieces = candidate; fcClx = fc; lcbClx = lcb; }
    }
  }
  if (pieces.length === 0) throw new Error('Word document has no readable piece table');
  const text = readPieceText(wordDocument, pieces);
  const { blocks, blockCount, truncated } = docTextToParagraphs(text, maxBlocks);

  let wordCount = 0;
  for (const b of blocks) {
    if (b.type !== 'paragraph') continue;
    for (const r of b.runs) {
      const t = r.text.trim();
      if (t) wordCount += t.split(/\s+/).length;
    }
  }
  return { format: 'doc', blocks, wordCount, blockCount, truncated, plainTextOnly: true };
}
