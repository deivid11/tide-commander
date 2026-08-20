/**
 * Document parsing for the file viewers — dependency-free.
 *
 * - `.docx` / `.docm` (OOXML WordprocessingML): the file is a zip;
 *   `word/document.xml` is walked with a tolerant tag scanner into blocks
 *   (paragraphs with formatted runs, headings, lists, tables, images,
 *   hyperlinks, footnote refs). Styles (`word/styles.xml`) supply heading
 *   levels and run defaults, `word/numbering.xml` bullet vs ordered lists,
 *   `word/_rels/document.xml.rels` link and image targets.
 * - `.odt` / `.fodt` (OpenDocument text): `content.xml`, same block shape;
 *   `styles.xml` + automatic styles give heading levels and list kinds.
 * - `.doc` (Word 97-2003): see document-doc.ts — OLE2 + FIB + piece table,
 *   text and paragraph splits only (`plainTextOnly`).
 * - `.rtf`: control-word scanner producing paragraphs with bold/italic/
 *   underline; groups that carry binary payloads are skipped.
 *
 * Everything is capped (`maxBlocks`) and the format is sniffed from CONTENT,
 * so a `.doc` that is really an RTF or a `.docx` still opens.
 */

import fs from 'fs';
import path from 'path';
import {
  DOCX_EXTENSIONS,
  DOC_EXTENSIONS,
  ODT_EXTENSIONS,
  RTF_EXTENSIONS,
  type DocBlock,
  type DocFootnote,
  type DocImage,
  type DocListKind,
  type DocParagraph,
  type DocRun,
  type DocTable,
  type DocTableCell,
  type DocumentFormat,
} from '../../shared/document-types.js';
import {
  decodeTextBuffer,
  decodeXmlEntities,
  zipSourceFromBuffer,
  zipSourceFromFd,
  type ZipSource,
} from './spreadsheet-parse.js';
import { isCfbBuffer } from './cfb-reader.js';
import { parseDocBuffer } from './document-doc.js';

export const DOCUMENT_DEFAULT_MAX_BLOCKS = 2_000;
export const DOCUMENT_HARD_MAX_BLOCKS = 20_000;
/** Whole-file cap for the in-memory formats (.doc / .rtf). */
export const DOCUMENT_MAX_FILE_BYTES = 128 * 1024 * 1024;
/** Rows/cells kept per table — a runaway table can't blow up the payload. */
const MAX_TABLE_ROWS = 500;
const MAX_TABLE_COLS = 64;

export interface DocumentParseOptions {
  maxBlocks?: number;
}

export interface ParsedDocument {
  format: DocumentFormat;
  title?: string;
  author?: string;
  blocks: DocBlock[];
  footnotes?: DocFootnote[];
  header?: string;
  footer?: string;
  wordCount: number;
  blockCount: number;
  truncated: boolean;
  plainTextOnly?: boolean;
}

export class UnsupportedDocumentError extends Error {
  constructor(message: string, public readonly extension: string) {
    super(message);
    this.name = 'UnsupportedDocumentError';
  }
}

export type DocumentKind = 'docx' | 'odt' | 'doc' | 'rtf';

export function detectDocumentKind(filename: string): DocumentKind | null {
  const ext = path.extname(filename).toLowerCase();
  if ((DOCX_EXTENSIONS as readonly string[]).includes(ext)) return 'docx';
  if ((ODT_EXTENSIONS as readonly string[]).includes(ext)) return 'odt';
  if ((DOC_EXTENSIONS as readonly string[]).includes(ext)) return 'doc';
  if ((RTF_EXTENSIONS as readonly string[]).includes(ext)) return 'rtf';
  return null;
}

function clampBlocks(opts: DocumentParseOptions): number {
  return Math.min(DOCUMENT_HARD_MAX_BLOCKS, Math.max(1, Math.floor(opts.maxBlocks ?? DOCUMENT_DEFAULT_MAX_BLOCKS)));
}

// ── tolerant XML helpers (shared shape with the spreadsheet reader) ──────────

const ATTR_RE_CACHE = new Map<string, RegExp>();
/** Attribute value from a tag's attribute string; namespace prefix optional. */
export function xmlAttr(tagAttrs: string, name: string): string | undefined {
  let re = ATTR_RE_CACHE.get(name);
  if (!re) {
    re = new RegExp(`(?:^|\\s)(?:[\\w.-]+:)?${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`);
    ATTR_RE_CACHE.set(name, re);
  }
  const m = re.exec(tagAttrs);
  if (!m) return undefined;
  return m[1] !== undefined ? m[1] : m[2];
}

/** `<w:b/>` or `<w:b w:val="1"/>` → true; `w:val="0"|"false"|"none"` → false. */
function toggleOn(attrs: string | undefined): boolean {
  if (attrs === undefined) return false;
  const v = xmlAttr(attrs, 'val');
  if (v === undefined) return true;
  return v !== '0' && v !== 'false' && v !== 'none' && v !== 'off';
}

