import { describe, it, expect } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import zlib from 'zlib';
import { fileURLToPath } from 'url';
import {
  blocksToText,
  countWords,
  detectDocumentKind,
  parseDocumentBuffer,
  parseDocxBuffer,
  parseDocxNumbering,
  parseDocxStyles,
  parseOdtBuffer,
  parseRels,
  parseRtf,
  readDocument,
  sniffDocumentHead,
  UnsupportedDocumentError,
} from './document-parse.js';
import { docTextToParagraphs, parsePieceTable } from './document-doc.js';
import type { DocParagraph, DocTable } from '../../shared/document-types.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(here, 'fixtures', 'documents');
const DOCX = path.join(FIXTURES, 'sample.docx');
const ODT = path.join(FIXTURES, 'sample.odt');
const DOC = path.join(FIXTURES, 'sample.doc');
const RTF = path.join(FIXTURES, 'sample.rtf');

// ── minimal zip writer (deflated) so tests can hand-craft OOXML packages ─────

function crc32(buf: Buffer): number {
  let c: number;
  let crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function buildZip(files: Record<string, string>): Buffer {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const nameBuf = Buffer.from(name, 'utf8');
    const raw = Buffer.from(content, 'utf8');
    const data = zlib.deflateRawSync(raw);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x800, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc32(raw), 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    parts.push(local, nameBuf, data);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0x800, 8);
    cd.writeUInt16LE(8, 10);
    cd.writeUInt32LE(crc32(raw), 16);
    cd.writeUInt32LE(data.length, 20);
    cd.writeUInt32LE(raw.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt32LE(offset, 42);
    central.push(cd, nameBuf);
    offset += local.length + nameBuf.length + data.length;
  }
  const cdBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(Object.keys(files).length, 8);
  eocd.writeUInt16LE(Object.keys(files).length, 10);
  eocd.writeUInt32LE(cdBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, cdBuf, eocd]);
}

const STYLES_XML = `<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/></w:style>
<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:basedOn w:val="Normal"/><w:pPr><w:jc w:val="center"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="MiEstilo"><w:name w:val="Mi Estilo"/><w:basedOn w:val="Heading2"/></w:style>
<w:style w:type="paragraph" w:styleId="Codigo"><w:name w:val="Code"/><w:rPr><w:rFonts w:ascii="Consolas"/></w:rPr></w:style>
</w:styles>`;

const NUMBERING_XML = `<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/></w:lvl><w:lvl w:ilvl="1"><w:numFmt w:val="bullet"/></w:lvl></w:abstractNum>
<w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:numFmt w:val="decimal"/></w:lvl><w:lvl w:ilvl="1"><w:numFmt w:val="lowerLetter"/></w:lvl></w:abstractNum>
<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>
<w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num>
</w:numbering>`;

const RELS_XML = `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type=".../hyperlink" Target="https://tide.mx/a?b=1&amp;c=2" TargetMode="External"/>
<Relationship Id="rId2" Type=".../image" Target="media/image1.png"/>
</Relationships>`;

const DOCUMENT_XML = `<?xml version="1.0" encoding="UTF-8"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
 xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
 xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
 xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing">
<w:body>
<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Primer título</w:t></w:r></w:p>
<w:p><w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">negrita </w:t></w:r><w:r><w:rPr><w:i w:val="1"/></w:rPr><w:t>cursiva</w:t></w:r><w:r><w:rPr><w:b w:val="0"/></w:rPr><w:t xml:space="preserve"> normal &amp; entidades &lt;ok&gt;</w:t></w:r></w:p>
<w:p><w:r><w:rPr><w:u w:val="single"/><w:strike/><w:color w:val="C00000"/><w:highlight w:val="yellow"/></w:rPr><w:t>marcado</w:t></w:r><w:r><w:rPr><w:vertAlign w:val="superscript"/></w:rPr><w:t>2</w:t></w:r></w:p>
<w:p><w:pPr><w:jc w:val="both"/></w:pPr><w:r><w:t>Justificado</w:t></w:r><w:r><w:tab/><w:t>tras tab</w:t></w:r><w:r><w:br/><w:t>tras salto</w:t></w:r></w:p>
<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>viñeta</w:t></w:r></w:p>
<w:p><w:pPr><w:numPr><w:ilvl w:val="1"/><w:numId w:val="2"/></w:numPr></w:pPr><w:r><w:t>numerada nivel 2</w:t></w:r></w:p>
<w:p><w:pPr><w:pStyle w:val="MiEstilo"/></w:pPr><w:r><w:t>Estilo derivado</w:t></w:r></w:p>
<w:p><w:hyperlink r:id="rId1"><w:r><w:t>enlace</w:t></w:r></w:hyperlink><w:r><w:t xml:space="preserve"> y </w:t></w:r><w:hyperlink w:anchor="marca"><w:r><w:t>ancla</w:t></w:r></w:hyperlink></w:p>
<w:p><w:r><w:drawing><wp:inline><wp:extent cx="952500" cy="476250"/><wp:docPr id="1" name="Imagen 1" descr="mi imagen"/><a:graphic><a:graphicData><a:blip r:embed="rId2"/></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>
<w:tbl>
<w:tr><w:trPr><w:tblHeader/></w:trPr>
  <w:tc><w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Concepto</w:t></w:r></w:p></w:tc>
  <w:tc><w:tcPr><w:shd w:fill="EEEEEE"/></w:tcPr><w:p><w:r><w:t>Monto</w:t></w:r></w:p></w:tc>
</w:tr>
<w:tr>
  <w:tc><w:tcPr><w:gridSpan w:val="2"/></w:tcPr><w:p><w:r><w:t>fila combinada</w:t></w:r></w:p></w:tc>
</w:tr>
</w:tbl>
<w:p><w:r><w:footnoteReference w:id="2"/></w:r><w:r><w:t>con nota</w:t></w:r></w:p>
<w:p><w:r><w:br w:type="page"/><w:t>tras salto de página</w:t></w:r></w:p>
</w:body></w:document>`;

