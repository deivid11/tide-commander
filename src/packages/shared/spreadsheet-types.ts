/**
 * Spreadsheet viewer — extension tables + wire types shared by the server
 * parser (services/spreadsheet-parse.ts), the /api/files/spreadsheet route and
 * the client SpreadsheetViewer. Single source of truth for "what opens as a
 * grid" so the file viewer, the guake git panel and the API never disagree.
 */

/** OOXML workbooks the built-in parser reads (zip + XML, no dependencies). */
export const XLSX_EXTENSIONS = ['.xlsx', '.xlsm'] as const;
/** Delimited text — parsed straight from the file (also viewable as text). */
export const DELIMITED_EXTENSIONS = ['.csv', '.tsv'] as const;
/** Legacy binary Excel (BIFF5/8, built-in CFB+BIFF reader) and OpenDocument
 * (zip + content.xml). Both parse natively. */
export const LEGACY_SPREADSHEET_EXTENSIONS = ['.xls', '.ods'] as const;

/** Extensions that take the BINARY route in the file viewers (never read as
 * text): every workbook format, parseable or not. */
export const SPREADSHEET_BINARY_EXTENSIONS: readonly string[] = [
  ...XLSX_EXTENSIONS,
  ...LEGACY_SPREADSHEET_EXTENSIONS,
];

/** Everything the /api/files/spreadsheet endpoint accepts. */
export const SPREADSHEET_EXTENSIONS: readonly string[] = [
  ...XLSX_EXTENSIONS,
  ...DELIMITED_EXTENSIONS,
  ...LEGACY_SPREADSHEET_EXTENSIONS,
];

/** What the file turned out to be (sniffed from CONTENT, the extension is only
 * a hint — bank portals ship CSV/HTML named `.xls`). */
export type SpreadsheetFormat = 'xlsx' | 'xls' | 'ods' | 'csv' | 'tsv' | 'html';

/** Per-sheet metadata (always present for every sheet of a workbook). */
export interface SpreadsheetSheetInfo {
  name: string;
  hidden?: boolean;
}

/** The parsed grid of ONE sheet — the one requested with `?sheet=`. */
export interface SpreadsheetSheetData extends SpreadsheetSheetInfo {
  /** Row-major cells as display strings. Sparse: an empty row is `[]`, and a
   * row's array ends at its last non-empty cell (the client pads). Row i is
   * spreadsheet row i+1. Capped at `maxRows` rows × `maxCols` columns. */
  rows: string[][];
  /** Real extent of the sheet (before capping). */
  rowCount: number;
  colCount: number;
  truncatedRows: boolean;
  truncatedCols: boolean;
}

export interface SpreadsheetResponse {
  path: string;
  filename: string;
  extension: string;
  size: number;
  modified: string | Date;
  format: SpreadsheetFormat;
  /** Delimiter used for csv/tsv (`,` `;` `\t` `|`). */
  delimiter?: string;
  sheets: SpreadsheetSheetInfo[];
  /** Index (into `sheets`) of the sheet whose grid is in `sheet`. */
  sheetIndex: number;
  sheet: SpreadsheetSheetData;
  /** Caps applied to `sheet.rows`. */
  maxRows: number;
  maxCols: number;
}