function normalizeColor(v: string | undefined): string | undefined {
  if (!v) return undefined;
  const hex = v.trim().replace(/^#/, '');
  if (/^[0-9a-fA-F]{6}$/.test(hex)) {
    // Word's "auto" and pure black/white defaults aren't worth carrying.
    if (/^000000$/i.test(hex)) return undefined;
    return `#${hex.toLowerCase()}`;
  }
  return undefined;
}

/** Word highlight names → hex (w:highlight uses names, w:shd uses hex). */
const HIGHLIGHT_COLORS: Record<string, string> = {
  yellow: '#ffff00', green: '#00ff00', cyan: '#00ffff', magenta: '#ff00ff',
  blue: '#0000ff', red: '#ff0000', darkBlue: '#000080', darkCyan: '#008080',
  darkGreen: '#008000', darkMagenta: '#800080', darkRed: '#800000',
  darkYellow: '#808000', darkGray: '#808080', lightGray: '#c0c0c0', black: '#000000',
};

const MONO_FONTS = /consolas|courier|menlo|monaco|mono|lucida console|dejavu sans mono|source code/i;

/** EMU (English Metric Units) → CSS px at 96 dpi. */
function emuToPx(v: string | undefined): number | undefined {
  const n = v === undefined ? NaN : parseInt(v, 10);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return Math.round(n / 9525);
}

function wordsIn(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

/** Word count over blocks (paragraph runs + table cells). */
export function countWords(blocks: DocBlock[]): number {
  let n = 0;
  for (const b of blocks) {
    if (b.type === 'paragraph') {
      for (const r of b.runs) n += wordsIn(r.text);
    } else {
      for (const row of b.rows) for (const cell of row) n += countWords(cell.blocks);
    }
  }
  return n;
}

/** Plain text of a block list — used for headers/footers and the .txt copy. */
export function blocksToText(blocks: DocBlock[]): string {
  const out: string[] = [];
  for (const b of blocks) {
    if (b.type === 'paragraph') {
      out.push(b.runs.map((r) => r.text).join(''));
    } else {
      for (const row of b.rows) out.push(row.map((c) => blocksToText(c.blocks).replace(/\n+/g, ' ')).join('\t'));
    }
  }
  return out.join('\n');
}

// ── docx (WordprocessingML) ─────────────────────────────────────────────────

interface DocxStyle {
  name: string;
  heading?: number;
  bold?: boolean;
  italic?: boolean;
  mono?: boolean;
  align?: DocParagraph['align'];
  /** Style this one is based on — walked for heading/format inheritance. */
  basedOn?: string;
  listNumId?: string;
}

/** styleId → resolved style info (heading level, default run formatting). */
export function parseDocxStyles(xml: string): Map<string, DocxStyle> {
  const styles = new Map<string, DocxStyle>();
  const re = /<w:style\b([^>]*)>([\s\S]*?)<\/w:style>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const id = xmlAttr(m[1], 'styleId');
    if (!id) continue;
    const body = m[2];
    const nameAttr = /<w:name\b([^>]*)\/>/.exec(body);
    const name = decodeXmlEntities(xmlAttr(nameAttr?.[1] ?? '', 'val') ?? id);
    const outline = /<w:outlineLvl\b([^>]*)\/>/.exec(body);
    const outlineLvl = outline ? parseInt(xmlAttr(outline[1], 'val') ?? '', 10) : NaN;
    // "heading 3" / "Heading3" / outlineLvl 2 all mean level 3.
    const byName = /^heading\s*(\d)/i.exec(name);
    let heading: number | undefined;
    if (byName) heading = Math.min(6, Math.max(1, parseInt(byName[1], 10)));
    else if (Number.isFinite(outlineLvl) && outlineLvl >= 0 && outlineLvl <= 5) heading = outlineLvl + 1;
    const basedOnTag = /<w:basedOn\b([^>]*)\/>/.exec(body);
    const jc = /<w:jc\b([^>]*)\/>/.exec(body);
    const fonts = /<w:rFonts\b([^>]*)\/>/.exec(body);
    const numId = /<w:numId\b([^>]*)\/>/.exec(body);
    styles.set(id, {
      name,
      heading,
      bold: /<w:b\b[^>]*\/>/.test(body) ? toggleOn(/<w:b\b([^>]*)\/>/.exec(body)?.[1]) : undefined,
      italic: /<w:i\b[^>]*\/>/.test(body) ? toggleOn(/<w:i\b([^>]*)\/>/.exec(body)?.[1]) : undefined,
      mono: fonts ? MONO_FONTS.test(xmlAttr(fonts[1], 'ascii') ?? '') : undefined,
      align: jc ? (xmlAttr(jc[1], 'val') as DocParagraph['align']) : undefined,
      basedOn: basedOnTag ? xmlAttr(basedOnTag[1], 'val') : undefined,
      listNumId: numId ? xmlAttr(numId[1], 'val') : undefined,
    });
  }
  return styles;
}

/** Resolve a style chain (basedOn) into effective values. */
function resolveStyle(styles: Map<string, DocxStyle>, id: string | undefined): DocxStyle | undefined {
  if (!id) return undefined;
  let cur = styles.get(id);
  if (!cur) return undefined;
  const merged: DocxStyle = { ...cur };
  const seen = new Set<string>([id]);
  while (cur?.basedOn && !seen.has(cur.basedOn)) {
    seen.add(cur.basedOn);
    const parent = styles.get(cur.basedOn);
    if (!parent) break;
    if (merged.heading === undefined) merged.heading = parent.heading;
    if (merged.bold === undefined) merged.bold = parent.bold;
    if (merged.italic === undefined) merged.italic = parent.italic;
    if (merged.mono === undefined) merged.mono = parent.mono;
    if (merged.align === undefined) merged.align = parent.align;
    if (merged.listNumId === undefined) merged.listNumId = parent.listNumId;
    cur = parent;
  }
  return merged;
}

/** numId → per-level list kind (from numbering.xml's abstract definitions). */
export function parseDocxNumbering(xml: string): Map<string, DocListKind[]> {
  const abstracts = new Map<string, DocListKind[]>();
  const absRe = /<w:abstractNum\b([^>]*)>([\s\S]*?)<\/w:abstractNum>/g;
  let m: RegExpExecArray | null;
  while ((m = absRe.exec(xml)) !== null) {
    const id = xmlAttr(m[1], 'abstractNumId');
    if (!id) continue;
    const levels: DocListKind[] = [];
    const lvlRe = /<w:lvl\b([^>]*)>([\s\S]*?)<\/w:lvl>/g;
    let lm: RegExpExecArray | null;
    while ((lm = lvlRe.exec(m[2])) !== null) {
      const ilvl = parseInt(xmlAttr(lm[1], 'ilvl') ?? '0', 10) || 0;
      const fmt = /<w:numFmt\b([^>]*)\/>/.exec(lm[2]);
      const val = fmt ? xmlAttr(fmt[1], 'val') : undefined;
      levels[ilvl] = val === 'bullet' || val === 'none' ? 'bullet' : 'ordered';
    }
    abstracts.set(id, levels);
  }
  const nums = new Map<string, DocListKind[]>();
  const numRe = /<w:num\b([^>]*)>([\s\S]*?)<\/w:num>/g;
  while ((m = numRe.exec(xml)) !== null) {
    const id = xmlAttr(m[1], 'numId');
    const absTag = /<w:abstractNumId\b([^>]*)\/>/.exec(m[2]);
    const absId = absTag ? xmlAttr(absTag[1], 'val') : undefined;
    if (id && absId && abstracts.has(absId)) nums.set(id, abstracts.get(absId)!);
  }
  return nums;
}

/** rId → target, from any *.rels part. */
export function parseRels(xml: string): Map<string, { target: string; external: boolean }> {
  const map = new Map<string, { target: string; external: boolean }>();
  const re = /<Relationship\b([^>]*?)\/?>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const id = xmlAttr(m[1], 'Id');
    const target = xmlAttr(m[1], 'Target');
    if (!id || !target) continue;
    map.set(id, { target: decodeXmlEntities(target), external: (xmlAttr(m[1], 'TargetMode') ?? '') === 'External' });
  }
  return map;
}

interface DocxContext {
  styles: Map<string, DocxStyle>;
  numbering: Map<string, DocListKind[]>;
  rels: Map<string, { target: string; external: boolean }>;
  /** Zip entry prefix for media targets (`word/`). */
  partDir: string;
  maxBlocks: number;
  /** Ordinal per footnote id, assigned in document order. */
  footnoteOrder: Map<string, number>;
}

