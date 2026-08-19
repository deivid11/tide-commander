import { describe, it, expect } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import zlib from 'zlib';
import { fileURLToPath } from 'url';
import {
  columnLetterToIndex,
  decodeXmlEntities,
  detectSpreadsheetKind,
  indexZip,
  makeRowCounter,
  parseDelimited,
  parseHtmlTable,
  parseOdsBuffer,
  parseSpreadsheetBuffer,
  parseXlsxBuffer,
  readSpreadsheet,
  readZipMember,
  sniffDelimiter,
  sniffSpreadsheetBuffer,
  UnsupportedSpreadsheetError,
} from './spreadsheet-parse.js';
import { classifyNumberFormat, formatGeneralNumber, formatSerialDate } from './spreadsheet-format.js';
import { parseXlsBuffer } from './spreadsheet-biff.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(here, 'fixtures', 'spreadsheets', 'sample.xlsx');
const FIXTURE_XLS = path.join(here, 'fixtures', 'spreadsheets', 'sample.xls');
const FIXTURE_ODS = path.join(here, 'fixtures', 'spreadsheets', 'sample.ods');

// ── minimal zip writer (stored or deflated) so tests can hand-craft workbooks ─

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

function buildZip(files: Record<string, string>, opts: { deflate?: boolean } = {}): Buffer {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const nameBuf = Buffer.from(name, 'utf8');
    const raw = Buffer.from(content, 'utf8');
    const data = opts.deflate ? zlib.deflateRawSync(raw) : raw;
    const method = opts.deflate ? 8 : 0;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x800, 6);
    local.writeUInt16LE(method, 8);
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
    cd.writeUInt16LE(method, 10);
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

const WORKBOOK_TWO_SHEETS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<workbookPr/><sheets><sheet name="Ventas &amp; Costos" sheetId="1" r:id="rId1"/><sheet name="Resumen" sheetId="2" state="hidden" r:id="rId2"/></sheets></workbook>`;

const RELS_ABSOLUTE = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="/xl/worksheets/sheet2.xml"/>
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>
</Relationships>`;

const SHARED = `<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="4" uniqueCount="4">
<si><t>Producto</t></si>
<si><r><rPr><b/></rPr><t>Rico</t></r><r><t xml:space="preserve"> texto</t></r></si>
<si><t>Tom &amp; Jerry &lt;3</t></si>
<si><t>漢字</t><rPh sb="0" eb="2"><t>かんじ</t></rPh></si>
</sst>`;

const STYLES = `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="2"><numFmt numFmtId="164" formatCode="[$-409]d-mmm-yy;@"/><numFmt numFmtId="165" formatCode="0.0%"/></numFmts>
<cellXfs count="6">
<xf numFmtId="0"/><xf numFmtId="14"/><xf numFmtId="164"/><xf numFmtId="165"/><xf numFmtId="22"/><xf numFmtId="21"/>
</cellXfs></styleSheet>`;