const FOOTNOTES_XML = `<w:footnotes xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:footnote w:id="0"><w:p><w:r><w:t>separador</w:t></w:r></w:p></w:footnote>
<w:footnote w:id="2"><w:p><w:r><w:t>Texto de la nota</w:t></w:r></w:p></w:footnote>
</w:footnotes>`;

const HEADER_XML = `<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:r><w:t>ENCABEZADO DOC</w:t></w:r></w:p></w:hdr>`;
const CORE_XML = `<cp:coreProperties xmlns:cp="x" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Mi documento</dc:title><dc:creator>David</dc:creator></cp:coreProperties>`;

function docxPackage(overrides: Record<string, string> = {}): Buffer {
  return buildZip({
    'word/document.xml': DOCUMENT_XML,
    'word/styles.xml': STYLES_XML,
    'word/numbering.xml': NUMBERING_XML,
    'word/_rels/document.xml.rels': RELS_XML,
    'word/footnotes.xml': FOOTNOTES_XML,
    'word/header1.xml': HEADER_XML,
    'docProps/core.xml': CORE_XML,
    ...overrides,
  });
}

describe('docx style / numbering / rels tables', () => {
  it('reads heading levels by name and through basedOn', () => {
    const styles = parseDocxStyles(STYLES_XML);
    expect(styles.get('Heading1')?.heading).toBe(1);
    expect(styles.get('Heading2')?.heading).toBe(2);
    expect(styles.get('Quote')?.heading).toBeUndefined();
    expect(styles.get('Quote')?.align).toBe('center');
    expect(styles.get('MiEstilo')?.basedOn).toBe('Heading2');
    expect(styles.get('Codigo')?.mono).toBe(true);
  });

  it('maps numId → per-level bullet/ordered', () => {
    const nums = parseDocxNumbering(NUMBERING_XML);
    expect(nums.get('1')).toEqual(['bullet', 'bullet']);
    expect(nums.get('2')).toEqual(['ordered', 'ordered']);
    expect(nums.get('99')).toBeUndefined();
  });

  it('decodes relationship targets and the external flag', () => {
    const rels = parseRels(RELS_XML);
    expect(rels.get('rId1')).toEqual({ target: 'https://tide.mx/a?b=1&c=2', external: true });
    expect(rels.get('rId2')).toEqual({ target: 'media/image1.png', external: false });
  });
});