/** Text of `<w:t>` runs plus tabs/breaks inside a run fragment. */
function runText(fragment: string): string {
  let out = '';
  const re = /<w:t\b([^>]*?)(?:\/>|>([\s\S]*?)<\/w:t>)|<w:tab\b[^>]*\/>|<w:br\b[^>]*\/>|<w:noBreakHyphen\b[^>]*\/>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(fragment)) !== null) {
    if (m[0].startsWith('<w:tab')) out += '\t';
    else if (m[0].startsWith('<w:br')) out += '\n';
    else if (m[0].startsWith('<w:noBreakHyphen')) out += '-';
    else if (m[2] !== undefined) out += decodeXmlEntities(m[2]);
  }
  return out;
}

/** Build a run from `<w:r>` attrs+body, inheriting the paragraph style. */
function parseRun(body: string, base: DocxStyle | undefined, href: string | undefined, ctx: DocxContext): DocRun | null {
  const rPr = /<w:rPr\b[^>]*>([\s\S]*?)<\/w:rPr>/.exec(body)?.[1] ?? '';
  const text = runText(body);

  // Footnote/endnote reference: a marker with no text of its own.
  const fnRef = /<w:(?:footnote|endnote)Reference\b([^>]*)\/>/.exec(body);
  if (fnRef) {
    const id = xmlAttr(fnRef[1], 'id');
    if (id !== undefined) {
      let ord = ctx.footnoteOrder.get(id);
      if (ord === undefined) {
        ord = ctx.footnoteOrder.size + 1;
        ctx.footnoteOrder.set(id, ord);
      }
      return { text: String(ord), footnoteRef: ord, superscript: true };
    }
  }
  if (text === '') return null;

  const bTag = /<w:b\b([^>]*)\/>/.exec(rPr);
  const iTag = /<w:i\b([^>]*)\/>/.exec(rPr);
  const uTag = /<w:u\b([^>]*)\/>/.exec(rPr);
  const strikeTag = /<w:(?:strike|dstrike)\b([^>]*)\/>/.exec(rPr);
  const vertTag = /<w:vertAlign\b([^>]*)\/>/.exec(rPr);
  const colorTag = /<w:color\b([^>]*)\/>/.exec(rPr);
  const hlTag = /<w:highlight\b([^>]*)\/>/.exec(rPr);
  const shdTag = /<w:shd\b([^>]*)\/>/.exec(rPr);
  const fontsTag = /<w:rFonts\b([^>]*)\/>/.exec(rPr);
  const vert = vertTag ? xmlAttr(vertTag[1], 'val') : undefined;
  const highlightName = hlTag ? xmlAttr(hlTag[1], 'val') : undefined;
  const shdFill = shdTag ? xmlAttr(shdTag[1], 'fill') : undefined;

  const run: DocRun = { text };
  const bold = bTag ? toggleOn(bTag[1]) : base?.bold;
  const italic = iTag ? toggleOn(iTag[1]) : base?.italic;
  const mono = fontsTag ? MONO_FONTS.test(xmlAttr(fontsTag[1], 'ascii') ?? '') : base?.mono;
  if (bold) run.bold = true;
  if (italic) run.italic = true;
  if (uTag && (xmlAttr(uTag[1], 'val') ?? 'single') !== 'none') run.underline = true;
  if (strikeTag && toggleOn(strikeTag[1])) run.strike = true;
  if (mono) run.mono = true;
  if (vert === 'superscript') run.superscript = true;
  else if (vert === 'subscript') run.subscript = true;
  const color = normalizeColor(colorTag ? xmlAttr(colorTag[1], 'val') : undefined);
  if (color) run.color = color;
  const highlight = highlightName
    ? HIGHLIGHT_COLORS[highlightName] ?? normalizeColor(highlightName)
    : normalizeColor(shdFill === 'auto' ? undefined : shdFill);
  if (highlight) run.highlight = highlight;
  if (href) run.href = href;
  return run;
}

/** Images referenced by `<w:drawing>` / `<w:pict>` inside a paragraph. */
function parseImages(pXml: string, ctx: DocxContext): DocImage[] {
  const images: DocImage[] = [];
  const blipRe = /<a:blip\b([^>]*?)\/?>/g;
  let m: RegExpExecArray | null;
  while ((m = blipRe.exec(pXml)) !== null) {
    const rid = xmlAttr(m[1], 'embed') ?? xmlAttr(m[1], 'link');
    if (!rid) continue;
    const rel = ctx.rels.get(rid);
    if (!rel || rel.external) continue;
    const entry = rel.target.startsWith('/') ? rel.target.slice(1) : `${ctx.partDir}${rel.target.replace(/^\.\//, '')}`;
    const ext = /<wp:extent\b([^>]*)\/>/.exec(pXml);
    const docPr = /<wp:docPr\b([^>]*?)\/?>/.exec(pXml);
    images.push({
      entry: entry.replace(/\/{2,}/g, '/'),
      width: ext ? emuToPx(xmlAttr(ext[1], 'cx')) : undefined,
      height: ext ? emuToPx(xmlAttr(ext[1], 'cy')) : undefined,
      alt: docPr ? decodeXmlEntities(xmlAttr(docPr[1], 'descr') ?? xmlAttr(docPr[1], 'name') ?? '') || undefined : undefined,
    });
  }
  // VML fallback (older docs): <v:imagedata r:id="rId7"/>
  const vmlRe = /<v:imagedata\b([^>]*?)\/?>/g;
  while ((m = vmlRe.exec(pXml)) !== null) {
    const rid = xmlAttr(m[1], 'id');
    const rel = rid ? ctx.rels.get(rid) : undefined;
    if (!rel || rel.external) continue;
    const entry = rel.target.startsWith('/') ? rel.target.slice(1) : `${ctx.partDir}${rel.target.replace(/^\.\//, '')}`;
    images.push({ entry: entry.replace(/\/{2,}/g, '/') });
  }
  return images;
}

