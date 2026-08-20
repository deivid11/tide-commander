/**
 * Document viewer — extension tables + wire types shared by the server parser
 * (services/document-parse.ts), the /api/files/document route and the client
 * DocumentViewer. Single source of truth for "what opens as a document" so the
 * file viewer, the guake git panel and the API never disagree.
 */

/** OOXML word processing documents (zip + XML) — full fidelity reader. */
export const DOCX_EXTENSIONS = ['.docx', '.docm'] as const;
/** OpenDocument text (zip + content.xml). */
export const ODT_EXTENSIONS = ['.odt', '.fodt'] as const;
/** Legacy binary Word (OLE2 + FIB + piece table) — text and structure only. */
export const DOC_EXTENSIONS = ['.doc'] as const;
/** Rich Text Format (plain text markup). */
export const RTF_EXTENSIONS = ['.rtf'] as const;

/** Everything the /api/files/document endpoint accepts and the viewers route
 * through the BINARY path (never read as text). */
export const DOCUMENT_EXTENSIONS: readonly string[] = [
  ...DOCX_EXTENSIONS,
  ...ODT_EXTENSIONS,
  ...DOC_EXTENSIONS,
  ...RTF_EXTENSIONS,
];

export type DocumentFormat = 'docx' | 'odt' | 'doc' | 'rtf';

/** Inline formatting of a run. Absent flags are false — keeps payloads small. */
export interface DocRun {
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  /** Monospace font (Consolas, Courier, Menlo…) — rendered as code. */
  mono?: boolean;
  superscript?: boolean;
  subscript?: boolean;
  /** #rrggbb text color, when the document sets one that isn't the default. */
  color?: string;
  /** #rrggbb highlight / shading behind the text. */
  highlight?: string;
  /** Hyperlink target (absolute URL, mailto:, or `#anchor`). */
  href?: string;
  /** Footnote/endnote marker — the number shown as a superscript reference. */
  footnoteRef?: number;
}

export interface DocImage {
  /** Zip entry of the embedded image, passed back to /api/files/document-media. */
  entry: string;
  /** Rendered width/height in CSS pixels (from EMUs), when the document says. */
  width?: number;
  height?: number;
  /** alt / title text. */
  alt?: string;
}

export type DocListKind = 'bullet' | 'ordered';

export interface DocParagraph {
  type: 'paragraph';
  /** 1-6 for headings, 0/absent for body text. */
  heading?: number;
  /** Style name as authored (Title, Subtitle, Quote, Code…). */
  styleName?: string;
  align?: 'left' | 'center' | 'right' | 'justify';
  /** List membership: kind + 0-based indent level. */
  list?: { kind: DocListKind; level: number; /** Rendered marker for ordered lists (1., a., i.…) */ marker?: string };
  /** Indentation level for plain (non-list) indented paragraphs. */
  indent?: number;
  runs: DocRun[];
  images?: DocImage[];
  /** Paragraph is a page break on its own. */
  pageBreak?: boolean;
}

export interface DocTableCell {
  blocks: DocBlock[];
  colSpan?: number;
  rowSpan?: number;
  /** Header cell (repeat-header row or bold-only row). */
  header?: boolean;
  /** #rrggbb cell shading. */
  background?: string;
}

export interface DocTable {
  type: 'table';
  rows: DocTableCell[][];
  /** Column count after spans (max of row widths). */
  colCount: number;
  truncated?: boolean;
}

export type DocBlock = DocParagraph | DocTable;

export interface DocFootnote {
  id: number;
  blocks: DocBlock[];
}

export interface DocumentResponse {
  path: string;
  filename: string;
  extension: string;
  size: number;
  modified: string | Date;
  format: DocumentFormat;
  /** Core properties when the container carries them. */
  title?: string;
  author?: string;
  /** Body blocks, capped (`truncated` says whether more exist). */
  blocks: DocBlock[];
  footnotes?: DocFootnote[];
  /** Page header/footer text of the first section, when present. */
  header?: string;
  footer?: string;
  wordCount: number;
  /** Total blocks in the document (before the cap). */
  blockCount: number;
  truncated: boolean;
  maxBlocks: number;
  /** Set when the format only yields plain text (legacy .doc, odd .rtf). */
  plainTextOnly?: boolean;
}