describe('parseDocxBuffer (hand-crafted package)', () => {
  it('renders headings, runs, formatting, alignment, tabs and breaks', async () => {
    const doc = await parseDocxBuffer(docxPackage());
    expect(doc.format).toBe('docx');
    expect(doc.title).toBe('Mi documento');
    expect(doc.author).toBe('David');
    expect(doc.header).toBe('ENCABEZADO DOC');

    const paras = doc.blocks.filter((b): b is DocParagraph => b.type === 'paragraph');
    expect(paras[0]).toMatchObject({ heading: 1, styleName: 'heading 1' });
    expect(paras[0].runs[0].text).toBe('Primer título');

    // Toggle inheritance: an explicit w:b w:val="0" turns bold OFF.
    expect(paras[1].runs.map((r) => [r.text, !!r.bold, !!r.italic])).toEqual([
      ['negrita ', true, false],
      ['cursiva', false, true],
      [' normal & entidades <ok>', false, false],
    ]);

    expect(paras[2].runs[0]).toMatchObject({ underline: true, strike: true, color: '#c00000', highlight: '#ffff00' });
    expect(paras[2].runs[1]).toMatchObject({ text: '2', superscript: true });

    expect(paras[3].align).toBe('justify');
    expect(paras[3].runs.map((r) => r.text).join('')).toBe('Justificado\ttras tab\ntras salto');
  });

  it('maps lists, derived styles, links and images', async () => {
    const doc = await parseDocxBuffer(docxPackage());
    const paras = doc.blocks.filter((b): b is DocParagraph => b.type === 'paragraph');
    expect(paras.find((p) => p.runs[0]?.text === 'viñeta')?.list).toEqual({ kind: 'bullet', level: 0 });
    expect(paras.find((p) => p.runs[0]?.text === 'numerada nivel 2')?.list).toEqual({ kind: 'ordered', level: 1 });
    // basedOn Heading2 → level 2 even though the style itself declares none.
    expect(paras.find((p) => p.runs[0]?.text === 'Estilo derivado')?.heading).toBe(2);

    const linkPara = paras.find((p) => p.runs.some((r) => r.href));
    expect(linkPara?.runs.map((r) => [r.text, r.href])).toEqual([
      ['enlace', 'https://tide.mx/a?b=1&c=2'],
      [' y ', undefined],
      ['ancla', '#marca'],
    ]);

    const imgPara = paras.find((p) => p.images?.length);
    expect(imgPara?.images?.[0]).toEqual({ entry: 'word/media/image1.png', width: 100, height: 50, alt: 'mi imagen' });
  });

  it('renders tables with header rows, spans and shading', async () => {
    const doc = await parseDocxBuffer(docxPackage());
    const table = doc.blocks.find((b): b is DocTable => b.type === 'table');
    expect(table).toBeTruthy();
    expect(table!.colCount).toBe(2);
    expect(table!.rows).toHaveLength(2);
    expect(table!.rows[0].every((c) => c.header)).toBe(true);
    expect(table!.rows[0][1].background).toBe('#eeeeee');
    expect(table!.rows[1][0].colSpan).toBe(2);
    expect(blocksToText(table!.rows[1][0].blocks)).toBe('fila combinada');
  });

  it('numbers footnote references and returns only the referenced notes', async () => {
    const doc = await parseDocxBuffer(docxPackage());
    const paras = doc.blocks.filter((b): b is DocParagraph => b.type === 'paragraph');
    const noteRef = paras.find((p) => p.runs.some((r) => r.footnoteRef));
    expect(noteRef?.runs[0]).toMatchObject({ footnoteRef: 1, superscript: true, text: '1' });
    expect(doc.footnotes).toEqual([{ id: 1, blocks: [{ type: 'paragraph', runs: [{ text: 'Texto de la nota' }] }] }]);
  });

  it('marks page breaks and counts words', async () => {
    const doc = await parseDocxBuffer(docxPackage());
    const last = doc.blocks[doc.blocks.length - 1] as DocParagraph;
    expect(last.pageBreak).toBe(true);
    expect(doc.wordCount).toBe(countWords(doc.blocks));
    expect(doc.wordCount).toBeGreaterThan(15);
    expect(doc.truncated).toBe(false);
  });

  it('caps blocks and reports the real count', async () => {
    const doc = await parseDocxBuffer(docxPackage(), { maxBlocks: 3 });
    expect(doc.blocks).toHaveLength(3);
    expect(doc.truncated).toBe(true);
    expect(doc.blockCount).toBeGreaterThan(3);
  });

  it('rejects zips that are not Word documents', async () => {
    await expect(parseDocxBuffer(buildZip({ 'hello.txt': 'x' }))).rejects.toThrow(/word\/document\.xml/);
  });
});