/** One `<w:p>` → a paragraph block (null when it carries nothing at all). */
function parseParagraph(attrs: string, body: string, ctx: DocxContext): DocParagraph | null {
  void attrs;
  const pPr = /<w:pPr\b[^>]*>([\s\S]*?)<\/w:pPr>/.exec(body)?.[1] ?? '';
  const styleTag = /<w:pStyle\b([^>]*)\/>/.exec(pPr);
  const style = resolveStyle(ctx.styles, styleTag ? xmlAttr(styleTag[1], 'val') : undefined);
  const jc = /<w:jc\b([^>]*)\/>/.exec(pPr);
  const numPr = /<w:numPr\b[^>]*>([\s\S]*?)<\/w:numPr>/.exec(pPr)?.[1] ?? '';
  const numIdTag = /<w:numId\b([^>]*)\/>/.exec(numPr);
  const ilvlTag = /<w:ilvl\b([^>]*)\/>/.exec(numPr);
  const indTag = /<w:ind\b([^>]*)\/>/.exec(pPr);
  const outlineTag = /<w:outlineLvl\b([^>]*)\/>/.exec(pPr);

  const runs: DocRun[] = [];
  // Runs, in order, including those wrapped in hyperlinks / smart tags / ins.
  const runRe = /<w:hyperlink\b([^>]*)>([\s\S]*?)<\/w:hyperlink>|<w:r\b[^>]*>([\s\S]*?)<\/w:r>/g;
  let m: RegExpExecArray | null;
  while ((m = runRe.exec(body)) !== null) {
    if (m[3] !== undefined) {
      const run = parseRun(m[3], style, undefined, ctx);
      if (run) runs.push(run);
      continue;
    }
    // Hyperlink: resolve the target once, then its inner runs.
    const rid = xmlAttr(m[1], 'id');
    const anchor = xmlAttr(m[1], 'anchor');
    const rel = rid ? ctx.rels.get(rid) : undefined;
    const href = rel ? rel.target : anchor ? `#${anchor}` : undefined;
    const innerRe = /<w:r\b[^>]*>([\s\S]*?)<\/w:r>/g;
    let im: RegExpExecArray | null;
    while ((im = innerRe.exec(m[2])) !== null) {
      const run = parseRun(im[1], style, href, ctx);
      if (run) runs.push(run);
    }
  }

  const images = parseImages(body, ctx);
  const pageBreak = /<w:br\b[^>]*w:type="page"/.test(body) || /<w:lastRenderedPageBreak\b/.test(body);
  if (runs.length === 0 && images.length === 0 && !pageBreak) return null;

  const para: DocParagraph = { type: 'paragraph', runs };
  const outlineLvl = outlineTag ? parseInt(xmlAttr(outlineTag[1], 'val') ?? '', 10) : NaN;
  const heading = style?.heading ?? (Number.isFinite(outlineLvl) && outlineLvl >= 0 && outlineLvl <= 5 ? outlineLvl + 1 : undefined);
  if (heading) para.heading = heading;
  if (style?.name) para.styleName = style.name;
  const align = (jc ? xmlAttr(jc[1], 'val') : undefined) ?? style?.align;
  if (align === 'center' || align === 'right' || align === 'both' || align === 'justify' || align === 'left') {
    para.align = align === 'both' ? 'justify' : align;
  }
  const numId = numIdTag ? xmlAttr(numIdTag[1], 'val') : style?.listNumId;
  if (numId && numId !== '0') {
    const level = ilvlTag ? parseInt(xmlAttr(ilvlTag[1], 'val') ?? '0', 10) || 0 : 0;
    const kinds = ctx.numbering.get(numId);
    para.list = { kind: kinds?.[level] ?? 'bullet', level: Math.min(8, Math.max(0, level)) };
  } else if (indTag) {
    const left = parseInt(xmlAttr(indTag[1], 'left') ?? xmlAttr(indTag[1], 'start') ?? '', 10);
    // 720 twips = 0.5" = one indent step.
    if (Number.isFinite(left) && left >= 360) para.indent = Math.min(6, Math.round(left / 720));
  }
  if (images.length > 0) para.images = images;
  if (pageBreak) para.pageBreak = true;
  return para;
}

/** `<w:tbl>` → a table block. Cells hold nested blocks (paragraphs, tables). */
function parseTable(body: string, ctx: DocxContext, depth: number): DocTable {
  const rows: DocTableCell[][] = [];
  let colCount = 0;
  let truncated = false;
  const rowRe = /<w:tr\b[^>]*>([\s\S]*?)<\/w:tr>/g;
  let rm: RegExpExecArray | null;
  while ((rm = rowRe.exec(body)) !== null) {
    if (rows.length >= MAX_TABLE_ROWS) { truncated = true; break; }
    const cells: DocTableCell[] = [];
    const cellRe = /<w:tc\b[^>]*>([\s\S]*?)<\/w:tc>/g;
    let cm: RegExpExecArray | null;
    let width = 0;
    while ((cm = cellRe.exec(rm[1])) !== null) {
      if (cells.length >= MAX_TABLE_COLS) { truncated = true; break; }
      const cellXml = cm[1];
      const tcPr = /<w:tcPr\b[^>]*>([\s\S]*?)<\/w:tcPr>/.exec(cellXml)?.[1] ?? '';
      const gridSpanTag = /<w:gridSpan\b([^>]*)\/>/.exec(tcPr);
      const vMergeTag = /<w:vMerge\b([^>]*)\/?>/.exec(tcPr);
      const shdTag = /<w:shd\b([^>]*)\/>/.exec(tcPr);
      const colSpan = gridSpanTag ? Math.max(1, parseInt(xmlAttr(gridSpanTag[1], 'val') ?? '1', 10) || 1) : 1;
      // A continuation cell of a vertical merge renders as part of the one above.
      const isVMergeContinue = !!vMergeTag && (xmlAttr(vMergeTag[1], 'val') ?? 'continue') === 'continue';
      const cell: DocTableCell = { blocks: isVMergeContinue ? [] : parseDocxBody(cellXml, ctx, depth + 1).blocks };
      if (colSpan > 1) cell.colSpan = colSpan;
      const bg = normalizeColor(shdTag ? (xmlAttr(shdTag[1], 'fill') === 'auto' ? undefined : xmlAttr(shdTag[1], 'fill')) : undefined);
      if (bg) cell.background = bg;
      cells.push(cell);
      width += colSpan;
    }
    const isHeaderRow = /<w:tblHeader\b/.test(rm[1]);
    if (isHeaderRow) for (const c of cells) c.header = true;
    if (width > colCount) colCount = width;
    rows.push(cells);
  }
  // A first row of all-bold single-line cells reads as a header even without tblHeader.
  if (rows.length > 1 && !rows[0].some((c) => c.header)) {
    const first = rows[0];
    const allBold = first.length > 0 && first.every((c) => c.blocks.every((b) => b.type !== 'paragraph' || b.runs.every((r) => r.bold || r.text.trim() === '')));
    if (allBold) for (const c of first) c.header = true;
  }
  return { type: 'table', rows, colCount, ...(truncated ? { truncated: true } : {}) };
}