// Excel-style sheet: spans, shared strings, rich text, inline string, boolean,
// error, formula with cached value, dates in 3 formats, percent, sparse row.
const SHEET1 = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<dimension ref="A1:H7"/>
<sheetData>
<row r="1" spans="1:8"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c><c r="D1" t="s"><v>3</v></c></row>
<row r="2"><c r="A2" t="inlineStr"><is><t>inline</t></is></c><c r="B2"><v>1234.5</v></c><c r="C2" t="b"><v>1</v></c><c r="D2" t="e"><v>#N/A</v></c><c r="E2"><f>B2*2</f><v>2469</v></c><c r="F2" s="0"/></row>
<row r="3"><c r="A3" s="1"><v>46252</v></c><c r="B3" s="2"><v>46252</v></c><c r="C3" s="4"><v>46252.395</v></c><c r="D3" s="5"><v>0.75</v></c><c r="E3" s="3"><v>0.256</v></c></row>
<row r="5"><c r="H5" t="str"><v>formula-str</v></c></row>
<row r="7"><c r="A7"><v>0.30000000000000004</v></c><c r="B7"><v>1E-05</v></c><c r="C7"><v>-42</v></c></row>
</sheetData></worksheet>`;

const SHEET2 = `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>oculto</t></is></c></row></sheetData></worksheet>`;

function workbook(files: Record<string, string>, deflate = false): Buffer {
  return buildZip(files, { deflate });
}

describe('zip helpers', () => {
  it('indexes and reads stored + deflated members', async () => {
    for (const deflate of [false, true]) {
      const buf = buildZip({ 'a.txt': 'hola', 'dir/b.txt': 'mundo' }, { deflate });
      const idx = indexZip(buf);
      expect([...idx.keys()]).toEqual(['a.txt', 'dir/b.txt']);
      expect(readZipMember(buf, idx.get('dir/b.txt')!).toString()).toBe('mundo');
    }
  });

  it('rejects non-zips', async () => {
    expect(() => indexZip(Buffer.from('definitely not a zip file at all, no EOCD'))).toThrow(/not a zip/);
  });
});

describe('xml + format helpers', () => {
  it('decodes entities incl. numeric', async () => {
    expect(decodeXmlEntities('a &amp; b &lt;c&gt; &#233; &#x1F600; &quot;')).toBe('a & b <c> é 😀 "');
  });

  it('maps column letters', async () => {
    expect(columnLetterToIndex('A')).toBe(1);
    expect(columnLetterToIndex('Z')).toBe(26);
    expect(columnLetterToIndex('AA')).toBe(27);
    expect(columnLetterToIndex('XFD')).toBe(16384);
  });

  it('classifies number formats (built-in and custom)', async () => {
    expect(classifyNumberFormat(0).kind).toBe('general');
    expect(classifyNumberFormat(14).kind).toBe('date');
    expect(classifyNumberFormat(21).kind).toBe('time');
    expect(classifyNumberFormat(22).kind).toBe('datetime');
    expect(classifyNumberFormat(9)).toEqual({ kind: 'percent', decimals: 0 });
    expect(classifyNumberFormat(164, '[$-409]d-mmm-yy;@').kind).toBe('date');
    expect(classifyNumberFormat(164, 'dd/mm/yyyy hh:mm').kind).toBe('datetime');
    expect(classifyNumberFormat(164, '[h]:mm:ss').kind).toBe('time');
    expect(classifyNumberFormat(164, 'h:mm AM/PM').kind).toBe('time');
    expect(classifyNumberFormat(164, '0.00%')).toEqual({ kind: 'percent', decimals: 2 });
    // Literal text / colors must NOT read as date letters.
    expect(classifyNumberFormat(164, '[Red]#,##0.00').kind).toBe('general');
    expect(classifyNumberFormat(164, '#,##0.00 "USD"').kind).toBe('general');
    expect(classifyNumberFormat(164, '0.00E+00').kind).toBe('general');
    expect(classifyNumberFormat(164, 'General').kind).toBe('general');
    expect(classifyNumberFormat(164, '@').kind).toBe('general');
  });

  it('formats serial dates for both epochs', async () => {
    expect(formatSerialDate(46252, 'date')).toBe('2026-08-18');
    expect(formatSerialDate(46252.395, 'datetime')).toBe('2026-08-18 09:28:48');
    expect(formatSerialDate(0.75, 'time')).toBe('18:00');
    expect(formatSerialDate(60 + 1, 'date')).toBe('1900-03-01');
    expect(formatSerialDate(44790, 'date', true)).toBe('2026-08-18');
  });

  it('formats general numbers like Excel', async () => {
    expect(formatGeneralNumber('0.30000000000000004')).toBe('0.3');
    expect(formatGeneralNumber('1E-05')).toBe('0.00001');
    expect(formatGeneralNumber('1234567.891')).toBe('1234567.891');
    expect(formatGeneralNumber('-42')).toBe('-42');
    expect(formatGeneralNumber('abc')).toBe('abc');
  });
});

describe('parseXlsxBuffer (hand-crafted Excel-style workbook)', () => {
  const files = {
    'xl/workbook.xml': WORKBOOK_TWO_SHEETS,
    'xl/_rels/workbook.xml.rels': RELS_ABSOLUTE,
    'xl/sharedStrings.xml': SHARED,
    'xl/styles.xml': STYLES,
    'xl/worksheets/sheet1.xml': SHEET1,
    'xl/worksheets/sheet2.xml': SHEET2,
  };

  it('lists sheets (decoded names, hidden flag) and parses the first grid', async () => {
    const parsed = await parseXlsxBuffer(workbook(files));
    expect(parsed.format).toBe('xlsx');
    expect(parsed.sheets).toEqual([{ name: 'Ventas & Costos' }, { name: 'Resumen', hidden: true }]);
    expect(parsed.sheetIndex).toBe(0);
    const s = parsed.sheet;
    expect(s.name).toBe('Ventas & Costos');
    // Row 1: shared strings incl. rich text runs joined, entities, phonetic guide dropped.
    expect(s.rows[0]).toEqual(['Producto', 'Rico texto', 'Tom & Jerry <3', '漢字']);
    // Row 2: inline string, number, boolean, error, formula cached value; styled empty cell F2 dropped.
    expect(s.rows[1]).toEqual(['inline', '1234.5', 'TRUE', '#N/A', '2469']);
    // Row 3: dates by built-in id, custom code, datetime, time-only, percent.
    expect(s.rows[2]).toEqual(['2026-08-18', '2026-08-18', '2026-08-18 09:28:48', '18:00', '25.6%']);
    // Row 4 absent → [], row 5 sparse up to H, row 6 absent, row 7 numbers.
    expect(s.rows[3]).toEqual([]);
    expect(s.rows[4]).toEqual(['', '', '', '', '', '', '', 'formula-str']);
    expect(s.rows[5]).toEqual([]);
    expect(s.rows[6]).toEqual(['0.3', '0.00001', '-42']);
    expect(s.rows).toHaveLength(7);
    expect(s.rowCount).toBe(7);
    expect(s.colCount).toBe(8);
    expect(s.truncatedRows).toBe(false);
    expect(s.truncatedCols).toBe(false);
  });

  it('resolves absolute rel targets and hidden sheets by index', async () => {
    const parsed = await parseXlsxBuffer(workbook(files), { sheetIndex: 1 });
    expect(parsed.sheet.name).toBe('Resumen');
    expect(parsed.sheet.hidden).toBe(true);
    expect(parsed.sheet.rows[0]).toEqual(['oculto']);
  });

  it('works on deflated members too', async () => {
    const parsed = await parseXlsxBuffer(workbook(files, true));
    expect(parsed.sheet.rows[0][0]).toBe('Producto');
  });

  it('falls back to sheetN.xml numbering when rels are missing', async () => {
    const { 'xl/_rels/workbook.xml.rels': _rels, ...noRels } = files;
    void _rels;
    const parsed = await parseXlsxBuffer(workbook(noRels), { sheetIndex: 1 });
    expect(parsed.sheet.rows[0]).toEqual(['oculto']);
  });

  it('honors date1904 and namespace-prefixed tags', async () => {
    const wb = `<x:workbook xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><x:workbookPr date1904="1"/><x:sheets><x:sheet name="S" sheetId="1" r:id="rId1"/></x:sheets></x:workbook>`;
    const sheet = `<x:worksheet xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><x:sheetData><x:row r="1"><x:c r="A1" s="1"><x:v>44790</x:v></x:c></x:row></x:sheetData></x:worksheet>`;
    const parsed = await parseXlsxBuffer(workbook({ 'xl/workbook.xml': wb, 'xl/worksheets/sheet1.xml': sheet, 'xl/styles.xml': STYLES }));
    expect(parsed.sheet.rows[0]).toEqual(['2026-08-18']);
  });

  it('caps rows and columns and reports the real extent', async () => {
    const rows: string[] = [];
    for (let r = 1; r <= 1200; r++) {
      rows.push(`<row r="${r}"><c r="A${r}"><v>${r}</v></c><c r="CZ${r}"><v>${r * 2}</v></c></row>`);
    }
    const big = `<worksheet><dimension ref="A1:CZ1200"/><sheetData>${rows.join('')}</sheetData></worksheet>`;
    const parsed = await parseXlsxBuffer(workbook({ 'xl/workbook.xml': WORKBOOK_TWO_SHEETS, 'xl/worksheets/sheet1.xml': big, 'xl/worksheets/sheet2.xml': SHEET2 }), { maxRows: 100, maxCols: 50 });
    expect(parsed.sheet.rows).toHaveLength(100);
    expect(parsed.sheet.rows[99]).toEqual(['100']);            // CZ (col 104) beyond the col cap
    expect(parsed.sheet.rowCount).toBe(1200);
    expect(parsed.sheet.colCount).toBe(104);
    expect(parsed.sheet.truncatedRows).toBe(true);
    expect(parsed.sheet.truncatedCols).toBe(true);
  });

  it('rejects zips that are not workbooks', async () => {
    await expect(parseXlsxBuffer(buildZip({ 'hello.txt': 'x' }))).rejects.toThrow(/xl\/workbook\.xml/);
  });
});

describe('parseXlsxBuffer (real openpyxl fixture)', () => {
  it('reads sample.xlsx: strings, numbers, dates, times, percents, booleans, multi-line', async () => {
    const parsed = await parseXlsxBuffer(fs.readFileSync(FIXTURE));
    expect(parsed.sheets.map((s) => s.name)).toEqual(['Datos', 'Dispersa', 'Oculta', 'Ancha']);
    expect(parsed.sheets[2]).toEqual({ name: 'Oculta', hidden: true });
    const s = parsed.sheet;
    expect(s.rows[0]).toEqual(['Nombre', 'Cantidad', 'Precio', 'Fecha', 'Fecha y hora', 'Hora', 'Porcentaje', 'Activo', 'Nota']);
    expect(s.rows[1]).toEqual(['Ana María', '3', '19.99', '2026-08-18', '2026-08-18 09:30:15', '14:05', '25.6%', 'TRUE', 'café ☕ & <tag>']);
    expect(s.rows[2]).toEqual(['Bob "el grande"', '12', '0.3', '2024-02-29', '2000-01-01 00:00', '00:00', '100%', 'FALSE', 'línea1\nlínea2']);
    expect(s.rows[3]).toEqual(['', '1000000', '1234567.891', '', '', '', '0.00%']);
    // J1 holds a formula without a cached value (openpyxl) → empty, so col
    // extent still reaches J (10) via the cell ref.
    expect(s.colCount).toBe(10);
    expect(s.rowCount).toBe(4);
  });

  it('keeps sparse sheets positionally faithful', async () => {
    const parsed = await parseXlsxBuffer(fs.readFileSync(FIXTURE), { sheetIndex: 1 });
    const s = parsed.sheet;
    expect(s.name).toBe('Dispersa');
    expect(s.rows[0]).toEqual(['esquina']);
    expect(s.rows[2]).toEqual(['', '', '42']);
    expect(s.rows[9]).toEqual(['', '', '', '', 'lejos']);
    expect(s.rows[11]).toEqual(['combinada']);
    expect(s.rowCount).toBe(12);
    expect(s.colCount).toBe(5);
  });

  it('flags wide sheets beyond the column cap', async () => {
    const parsed = await parseXlsxBuffer(fs.readFileSync(FIXTURE), { sheetIndex: 3, maxCols: 100 });
    expect(parsed.sheet.rows[0]).toHaveLength(100);
    expect(parsed.sheet.rows[0][99]).toBe('1100');
    expect(parsed.sheet.colCount).toBe(150);
    expect(parsed.sheet.truncatedCols).toBe(true);
    expect(parsed.sheet.truncatedRows).toBe(false);
  });
});

describe('csv / tsv', () => {
  it('sniffs the delimiter by consistency', async () => {
    expect(sniffDelimiter('a,b,c\n1,2,3\n')).toBe(',');
    expect(sniffDelimiter('a;b;c\n1;2;3\n')).toBe(';');
    expect(sniffDelimiter('a\tb\n1\t2\n')).toBe('\t');
    expect(sniffDelimiter('a|b\n1|2\n')).toBe('|');
    // Semicolons consistent, commas only inside one decimal → ';' wins.
    expect(sniffDelimiter('nombre;precio\nx;1,5\ny;2\n')).toBe(';');
    expect(sniffDelimiter('single column\nvalue\n')).toBe(',');
  });

  it('parses quotes, doubled quotes, embedded newlines and CRLF', async () => {
    const grid = parseDelimited('id,name,note\r\n1,"Smith, John","said ""hi""\r\nand left"\r\n2,Ana,\r\n', ',');
    expect(grid.rows).toEqual([
      ['id', 'name', 'note'],
      ['1', 'Smith, John', 'said "hi"\r\nand left'],
      ['2', 'Ana'],
    ]);
    expect(grid.rowCount).toBe(3);
    expect(grid.colCount).toBe(3);
    expect(grid.truncatedRows).toBe(false);
  });

  it('caps rows/cols and counts the real extent', async () => {
    const lines: string[] = [];
    for (let i = 0; i < 50; i++) lines.push(Array.from({ length: 12 }, (_, c) => `${i}-${c}`).join(','));
    const grid = parseDelimited(lines.join('\n'), ',', { maxRows: 10, maxCols: 5 });
    expect(grid.rows).toHaveLength(10);
    expect(grid.rows[0]).toEqual(['0-0', '0-1', '0-2', '0-3', '0-4']);
    expect(grid.rowCount).toBe(50);
    expect(grid.colCount).toBe(12);
    expect(grid.truncatedRows).toBe(true);
    expect(grid.truncatedCols).toBe(true);
  });

  it('does not count the trailing newline as a record but keeps blank lines', async () => {
    expect(parseDelimited('a,b\n', ',').rowCount).toBe(1);
    expect(parseDelimited('a,b', ',').rowCount).toBe(1);
    expect(parseDelimited('a,b\n\nc,d\n', ',').rows).toEqual([['a', 'b'], [], ['c', 'd']]);
  });
});

describe('readSpreadsheet (disk)', () => {
  it('reads csv with BOM and latin1 fallback, tsv by extension', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-sheet-'));
    try {
      const csv = path.join(dir, 'ventas.csv');
      fs.writeFileSync(csv, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('país;monto\nMéxico;10\n', 'utf8')]));
      const a = await readSpreadsheet(csv);
      expect(a.format).toBe('csv');
      expect(a.delimiter).toBe(';');
      expect(a.sheets).toEqual([{ name: 'ventas' }]);
      expect(a.sheet.rows).toEqual([['país', 'monto'], ['México', '10']]);

      const latin = path.join(dir, 'legacy.csv');
      fs.writeFileSync(latin, Buffer.from('nombre,ciudad\nJos\xe9,Le\xf3n\n', 'latin1'));
      const b = await readSpreadsheet(latin);
      expect(b.sheet.rows[1]).toEqual(['José', 'León']);

      const tsv = path.join(dir, 'data.tsv');
      fs.writeFileSync(tsv, 'a\tb,c\n1\t2,3\n');
      const c = await readSpreadsheet(tsv);
      expect(c.format).toBe('tsv');
      expect(c.sheet.rows).toEqual([['a', 'b,c'], ['1', '2,3']]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reads the xlsx fixture and honors the sheet index', async () => {
    const parsed = await readSpreadsheet(FIXTURE, { sheetIndex: 2 });
    expect(parsed.sheet.name).toBe('Oculta');
    expect(parsed.sheet.rows[0]).toEqual(['secreto']);
  });

  it('refuses non-spreadsheet extensions and BIFF2-4 worksheets with an explanation', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-sheet-'));
    try {
      await expect(readSpreadsheet(path.join(dir, 'x.txt'))).rejects.toThrow(/Not a spreadsheet/);
      const old = path.join(dir, 'excel4.xls');
      // A bare BIFF4 BOF record (0x0409) — no CFB wrapper.
      fs.writeFileSync(old, Buffer.from([0x09, 0x04, 0x06, 0x00, 0x00, 0x04, 0x10, 0x00, 0x00, 0x00]));
      await expect(readSpreadsheet(old)).rejects.toBeInstanceOf(UnsupportedSpreadsheetError);
      await expect(readSpreadsheet(old)).rejects.toThrow(/BIFF2-4/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('opens mislabeled files by CONTENT: an xlsx named .xls, a csv named .xls, an html table named .xls', async () => {
    const xlsx = fs.readFileSync(FIXTURE);
    expect(sniffSpreadsheetBuffer(xlsx)).toBe('xlsx');
    expect((await parseSpreadsheetBuffer(xlsx, '/portal/export.xls')).format).toBe('xlsx');

    const csv = Buffer.from('folio,contraparte,monto\n1,AZTECA,61530.00\n', 'utf8');
    expect(sniffSpreadsheetBuffer(csv)).toBe('delimited');
    const parsedCsv = await parseSpreadsheetBuffer(csv, '/portal/transacciones.xls');
    expect(parsedCsv.format).toBe('csv');
    expect(parsedCsv.sheet.rows[1]).toEqual(['1', 'AZTECA', '61530.00']);

    const html = Buffer.from('<html><body><table><tr><th>Folio</th><th>Monto</th></tr><tr><td>1</td><td>10&nbsp;500,00</td></tr></table></body></html>');
    expect(sniffSpreadsheetBuffer(html)).toBe('html');
    const parsedHtml = await parseSpreadsheetBuffer(html, '/portal/historial.xls');
    expect(parsedHtml.format).toBe('html');
    expect(parsedHtml.sheet.rows).toEqual([['Folio', 'Monto'], ['1', '10 500,00']]);
  });

  it('detects kinds by extension', async () => {
    expect(detectSpreadsheetKind('a.XLSX')).toBe('xlsx');
    expect(detectSpreadsheetKind('a.xlsm')).toBe('xlsx');
    expect(detectSpreadsheetKind('a.csv')).toBe('csv');
    expect(detectSpreadsheetKind('a.tsv')).toBe('tsv');
    expect(detectSpreadsheetKind('a.xls')).toBe('legacy');
    expect(detectSpreadsheetKind('a.ods')).toBe('legacy');
    expect(detectSpreadsheetKind('a.docx')).toBeNull();
  });
});

// ── minimal CFB writer: one "Workbook" stream in regular sectors ─────────────

function buildCfb(streamName: string, stream: Buffer): Buffer {
  const SECTOR = 512;
  const FATSECT = 0xfffffffd, ENDOFCHAIN = 0xfffffffe, FREESECT = 0xffffffff;
  // Force the regular-sector path (mini stream cutoff is 4096).
  const payload = stream.length >= 4096 ? stream : Buffer.concat([stream, Buffer.alloc(4096 - stream.length)]);
  const dataSectors = Math.ceil(payload.length / SECTOR);
  // Sector 0: FAT, sector 1: directory, sectors 2..: stream.
  const header = Buffer.alloc(SECTOR, 0);
  Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]).copy(header, 0);
  header.writeUInt16LE(0x003e, 0x18); // minor version
  header.writeUInt16LE(0x0003, 0x1a); // major version 3
  header.writeUInt16LE(0xfffe, 0x1c); // byte order
  header.writeUInt16LE(9, 0x1e);      // sector shift
  header.writeUInt16LE(6, 0x20);      // mini sector shift
  header.writeUInt32LE(1, 0x2c);      // FAT sectors
  header.writeUInt32LE(1, 0x30);      // first directory sector
  header.writeUInt32LE(4096, 0x38);   // mini stream cutoff
  header.writeUInt32LE(ENDOFCHAIN, 0x3c);
  header.writeUInt32LE(0, 0x40);
  header.writeUInt32LE(ENDOFCHAIN, 0x44);
  header.writeUInt32LE(0, 0x48);
  for (let i = 0; i < 109; i++) header.writeUInt32LE(i === 0 ? 0 : FREESECT, 0x4c + i * 4);

  const fat = Buffer.alloc(SECTOR, 0xff);
  fat.writeUInt32LE(FATSECT, 0);
  fat.writeUInt32LE(ENDOFCHAIN, 4);
  for (let i = 0; i < dataSectors; i++) fat.writeUInt32LE(i === dataSectors - 1 ? ENDOFCHAIN : 2 + i + 1, (2 + i) * 4);

  const dir = Buffer.alloc(SECTOR, 0);
  const entry = (idx: number, name: string, type: number, start: number, size: number, child: number) => {
    const off = idx * 128;
    const nameBuf = Buffer.from(name + '\0', 'utf16le');
    nameBuf.copy(dir, off, 0, Math.min(64, nameBuf.length));
    dir.writeUInt16LE(nameBuf.length, off + 0x40);
    dir[off + 0x42] = type;
    dir[off + 0x43] = 1;
    dir.writeUInt32LE(0xffffffff, off + 0x44);
    dir.writeUInt32LE(0xffffffff, off + 0x48);
    dir.writeUInt32LE(child, off + 0x4c);
    dir.writeUInt32LE(start, off + 0x74);
    dir.writeUInt32LE(size, off + 0x78);
  };
  entry(0, 'Root Entry', 5, ENDOFCHAIN, 0, 1);
  entry(1, streamName, 2, 2, payload.length, 0xffffffff); // ≥ 4096 → regular sectors, not the mini stream
  const data = Buffer.alloc(dataSectors * SECTOR, 0);
  payload.copy(data, 0);
  return Buffer.concat([header, fat, dir, data]);
}

// ── BIFF8 record helpers ─────────────────────────────────────────────────────

const u16 = (n: number) => { const b = Buffer.alloc(2); b.writeUInt16LE(n, 0); return b; };
const u32 = (n: number) => { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0, 0); return b; };
const f64 = (n: number) => { const b = Buffer.alloc(8); b.writeDoubleLE(n, 0); return b; };
const rec = (type: number, ...parts: Buffer[]) => { const d = Buffer.concat(parts); return Buffer.concat([u16(type), u16(d.length), d]); };
/** BIFF8 unicode string, long form: cch(2) + flags(1) + chars. */
const ustr = (text: string, wide = false) => Buffer.concat([u16(text.length), Buffer.from([wide ? 1 : 0]), wide ? Buffer.from(text, 'utf16le') : Buffer.from(text, 'latin1')]);
const ustrShort = (text: string) => Buffer.concat([Buffer.from([text.length, 0]), Buffer.from(text, 'latin1')]);
const cell = (row: number, col: number, xf: number) => Buffer.concat([u16(row), u16(col), u16(xf)]);
const rk = (v: number) => u32(v << 2 | 0x02); // integer RK

function buildBiff8Workbook(): Buffer {
  const XF_GENERAL = 0, XF_DATE = 1, XF_PERCENT = 2;
  // A shared string wide enough to be split by a CONTINUE mid-run.
  const longWide = 'Ñ'.repeat(30) + 'é'.repeat(30); // 60 UTF-16 chars, wide
  const sst = Buffer.concat([u32(4), u32(4),
    ustr('Producto'),
    Buffer.concat([u16(longWide.length), Buffer.from([1]), Buffer.from(longWide.slice(0, 20), 'utf16le')]), // first 20 chars, then CONTINUE
  ]);
  // CONTINUE: flag byte (1 = wide) + remaining 40 chars, then string 3 (rich text) and string 4.
  const cont = Buffer.concat([
    Buffer.from([1]), Buffer.from(longWide.slice(20), 'utf16le'),
    u16(4), Buffer.from([0x08]), u16(1), Buffer.from('Rico', 'latin1'), Buffer.from([0, 0, 0, 0]), // rich: 1 run (4 bytes)
    ustr('漢字', true),
  ]);
  const globals: Buffer[] = [
    rec(0x0809, u16(0x0600), u16(0x0005), u16(0x0dbb), u16(0x07cc), u32(0), u32(0)),
    rec(0x0042, u16(1200)),
    rec(0x0022, u16(0)),
    rec(0x041e, u16(164), ustr('0.0%')),
    rec(0x00e0, u16(0), u16(0), Buffer.alloc(16)),   // xf 0 general
    rec(0x00e0, u16(0), u16(14), Buffer.alloc(16)),  // xf 1 date (built-in 14)
    rec(0x00e0, u16(0), u16(164), Buffer.alloc(16)), // xf 2 custom percent
  ];
  const boundsheetLen = 4 + 4 + 1 + 1 + 2 + 'Datos'.length; // record header + fields + short ustr
  const boundsheet2Len = 4 + 4 + 1 + 1 + 2 + 'Oculta'.length;
  const rest: Buffer[] = [
    rec(0x00fc, sst),
    rec(0x003c, cont),
    rec(0x000a),
  ];
  const globalsLen = globals.reduce((n, b) => n + b.length, 0) + boundsheetLen + boundsheet2Len + rest.reduce((n, b) => n + b.length, 0);
  const sheet1: Buffer[] = [
    rec(0x0809, u16(0x0600), u16(0x0010), u16(0x0dbb), u16(0x07cc), u32(0), u32(0)),
    rec(0x0200, u32(0), u32(4), u16(0), u16(5), u16(0)),   // rows 0..3, cols 0..4 (exact, like Excel writes it)
    rec(0x00fd, cell(0, 0, XF_GENERAL), u32(0)),               // A1 "Producto"
    rec(0x00fd, cell(0, 1, XF_GENERAL), u32(1)),               // B1 long wide string
    rec(0x00fd, cell(0, 2, XF_GENERAL), u32(2)),               // C1 "Rico"
    rec(0x00fd, cell(0, 3, XF_GENERAL), u32(3)),               // D1 漢字
    rec(0x0203, cell(1, 0, XF_GENERAL), f64(1234.5)),           // A2 number
    rec(0x027e, cell(1, 1, XF_GENERAL), rk(-42)),               // B2 RK int
    rec(0x027e, cell(1, 2, XF_GENERAL), u32(0x40590000 | 0x00)),// C2 RK float 100.0 (0x40590000 << 32)
    rec(0x00bd, u16(1), u16(3), u16(XF_GENERAL), rk(7), u16(XF_PERCENT), u32(((25 << 2) | 0x03) >>> 0), u16(4)), // D2=7, E2=25/100 as percent → 25.0%
    rec(0x0205, cell(2, 0, XF_GENERAL), Buffer.from([1, 0])),   // A3 TRUE
    rec(0x0205, cell(2, 1, XF_GENERAL), Buffer.from([0x2a, 1])),// B3 #N/A
    rec(0x0203, cell(2, 2, XF_DATE), f64(46252)),               // C3 date
    rec(0x0006, cell(2, 3, XF_GENERAL), Buffer.from([0, 0, 0, 0, 0, 0, 0xff, 0xff]), u16(0), u32(0), u16(0)), // D3 formula → string
    rec(0x0207, ustr('fx-result')),
    rec(0x0204, cell(3, 0, XF_GENERAL), ustr('inline label')),  // A4 LABEL
    rec(0x000a),
  ];
  const sheet1Len = sheet1.reduce((n, b) => n + b.length, 0);
  const sheet2: Buffer[] = [
    rec(0x0809, u16(0x0600), u16(0x0010), u16(0x0dbb), u16(0x07cc), u32(0), u32(0)),
    rec(0x0204, cell(0, 0, XF_GENERAL), ustr('secreto')),
    rec(0x000a),
  ];
  const boundsheet1 = rec(0x0085, u32(globalsLen), Buffer.from([0, 0]), ustrShort('Datos'));
  const boundsheet2 = rec(0x0085, u32(globalsLen + sheet1Len), Buffer.from([1, 0]), ustrShort('Oculta'));
  expect(boundsheet1.length).toBe(boundsheetLen);
  expect(boundsheet2.length).toBe(boundsheet2Len);
  return Buffer.concat([...globals, boundsheet1, boundsheet2, ...rest, ...sheet1, ...sheet2]);
}

describe('parseXlsBuffer (hand-crafted BIFF8 in a CFB container)', () => {
  it('reads SST across CONTINUE, RK/MULRK/NUMBER, BOOLERR, formula strings, dates and percents, hidden sheets', async () => {
    const buf = buildCfb('Workbook', buildBiff8Workbook());
    expect(sniffSpreadsheetBuffer(buf)).toBe('xls');
    const parsed = parseXlsBuffer(buf, { maxRows: 500, maxCols: 100 });
    expect(parsed.format).toBe('xls');
    expect(parsed.sheets).toEqual([{ name: 'Datos' }, { name: 'Oculta', hidden: true }]);
    const s = parsed.sheet;
    expect(s.rows[0]).toEqual(['Producto', 'Ñ'.repeat(30) + 'é'.repeat(30), 'Rico', '漢字']);
    expect(s.rows[1]).toEqual(['1234.5', '-42', '100', '7', '25.0%']);
    expect(s.rows[2]).toEqual(['TRUE', '#N/A', '2026-08-18', 'fx-result']);
    expect(s.rows[3]).toEqual(['inline label']);
    expect(s.rowCount).toBe(4);
    expect(s.colCount).toBe(5);

    const hidden = parseXlsBuffer(buf, { sheetIndex: 1, maxRows: 500, maxCols: 100 });
    expect(hidden.sheet.name).toBe('Oculta');
    expect(hidden.sheet.hidden).toBe(true);
    expect(hidden.sheet.rows[0]).toEqual(['secreto']);
  });

  it('caps rows/cols and reports the data extent', async () => {
    const buf = buildCfb('Workbook', buildBiff8Workbook());
    const parsed = parseXlsBuffer(buf, { maxRows: 2, maxCols: 3 });
    expect(parsed.sheet.rows).toHaveLength(2);
    expect(parsed.sheet.rows[1]).toEqual(['1234.5', '-42', '100']);
    expect(parsed.sheet.rowCount).toBe(4);
    expect(parsed.sheet.colCount).toBe(5);
    expect(parsed.sheet.truncatedRows).toBe(true);
    expect(parsed.sheet.truncatedCols).toBe(true);
  });

  it('rejects OLE2 files without a Workbook stream', async () => {
    const buf = buildCfb('WordDocument', Buffer.from('not excel'));
    expect(() => parseXlsBuffer(buf, { maxRows: 10, maxCols: 10 })).toThrow(/Workbook stream/);
  });
});

describe('parseXlsBuffer (LibreOffice-written sample.xls fixture)', () => {
  it('matches the xlsx fixture cell for cell', async () => {
    const xls = parseXlsBuffer(fs.readFileSync(FIXTURE_XLS), { maxRows: 500, maxCols: 100 });
    const xlsx = await parseXlsxBuffer(fs.readFileSync(FIXTURE));
    expect(xls.sheets).toEqual(xlsx.sheets);
    // J1 formula: LibreOffice stores the computed value in the .xls (59.97).
    expect(xls.sheet.rows[0].slice(0, 9)).toEqual(xlsx.sheet.rows[0].slice(0, 9));
    expect(xls.sheet.rows[0][9]).toBe('59.97');
    expect(xls.sheet.rows[1]).toEqual(xlsx.sheet.rows[1]);
    expect(xls.sheet.rows[3]).toEqual(xlsx.sheet.rows[3]);
    const wide = parseXlsBuffer(fs.readFileSync(FIXTURE_XLS), { sheetIndex: 3, maxRows: 500, maxCols: 100 });
    expect(wide.sheet.colCount).toBe(150);
    expect(wide.sheet.truncatedCols).toBe(true);
    expect(wide.sheet.rows[2][99]).toBe('3100');
  });
});

describe('parseOdsBuffer (LibreOffice-written sample.ods fixture)', () => {
  it('reads tables, hidden flag, repeated rows/cols, rendered text', async () => {
    const ods = parseOdsBuffer(fs.readFileSync(FIXTURE_ODS));
    expect(ods.format).toBe('ods');
    expect(ods.sheets.map((s) => s.name)).toEqual(['Datos', 'Dispersa', 'Oculta', 'Ancha']);
    expect(ods.sheets[2]).toEqual({ name: 'Oculta', hidden: true });
    expect(ods.sheet.rows[0].slice(0, 9)).toEqual(['Nombre', 'Cantidad', 'Precio', 'Fecha', 'Fecha y hora', 'Hora', 'Porcentaje', 'Activo', 'Nota']);
    expect(ods.sheet.rows[1].slice(0, 4)).toEqual(['Ana María', '3', '19.99', '2026-08-18']);
    expect(ods.sheet.rows[1][6]).toBe('25.6%');
    expect(ods.sheet.rows[1][7]).toBe('TRUE');
    expect(ods.sheet.rows[2][8]).toBe('línea1\nlínea2');
    expect(ods.sheet.rowCount).toBe(4);       // trailing repeated empty rows are NOT counted
    expect(ods.sheet.colCount).toBe(10);

    const sparse = parseOdsBuffer(fs.readFileSync(FIXTURE_ODS), { sheetIndex: 1 });
    expect(sparse.sheet.rows[2]).toEqual(['', '', '42']);
    expect(sparse.sheet.rows[9]).toEqual(['', '', '', '', 'lejos']);
    expect(sparse.sheet.rowCount).toBe(12);

    const wide = parseOdsBuffer(fs.readFileSync(FIXTURE_ODS), { sheetIndex: 3, maxCols: 100 });
    expect(wide.sheet.rows[0]).toHaveLength(100);
    expect(wide.sheet.colCount).toBe(150);
    expect(wide.sheet.truncatedCols).toBe(true);
  });
});

describe('parseHtmlTable', () => {
  it('picks the largest table, handles colspan, br, entities and header cells', async () => {
    const html = `<html><body>
      <table><tr><td>menu</td></tr></table>
      <table class="data">
        <thead><tr><th>Folio</th><th colspan="2">Cuenta</th></tr></thead>
        <tbody>
          <tr><td>1</td><td>A&amp;B<br/>2</td><td>  x  </td></tr>
          <tr><td>2</td><td></td><td>y</td></tr>
        </tbody>
      </table></body></html>`;
    const grid = parseHtmlTable(html);
    expect(grid.rows).toEqual([['Folio', 'Cuenta'], ['1', 'A&B\n2', 'x'], ['2', '', 'y']]);
    expect(grid.rowCount).toBe(3);
    expect(grid.colCount).toBe(3);
  });
});

describe('readSpreadsheet windows (big files)', () => {
  it('reads a delimited file by window: exact rows in the window, tail counted by newlines (approx flag)', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-sheet-'));
    try {
      const big = path.join(dir, 'big.csv');
      // ~3 MB: header + 60k rows, one with a quoted embedded newline near the top.
      const lines: string[] = ['id,name,amount'];
      lines.push('1,"multi\nline",10');
      for (let i = 2; i <= 60_000; i++) lines.push(`${i},row ${i},${i * 1.5}`);
      fs.writeFileSync(big, lines.join('\n') + '\n');
      const parsed = await readSpreadsheet(big, { maxRows: 100 });
      expect(parsed.format).toBe('csv');
      expect(parsed.sheet.rows).toHaveLength(100);
      expect(parsed.sheet.rows[0]).toEqual(['id', 'name', 'amount']);
      expect(parsed.sheet.rows[1]).toEqual(['1', 'multi\nline', '10']);
      expect(parsed.sheet.rows[99]).toEqual(['99', 'row 99', '148.5']);
      // 60,001 records; the tail count is by newlines so it may only overshoot.
      expect(parsed.sheet.rowCount).toBeGreaterThanOrEqual(60_001);
      expect(parsed.sheet.rowCount).toBeLessThanOrEqual(60_002);
      expect(parsed.sheet.truncatedRows).toBe(true);
      expect(parsed.sheet.rowCountApprox).toBe(true);
      // Ask for more than the file has → exact, whole file, no approx flag.
      const all = await readSpreadsheet(big, { maxRows: 20_000 });
      expect(all.sheet.rows.length).toBe(20_000);
      expect(all.sheet.rowCount).toBeGreaterThanOrEqual(60_001);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('streams an xlsx worksheet: the window is exact and the extent comes from <dimension>', async () => {
    const rows: string[] = [];
    for (let r = 1; r <= 3000; r++) rows.push(`<row r="${r}"><c r="A${r}"><v>${r}</v></c><c r="B${r}" t="inlineStr"><is><t>fila ${r}</t></is></c></row>`);
    const big = `<worksheet><dimension ref="A1:B3000"/><sheetData>${rows.join('')}</sheetData></worksheet>`;
    const buf = buildZip({ 'xl/workbook.xml': WORKBOOK_TWO_SHEETS, 'xl/worksheets/sheet1.xml': big, 'xl/worksheets/sheet2.xml': SHEET2 }, { deflate: true });
    const parsed = await parseXlsxBuffer(buf, { maxRows: 50 });
    expect(parsed.sheet.rows).toHaveLength(50);
    expect(parsed.sheet.rows[49]).toEqual(['50', 'fila 50']);
    expect(parsed.sheet.rowCount).toBe(3000);
    expect(parsed.sheet.colCount).toBe(2);
    expect(parsed.sheet.truncatedRows).toBe(true);
    // Without <dimension> (streaming writers) the extent is ESTIMATED from the
    // bytes-per-row seen vs. the member's inflated size — flagged approximate,
    // never a full inflate. Rows here are homogeneous, so it lands close.
    const noDim = buildZip({ 'xl/workbook.xml': WORKBOOK_TWO_SHEETS, 'xl/worksheets/sheet1.xml': big.replace('<dimension ref="A1:B3000"/>', ''), 'xl/worksheets/sheet2.xml': SHEET2 }, { deflate: true });
    const parsed2 = await parseXlsxBuffer(noDim, { maxRows: 50 });
    expect(parsed2.sheet.rows).toHaveLength(50);
    expect(parsed2.sheet.rowCountApprox).toBe(true);
    expect(parsed2.sheet.rowCount).toBeGreaterThan(2000);
    expect(parsed2.sheet.rowCount).toBeLessThan(4000);
    expect(parsed2.sheet.truncatedRows).toBe(true);
    // A window that covers the whole sheet is exact again.
    const parsed3 = await parseXlsxBuffer(noDim, { maxRows: 5000 });
    expect(parsed3.sheet.rowCount).toBe(3000);
    expect(parsed3.sheet.rowCountApprox).toBeUndefined();
  });
});

describe('makeRowCounter', () => {
  it('counts rows once across chunk boundaries and stops after maxRows+1', () => {
    const xml = Buffer.from('<sheetData>' + Array.from({ length: 30 }, (_, i) => `<row r="${i + 1}"><c r="A${i + 1}"><v>${i}</v></c></row>`).join('') + '</sheetData>');
    // Feed in awkward chunk sizes so tags split at every possible offset.
    for (const size of [1, 2, 3, 5, 7, 11, 13, 64]) {
      const enough = makeRowCounter(10);
      let stoppedAt = -1;
      let total = 0;
      for (let off = 0; off < xml.length && stoppedAt === -1; off += size) {
        const chunk = xml.subarray(off, Math.min(xml.length, off + size));
        total += chunk.length;
        if (enough(chunk, total)) stoppedAt = total;
      }
      // Must stop once the 11th <row has opened (never earlier: 10 rows must be
      // complete) — a big chunk may legitimately carry a few more rows.
      const prefix = xml.subarray(0, stoppedAt).toString();
      const opened = (prefix.match(/<row /g) || []).length;
      const closed = prefix.split('</row>').length - 1;
      expect(opened, `chunk ${size}`).toBeGreaterThanOrEqual(11);
      expect(closed, `chunk ${size}`).toBeGreaterThanOrEqual(10);
      if (size <= 13) expect(opened, `chunk ${size}`).toBe(11); // tiny chunks stop exactly there
    }
  });
});