describe('parseDocxBuffer (python-docx fixture)', () => {
  it('reads the real package: title, headings, styles, list, table, image, page break', async () => {
    const doc = await parseDocxBuffer(fs.readFileSync(DOCX));
    expect(doc.title).toBe('Documento de prueba');
    expect(doc.author).toBe('Tide Commander');
    const paras = doc.blocks.filter((b): b is DocParagraph => b.type === 'paragraph');
    expect(paras.find((p) => p.heading === 1)?.runs.map((r) => r.text).join('')).toBe('Sección primera');
    const rich = paras.find((p) => p.runs.some((r) => r.text === 'negritas'))!;
    expect(rich.runs.find((r) => r.text === 'negritas')?.bold).toBe(true);
    expect(rich.runs.find((r) => r.text === 'cursivas')?.italic).toBe(true);
    expect(rich.runs.find((r) => r.text === 'subrayado')?.underline).toBe(true);
    expect(rich.runs.find((r) => r.text === 'tachado')?.strike).toBe(true);
    expect(rich.runs.some((r) => r.text.includes('café ☕ & <tag> "comillas".'))).toBe(true);

    const colored = paras.find((p) => p.runs.some((r) => r.color))!;
    expect(colored.runs.find((r) => r.text === 'rojo')?.color).toBe('#c00000');
    expect(colored.runs.find((r) => r.text === 'código')?.mono).toBe(true);
    expect(colored.runs.find((r) => r.text === 'super')?.superscript).toBe(true);
    expect(colored.runs.find((r) => r.text === 'sub')?.subscript).toBe(true);

    expect(paras.some((p) => p.align === 'center')).toBe(true);
    expect(paras.some((p) => p.align === 'justify')).toBe(true);
    expect(paras.filter((p) => p.list?.kind === 'bullet')).toHaveLength(2);
    expect(paras.filter((p) => p.list?.kind === 'ordered')).toHaveLength(2);
    expect(paras.some((p) => p.runs.some((r) => r.href === 'https://tide.mx/docs'))).toBe(true);
    expect(paras.some((p) => p.images?.some((i) => i.entry.startsWith('word/media/')))).toBe(true);
    expect(paras.some((p) => p.pageBreak)).toBe(true);

    const table = doc.blocks.find((b): b is DocTable => b.type === 'table')!;
    expect(table.rows).toHaveLength(3);
    expect(table.rows[0].every((c) => c.header)).toBe(true);
    expect(blocksToText(table.rows[1][0].blocks)).toBe('Transferencia SPEI');
  });
});

describe('parseOdtBuffer (LibreOffice fixture)', () => {
  it('reads headings, formatting, lists, links and tables', async () => {
    const doc = await parseOdtBuffer(fs.readFileSync(ODT));
    expect(doc.format).toBe('odt');
    expect(doc.title).toBe('Documento de prueba');
    const paras = doc.blocks.filter((b): b is DocParagraph => b.type === 'paragraph');
    expect(paras.some((p) => p.heading === 1 && p.runs.map((r) => r.text).join('') === 'Sección primera')).toBe(true);
    const rich = paras.find((p) => p.runs.some((r) => r.text === 'negritas'))!;
    expect(rich.runs.find((r) => r.text === 'negritas')?.bold).toBe(true);
    expect(rich.runs.find((r) => r.text === 'cursivas')?.italic).toBe(true);
    expect(paras.some((p) => p.list?.kind === 'bullet')).toBe(true);
    expect(paras.some((p) => p.runs.some((r) => r.href?.includes('tide.mx')))).toBe(true);
    expect(doc.blocks.some((b) => b.type === 'table')).toBe(true);
    expect(doc.wordCount).toBeGreaterThan(30);
  });
});

describe('legacy .doc (piece table)', () => {
  it('splits Word control characters into paragraphs and drops field instructions', () => {
    const CR = '\u000d';
    const CELL = '\u0007';
    const FIELD_BEGIN = '\u0013';
    const FIELD_SEP = '\u0014';
    const FIELD_END = '\u0015';
    const text = [
      `Primero${CR}`,
      `Izquierda${CELL}Derecha${CELL}${CELL}`,      // cells + row mark → one tabbed line
      `Terc${FIELD_BEGIN}HYPERLINK "http://x"${FIELD_SEP}${FIELD_END}ero final${CR}`,
      `Con\u0002nota y \u0001objeto${CR}`,           // footnote ref + picture placeholder
      `Tras salto${CR}`,
    ].join('');
    const { blocks, blockCount } = docTextToParagraphs(text, 100);
    const texts = blocks.map((b) => (b as DocParagraph).runs[0].text);
    expect(texts[0]).toBe('Primero');
    expect(texts).toContain('Izquierda\tDerecha');
    expect(texts).toContain('Tercero final');          // field instruction dropped, result kept
    expect(texts).toContain('Connota y objeto');       // sentinels stripped
    expect(texts[texts.length - 1]).toBe('Tras salto');
    expect(blockCount).toBeGreaterThanOrEqual(blocks.length);
  });

  it('returns [] for a Clx without a Pcdt', () => {
    expect(parsePieceTable(Buffer.from([0x03, 0x00]))).toEqual([]);
  });

  it('reads the LibreOffice-written sample.doc', async () => {
    const doc = await readDocument(DOC);
    expect(doc.format).toBe('doc');
    expect(doc.plainTextOnly).toBe(true);
    const text = blocksToText(doc.blocks);
    expect(text).toContain('Sección primera');
    expect(text).toContain('café ☕ & <tag> "comillas".');
    expect(text).toContain('Transferencia SPEI');
    expect(doc.wordCount).toBeGreaterThan(30);
  });
});