/** Walk a body fragment (document body or a table cell) into blocks. */
function parseDocxBody(xml: string, ctx: DocxContext, depth = 0): { blocks: DocBlock[]; truncated: boolean } {
  const blocks: DocBlock[] = [];
  let truncated = false;
  if (depth > 6) return { blocks, truncated };
  // Paragraphs and tables at THIS level, in document order. `<w:tbl>` bodies
  // contain `<w:p>`, so tables are matched first and their span skipped.
  const re = /<w:tbl\b[^>]*>([\s\S]*?)<\/w:tbl>|<w:p\b([^>]*)>([\s\S]*?)<\/w:p>|<w:p\b([^>]*)\/>/g;
  let m: RegExpExecArray | null;
  let cursor = 0;
  while ((m = re.exec(xml)) !== null) {
    if (m.index < cursor) continue;   // inside a table already consumed
    if (blocks.length >= ctx.maxBlocks) { truncated = true; break; }
    if (m[1] !== undefined) {
      blocks.push(parseTable(m[1], ctx, depth));
      cursor = m.index + m[0].length;
      continue;
    }
    const para = m[3] !== undefined ? parseParagraph(m[2] ?? '', m[3], ctx) : null;
    if (para) blocks.push(para);
    cursor = m.index + m[0].length;
  }
  return { blocks, truncated };
}

/** Footnotes/endnotes part → blocks per note id (only the referenced ones). */
function parseNotes(xml: string, ctx: DocxContext, wanted: Map<string, number>): DocFootnote[] {
  if (wanted.size === 0) return [];
  const out: DocFootnote[] = [];
  const re = /<w:(?:footnote|endnote)\b([^>]*)>([\s\S]*?)<\/w:(?:footnote|endnote)>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const id = xmlAttr(m[1], 'id');
    if (id === undefined) continue;
    const ord = wanted.get(id);
    if (ord === undefined) continue;
    const { blocks } = parseDocxBody(m[2], ctx);
    out.push({ id: ord, blocks });
  }
  return out.sort((a, b) => a.id - b.id);
}

/** Core properties (title/author) from docProps/core.xml. */
function parseCoreProps(xml: string): { title?: string; author?: string } {
  const pick = (tag: string): string | undefined => {
    const m = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`).exec(xml);
    const v = m ? decodeXmlEntities(m[1]).trim() : '';
    return v || undefined;
  };
  return { title: pick('dc:title'), author: pick('dc:creator') };
}

/** Parse a .docx/.docm from a zip source. */
export async function parseDocxSource(src: ZipSource, opts: DocumentParseOptions = {}): Promise<ParsedDocument> {
  const maxBlocks = clampBlocks(opts);
  const readText = async (name: string): Promise<string | null> => {
    const b = await src.readMember(name);
    return b ? b.toString('utf8') : null;
  };
  const documentXml = await readText('word/document.xml');
  if (documentXml === null) throw new Error('not a Word document (word/document.xml missing)');

  const ctx: DocxContext = {
    styles: parseDocxStyles((await readText('word/styles.xml')) ?? ''),
    numbering: parseDocxNumbering((await readText('word/numbering.xml')) ?? ''),
    rels: parseRels((await readText('word/_rels/document.xml.rels')) ?? ''),
    partDir: 'word/',
    maxBlocks,
    footnoteOrder: new Map(),
  };

  const bodyXml = /<w:body\b[^>]*>([\s\S]*)<\/w:body>/.exec(documentXml)?.[1] ?? documentXml;
  const { blocks, truncated } = parseDocxBody(bodyXml, ctx);

  const footnotes = [
    ...parseNotes((await readText('word/footnotes.xml')) ?? '', ctx, ctx.footnoteOrder),
    ...parseNotes((await readText('word/endnotes.xml')) ?? '', ctx, ctx.footnoteOrder),
  ].sort((a, b) => a.id - b.id);

  // Header/footer of the first section, as plain text (they repeat per page,
  // so the viewer shows them once as document chrome).
  const headerText = await (async () => {
    for (const name of ['word/header1.xml', 'word/header2.xml']) {
      const xml = await readText(name);
      if (!xml) continue;
      const text = blocksToText(parseDocxBody(xml, { ...ctx, maxBlocks: 40 }).blocks).trim();
      if (text) return text;
    }
    return undefined;
  })();
  const footerText = await (async () => {
    for (const name of ['word/footer1.xml', 'word/footer2.xml']) {
      const xml = await readText(name);
      if (!xml) continue;
      const text = blocksToText(parseDocxBody(xml, { ...ctx, maxBlocks: 40 }).blocks).trim();
      if (text) return text;
    }
    return undefined;
  })();

  const core = parseCoreProps((await readText('docProps/core.xml')) ?? '');
  // Total block count: cheap tag count when the body was capped.
  const blockCount = truncated
    ? (bodyXml.match(/<w:p\b/g) || []).length + (bodyXml.match(/<w:tbl\b/g) || []).length
    : blocks.length;

  return {
    format: 'docx',
    title: core.title,
    author: core.author,
    blocks,
    footnotes: footnotes.length > 0 ? footnotes : undefined,
    header: headerText,
    footer: footerText,
    wordCount: countWords(blocks),
    blockCount,
    truncated,
  };
}

export function parseDocxBuffer(buf: Buffer, opts: DocumentParseOptions = {}): Promise<ParsedDocument> {
  return parseDocxSource(zipSourceFromBuffer(buf), opts);
}

// ── odt (OpenDocument text) ─────────────────────────────────────────────────

interface OdtStyleInfo {
  heading?: number;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  mono?: boolean;
  color?: string;
  highlight?: string;
  align?: DocParagraph['align'];
  parent?: string;
}

/** ODF style name → formatting (automatic styles + named styles). */
export function parseOdtStyles(xml: string): Map<string, OdtStyleInfo> {
  const styles = new Map<string, OdtStyleInfo>();
  const re = /<style:style\b([^>]*)(?:\/>|>([\s\S]*?)<\/style:style>)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const name = xmlAttr(m[1], 'name');
    if (!name) continue;
    const body = m[2] ?? '';
    const textProps = /<style:text-properties\b([^>]*)\/?>/.exec(body)?.[1] ?? '';
    const paraProps = /<style:paragraph-properties\b([^>]*)\/?>/.exec(body)?.[1] ?? '';
    const parent = xmlAttr(m[1], 'parent-style-name');
    const align = xmlAttr(paraProps, 'text-align');
    const family = xmlAttr(textProps, 'font-name') ?? xmlAttr(textProps, 'font-family');
    const info: OdtStyleInfo = { parent };
    if (xmlAttr(textProps, 'font-weight') === 'bold') info.bold = true;
    if (xmlAttr(textProps, 'font-style') === 'italic') info.italic = true;
    const underline = xmlAttr(textProps, 'text-underline-style');
    if (underline && underline !== 'none') info.underline = true;
    const strike = xmlAttr(textProps, 'text-line-through-style');
    if (strike && strike !== 'none') info.strike = true;
    if (family && MONO_FONTS.test(family)) info.mono = true;
    const color = normalizeColor(xmlAttr(textProps, 'color'));
    if (color) info.color = color;
    const bg = xmlAttr(textProps, 'background-color');
    if (bg && bg !== 'transparent') {
      const hex = normalizeColor(bg);
      if (hex) info.highlight = hex;
    }
    if (align === 'center' || align === 'end' || align === 'right') info.align = align === 'end' ? 'right' : align;
    else if (align === 'justify') info.align = 'justify';
    // Heading styles in ODF are named "Heading_20_2" / parent "Heading".
    const hm = /^Heading_20_(\d)$/.exec(name) ?? /^Heading(\d)$/.exec(name);
    if (hm) info.heading = Math.min(6, Math.max(1, parseInt(hm[1], 10)));
    styles.set(name, info);
  }
  return styles;
}

function resolveOdtStyle(styles: Map<string, OdtStyleInfo>, name: string | undefined): OdtStyleInfo {
  const out: OdtStyleInfo = {};
  let cur = name;
  const seen = new Set<string>();
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    const info = styles.get(cur);
    if (!info) break;
    for (const k of ['heading', 'bold', 'italic', 'underline', 'strike', 'mono', 'color', 'highlight', 'align'] as const) {
      if (out[k] === undefined && info[k] !== undefined) (out as Record<string, unknown>)[k] = info[k];
    }
    cur = info.parent;
  }
  return out;
}

/** Inline content of an ODF paragraph → runs (spans, links, tabs, breaks). */
function parseOdtInline(fragment: string, styles: Map<string, OdtStyleInfo>, base: OdtStyleInfo, href?: string): DocRun[] {
  const runs: DocRun[] = [];
  const push = (text: string, info: OdtStyleInfo, link?: string) => {
    if (text === '') return;
    const run: DocRun = { text };
    if (info.bold) run.bold = true;
    if (info.italic) run.italic = true;
    if (info.underline) run.underline = true;
    if (info.strike) run.strike = true;
    if (info.mono) run.mono = true;
    if (info.color) run.color = info.color;
    if (info.highlight) run.highlight = info.highlight;
    if (link) run.href = link;
    runs.push(run);
  };
  const re = /<text:span\b([^>]*)(?:\/>|>([\s\S]*?)<\/text:span>)|<text:a\b([^>]*)>([\s\S]*?)<\/text:a>|<text:s\b([^>]*)\/>|<text:tab\b[^>]*\/>|<text:line-break\b[^>]*\/>|<[^>]+>|([^<]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(fragment)) !== null) {
    if (m[1] !== undefined) {
      const info = { ...base, ...resolveOdtStyle(styles, xmlAttr(m[1], 'style-name')) };
      runs.push(...parseOdtInline(m[2] ?? '', styles, info, href));
    } else if (m[3] !== undefined) {
      const link = decodeXmlEntities(xmlAttr(m[3], 'href') ?? '');
      runs.push(...parseOdtInline(m[4] ?? '', styles, base, link || href));
    } else if (m[0].startsWith('<text:s')) {
      push(' '.repeat(parseInt(xmlAttr(m[5] ?? '', 'c') ?? '1', 10) || 1), base, href);
    } else if (m[0].startsWith('<text:tab')) {
      push('\t', base, href);
    } else if (m[0].startsWith('<text:line-break')) {
      push('\n', base, href);
    } else if (m[6] !== undefined) {
      push(decodeXmlEntities(m[6]), base, href);
    }
  }
  return runs;
}

interface OdtContext {
  styles: Map<string, OdtStyleInfo>;
  /** List style name → per-level kind. */
  listKinds: Map<string, DocListKind[]>;
  maxBlocks: number;
}

/** ODF list definitions → bullet vs ordered per level. */
function parseOdtListStyles(xml: string): Map<string, DocListKind[]> {
  const out = new Map<string, DocListKind[]>();
  const re = /<text:list-style\b([^>]*)>([\s\S]*?)<\/text:list-style>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const name = xmlAttr(m[1], 'name');
    if (!name) continue;
    const levels: DocListKind[] = [];
    const lvlRe = /<text:list-level-style-(number|bullet|image)\b([^>]*)/g;
    let lm: RegExpExecArray | null;
    while ((lm = lvlRe.exec(m[2])) !== null) {
      const level = (parseInt(xmlAttr(lm[2], 'level') ?? '1', 10) || 1) - 1;
      levels[level] = lm[1] === 'number' ? 'ordered' : 'bullet';
    }
    out.set(name, levels);
  }
  return out;
}

function parseOdtBody(xml: string, ctx: OdtContext, depth = 0, listState?: { kind: DocListKind; level: number }): { blocks: DocBlock[]; truncated: boolean } {
  const blocks: DocBlock[] = [];
  let truncated = false;
  if (depth > 8) return { blocks, truncated };
  const re = /<table:table\b([^>]*)>([\s\S]*?)<\/table:table>|<text:list\b([^>]*)>([\s\S]*?)<\/text:list>|<text:(h|p)\b([^>]*)(?:\/>|>([\s\S]*?)<\/text:\5>)/g;
  let m: RegExpExecArray | null;
  let cursor = 0;
  while ((m = re.exec(xml)) !== null) {
    if (m.index < cursor) continue;
    if (blocks.length >= ctx.maxBlocks) { truncated = true; break; }
    cursor = m.index + m[0].length;
    if (m[2] !== undefined) {
      // Table: rows of cells, each cell a nested body.
      const rows: DocTableCell[][] = [];
      let colCount = 0;
      const rowRe = /<table:table-row\b[^>]*>([\s\S]*?)<\/table:table-row>/g;
      let rm: RegExpExecArray | null;
      while ((rm = rowRe.exec(m[2])) !== null) {
        if (rows.length >= MAX_TABLE_ROWS) break;
        const cells: DocTableCell[] = [];
        const cellRe = /<table:(?:covered-)?table-cell\b([^>]*)(?:\/>|>([\s\S]*?)<\/table:(?:covered-)?table-cell>)/g;
        let cm: RegExpExecArray | null;
        let width = 0;
        while ((cm = cellRe.exec(rm[1])) !== null) {
          if (cells.length >= MAX_TABLE_COLS) break;
          const span = Math.max(1, parseInt(xmlAttr(cm[1], 'number-columns-spanned') ?? '1', 10) || 1);
          const cell: DocTableCell = { blocks: cm[2] ? parseOdtBody(cm[2], ctx, depth + 1).blocks : [] };
          if (span > 1) cell.colSpan = span;
          cells.push(cell);
          width += span;
        }
        if (width > colCount) colCount = width;
        rows.push(cells);
      }
      if (rows.length > 1) {
        const first = rows[0];
        const allBold = first.length > 0 && first.every((c) => c.blocks.every((b) => b.type !== 'paragraph' || b.runs.every((r) => r.bold || r.text.trim() === '')));
        if (allBold) for (const c of first) c.header = true;
      }
      blocks.push({ type: 'table', rows, colCount });
      continue;
    }
    if (m[4] !== undefined) {
      // List: each <text:list-item> holds paragraphs at this level.
      const styleName = xmlAttr(m[3], 'style-name');
      const kinds = styleName ? ctx.listKinds.get(styleName) : undefined;
      const level = listState ? listState.level + 1 : 0;
      const kind = kinds?.[level] ?? listState?.kind ?? 'bullet';
      const inner = parseOdtBody(m[4], ctx, depth + 1, { kind, level });
      blocks.push(...inner.blocks);
      truncated = truncated || inner.truncated;
      continue;
    }
    // Heading (text:h) or paragraph (text:p).
    const isHeading = m[5] === 'h';
    const attrs = m[6] ?? '';
    const inner = m[7] ?? '';
    const styleInfo = resolveOdtStyle(ctx.styles, xmlAttr(attrs, 'style-name'));
    const runs = parseOdtInline(inner, ctx.styles, styleInfo);
    if (runs.length === 0 && !isHeading) continue;
    const para: DocParagraph = { type: 'paragraph', runs };
    if (isHeading) {
      const lvl = parseInt(xmlAttr(attrs, 'outline-level') ?? '', 10);
      para.heading = Math.min(6, Math.max(1, Number.isFinite(lvl) ? lvl : styleInfo.heading ?? 1));
    } else if (styleInfo.heading) {
      para.heading = styleInfo.heading;
    }
    if (styleInfo.align) para.align = styleInfo.align;
    if (listState) para.list = { kind: listState.kind, level: Math.min(8, listState.level) };
    if (runs.length === 0) continue;
    blocks.push(para);
  }
  return { blocks, truncated };
}

/** Parse the content.xml (+ styles.xml) of an OpenDocument text file. */
export function parseOdtContentXml(contentXml: string, stylesXml: string, opts: DocumentParseOptions = {}): ParsedDocument {
  const maxBlocks = clampBlocks(opts);
  const styles = new Map([...parseOdtStyles(stylesXml), ...parseOdtStyles(contentXml)]);
  const listKinds = new Map([...parseOdtListStyles(stylesXml), ...parseOdtListStyles(contentXml)]);
  const bodyXml = /<office:text\b[^>]*>([\s\S]*)<\/office:text>/.exec(contentXml)?.[1] ?? contentXml;
  const { blocks, truncated } = parseOdtBody(bodyXml, { styles, listKinds, maxBlocks });
  const blockCount = truncated
    ? (bodyXml.match(/<text:(?:p|h)\b/g) || []).length + (bodyXml.match(/<table:table\b/g) || []).length
    : blocks.length;
  return {
    format: 'odt',
    blocks,
    wordCount: countWords(blocks),
    blockCount,
    truncated,
  };
}

export async function parseOdtSource(src: ZipSource, opts: DocumentParseOptions = {}): Promise<ParsedDocument> {
  const content = await src.readMember('content.xml');
  if (!content) throw new Error('not an OpenDocument text file (content.xml missing)');
  const stylesPart = await src.readMember('styles.xml');
  const parsed = parseOdtContentXml(content.toString('utf8'), stylesPart ? stylesPart.toString('utf8') : '', opts);
  const meta = await src.readMember('meta.xml');
  if (meta) {
    const xml = meta.toString('utf8');
    const title = /<dc:title\b[^>]*>([\s\S]*?)<\/dc:title>/.exec(xml)?.[1];
    const author = /<(?:dc:creator|meta:initial-creator)\b[^>]*>([\s\S]*?)<\/(?:dc:creator|meta:initial-creator)>/.exec(xml)?.[1];
    if (title) parsed.title = decodeXmlEntities(title).trim() || undefined;
    if (author) parsed.author = decodeXmlEntities(author).trim() || undefined;
  }
  return parsed;
}

export function parseOdtBuffer(buf: Buffer, opts: DocumentParseOptions = {}): Promise<ParsedDocument> {
  return parseOdtSource(zipSourceFromBuffer(buf), opts);
}

// ── rtf ─────────────────────────────────────────────────────────────────────

/** Minimal RTF reader: paragraphs with bold/italic/underline, unicode escapes,
 * skipping the destinations that carry metadata or binary payloads. */
export function parseRtf(text: string, opts: DocumentParseOptions = {}): ParsedDocument {
  const maxBlocks = clampBlocks(opts);
  const blocks: DocBlock[] = [];
  let truncated = false;
  let paraRuns: DocRun[] = [];
  let buf = '';
  type State = { bold: boolean; italic: boolean; underline: boolean; skip: boolean; ucSkip: number };
  const stack: State[] = [];
  let st: State = { bold: false, italic: false, underline: false, skip: false, ucSkip: 1 };
  let blockCount = 0;

  const flushRun = () => {
    if (buf === '' || st.skip) { buf = ''; return; }
    const run: DocRun = { text: buf };
    if (st.bold) run.bold = true;
    if (st.italic) run.italic = true;
    if (st.underline) run.underline = true;
    paraRuns.push(run);
    buf = '';
  };
  const flushPara = () => {
    flushRun();
    blockCount++;
    if (paraRuns.length > 0) {
      if (blocks.length >= maxBlocks) truncated = true;
      else blocks.push({ type: 'paragraph', runs: paraRuns });
    }
    paraRuns = [];
  };

  // Destinations whose content must not be emitted as text.
  const SKIP_DESTS = /^(fonttbl|colortbl|stylesheet|info|pict|object|themedata|colorschememapping|latentstyles|datastore|generator|xmlnstbl|listtable|listoverridetable|rsidtbl|mmath|filetbl|shppict|nonshppict|header|footer|headerl|headerr|footerl|footerr|footnote|annotation|comment|field|fldinst|bkmkstart|bkmkend|do)$/;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '{') {
      stack.push({ ...st });
      continue;
    }
    if (ch === '}') {
      flushRun();
      const prev = stack.pop();
      if (prev) st = prev;
      continue;
    }
    if (ch === '\\') {
      const next = text[i + 1];
      if (next === '\\' || next === '{' || next === '}') { buf += next; i++; continue; }
      // `{\*\destination …}` — an extension destination: never document text.
      if (next === '*') { flushRun(); st.skip = true; i++; continue; }
      if (next === '\n' || next === '\r') { flushPara(); i++; continue; }
      if (next === '~') { buf += ' '; i++; continue; }
      if (next === '-' || next === '_') { i++; continue; }
      if (next === "'") {
        const hex = text.slice(i + 2, i + 4);
        const code = parseInt(hex, 16);
        if (Number.isFinite(code)) buf += Buffer.from([code]).toString('latin1');
        i += 3;
        continue;
      }
      // Control word: \word[-]?digits, optional trailing space.
      const cw = /^\\([a-zA-Z]+)(-?\d+)? ?/.exec(text.slice(i));
      if (!cw) { i++; continue; }
      const word = cw[1];
      const param = cw[2] !== undefined ? parseInt(cw[2], 10) : undefined;
      i += cw[0].length - 1;
      switch (word) {
        case 'par': case 'line': flushPara(); break;
        case 'cell': flushRun(); buf = '\t'; break;
        case 'row': flushPara(); break;
        case 'b': flushRun(); st.bold = param !== 0; break;
        case 'i': flushRun(); st.italic = param !== 0; break;
        case 'ul': flushRun(); st.underline = param !== 0; break;
        case 'ulnone': flushRun(); st.underline = false; break;
        case 'plain': flushRun(); st.bold = st.italic = st.underline = false; break;
        case 'uc': st.ucSkip = param ?? 1; break;
        case 'u': {
          if (param !== undefined) buf += String.fromCharCode(param < 0 ? param + 65536 : param);
          // The next `ucSkip` "characters" are the ANSI fallback for readers
          // that can't do unicode. A fallback unit is either a literal char or
          // a `\'xx` hex escape (LibreOffice writes `\u237\'ed`) — skipping
          // only literals left the escape behind as a duplicate letter.
          let skipped = 0;
          while (skipped < st.ucSkip && i + 1 < text.length) {
            if (text[i + 1] === '\\' && text[i + 2] === "'") { i += 4; skipped++; continue; }
            const c = text[i + 1];
            if (c === '\\' || c === '{' || c === '}') break;
            i++;
            skipped++;
          }
          break;
        }
        case 'tab': buf += '\t'; break;
        case 'emdash': buf += '—'; break;
        case 'endash': buf += '–'; break;
        case 'lquote': buf += '‘'; break;
        case 'rquote': buf += '’'; break;
        case 'ldblquote': buf += '“'; break;
        case 'rdblquote': buf += '”'; break;
        case 'bullet': buf += '•'; break;
        default:
          if (SKIP_DESTS.test(word)) { flushRun(); st.skip = true; }
          break;
      }
      continue;
    }
    if (ch === '\n' || ch === '\r') continue;
    buf += ch;
  }
  flushPara();
  return { format: 'rtf', blocks, wordCount: countWords(blocks), blockCount: Math.max(blockCount, blocks.length), truncated, plainTextOnly: true };
}