describe('rtf', () => {
  it('reads paragraphs with bold/italic and unicode escapes', () => {
    const doc = parseRtf(String.raw`{\rtf1\ansi\deff0 {\fonttbl{\f0 Times;}}\f0\fs24 Hola \b mundo\b0  normal\par Segundo\par}`);
    expect(doc.format).toBe('rtf');
    const first = doc.blocks[0] as DocParagraph;
    expect(first.runs.map((r) => [r.text, !!r.bold])).toEqual([['Hola ', false], ['mundo', true], [' normal', false]]);
    expect(blocksToText(doc.blocks)).toBe('Hola mundo normal\nSegundo');
  });

  it('consumes the ANSI fallback of a unicode escape exactly once', () => {
    // LibreOffice writes `\u237\'ed` — the fallback used to leak a duplicate.
    const doc = parseRtf(String.raw`{\rtf1\ansi T\u237\'edtulo\par}`);
    expect((doc.blocks[0] as DocParagraph).runs[0].text).toBe('Título');
  });

  it('skips \\* extension destinations (userprops, generator…)', () => {
    const doc = parseRtf(String.raw`{\rtf1\ansi{\*\userprops{\propname AppVersion}{\staticval 14.0000}}Contenido\par}`);
    expect(blocksToText(doc.blocks)).toBe('Contenido');
  });

  it('reads the LibreOffice-written sample.rtf', async () => {
    const doc = await readDocument(RTF);
    const text = blocksToText(doc.blocks);
    expect(text).toContain('Título del documento');
    expect(text).toContain('Sección primera');
    expect(text).toContain('café ☕');
    expect(doc.plainTextOnly).toBe(true);
  });
});

describe('sniffing + readDocument', () => {
  it('detects kinds by extension', () => {
    expect(detectDocumentKind('a.DOCX')).toBe('docx');
    expect(detectDocumentKind('a.docm')).toBe('docx');
    expect(detectDocumentKind('a.odt')).toBe('odt');
    expect(detectDocumentKind('a.doc')).toBe('doc');
    expect(detectDocumentKind('a.rtf')).toBe('rtf');
    expect(detectDocumentKind('a.pdf')).toBeNull();
  });

  it('sniffs containers from their first bytes', () => {
    expect(sniffDocumentHead(fs.readFileSync(DOCX).subarray(0, 4096))).toBe('zip');
    expect(sniffDocumentHead(fs.readFileSync(DOC).subarray(0, 4096))).toBe('cfb');
    expect(sniffDocumentHead(Buffer.from('{\\rtf1\\ansi'))).toBe('rtf');
    expect(sniffDocumentHead(Buffer.from('<?xml version="1.0"?><office:document/>'))).toBe('xml');
    expect(sniffDocumentHead(Buffer.from('plain text'))).toBe('text');
  });

  it('opens mislabeled files by CONTENT (a docx named .doc, an rtf named .doc)', async () => {
    const docx = fs.readFileSync(DOCX);
    expect((await parseDocumentBuffer(docx, '/x/informe.doc')).format).toBe('docx');
    const rtf = Buffer.from(String.raw`{\rtf1\ansi Contenido RTF\par}`);
    expect((await parseDocumentBuffer(rtf, '/x/informe.doc')).format).toBe('rtf');
  });

  it('refuses unknown extensions and non-document bytes', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-doc-'));
    try {
      await expect(readDocument(path.join(dir, 'x.pdf'))).rejects.toBeInstanceOf(UnsupportedDocumentError);
      const bogus = path.join(dir, 'bogus.docx');
      fs.writeFileSync(bogus, Buffer.from('this is definitely not a document'));
      await expect(readDocument(bogus)).rejects.toThrow(/does not look like a document/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reads every fixture format from disk', async () => {
    for (const [file, format] of [[DOCX, 'docx'], [ODT, 'odt'], [DOC, 'doc'], [RTF, 'rtf']] as const) {
      const doc = await readDocument(file, { maxBlocks: 500 });
      expect(doc.format, file).toBe(format);
      expect(doc.blocks.length, file).toBeGreaterThan(3);
      expect(blocksToText(doc.blocks), file).toContain('Sección primera');
    }
  });
});