// ── sniffing + entry points ─────────────────────────────────────────────────

export type SniffedDocument = 'zip' | 'cfb' | 'rtf' | 'xml' | 'text';

export function sniffDocumentHead(head: Buffer): SniffedDocument {
  if (isCfbBuffer(head)) return 'cfb';
  if (head.length >= 4 && head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04) return 'zip';
  const text = decodeTextBuffer(head.subarray(0, 512)).trimStart();
  if (text.startsWith('{\\rtf')) return 'rtf';
  if (text.startsWith('<?xml')) return 'xml';
  return 'text';
}

async function parseZipDocument(src: ZipSource, opts: DocumentParseOptions): Promise<ParsedDocument> {
  if (src.members.has('word/document.xml')) return parseDocxSource(src, opts);
  if (src.members.has('content.xml')) return parseOdtSource(src, opts);
  throw new Error('zip container is neither a Word document nor an OpenDocument text file');
}

/** Read a document file from disk. Throws `UnsupportedDocumentError` for
 * recognized-but-unparseable formats and plain Errors for corrupt files. */
export async function readDocument(filePath: string, opts: DocumentParseOptions = {}): Promise<ParsedDocument> {
  const ext = path.extname(filePath).toLowerCase();
  if (detectDocumentKind(filePath) === null) throw new UnsupportedDocumentError(`Not a document: ${ext || 'no extension'}`, ext);
  const fd = await fs.promises.open(filePath, 'r');
  try {
    const { size } = await fd.stat();
    const headLen = Math.min(size, 4096);
    const head = Buffer.alloc(headLen);
    await fd.read(head, 0, headLen, 0);
    const sniffed = sniffDocumentHead(head);
    if (sniffed === 'zip') {
      // Only the parts needed are inflated; the file is never read whole.
      return await parseZipDocument(await zipSourceFromFd(fd, size), opts);
    }
    if (size > DOCUMENT_MAX_FILE_BYTES) {
      throw new Error(`File too large to preview (${Math.round(size / 1024 / 1024)} MB > ${DOCUMENT_MAX_FILE_BYTES / 1024 / 1024} MB)`);
    }
    const buf = Buffer.alloc(size);
    let off = 0;
    while (off < size) {
      const { bytesRead } = await fd.read(buf, off, size - off, off);
      if (bytesRead <= 0) break;
      off += bytesRead;
    }
    if (sniffed === 'cfb') return parseDocBuffer(buf, clampBlocks(opts));
    if (sniffed === 'rtf') return parseRtf(decodeTextBuffer(buf), opts);
    if (sniffed === 'xml') {
      // Flat ODF (.fodt) keeps content and styles in one file.
      const xml = decodeTextBuffer(buf);
      if (/<office:document\b/.test(xml)) return parseOdtContentXml(xml, xml, opts);
    }
    throw new UnsupportedDocumentError(
      `This file does not look like a document (its first bytes are neither a zip/OOXML container, an OLE2 Word file, nor RTF).`,
      ext,
    );
  } finally {
    await fd.close();
  }
}

/** Parse from memory (tests, embedded payloads). */
export async function parseDocumentBuffer(buf: Buffer, filePath: string, opts: DocumentParseOptions = {}): Promise<ParsedDocument> {
  const ext = path.extname(filePath).toLowerCase();
  const sniffed = sniffDocumentHead(buf.subarray(0, 4096));
  if (sniffed === 'zip') return parseZipDocument(zipSourceFromBuffer(buf), opts);
  if (sniffed === 'cfb') return parseDocBuffer(buf, clampBlocks(opts));
  if (sniffed === 'rtf') return parseRtf(decodeTextBuffer(buf), opts);
  if (sniffed === 'xml') {
    const xml = decodeTextBuffer(buf);
    if (/<office:document\b/.test(xml)) return parseOdtContentXml(xml, xml, opts);
  }
  throw new UnsupportedDocumentError('This file does not look like a document.', ext);
}
