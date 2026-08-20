/**
 * Pure helpers for the DocumentViewer (no DOM, no store) — unit-testable
 * under vitest's node environment.
 */

import type { DocBlock, DocParagraph, DocRun, DocumentResponse } from '../../../shared/document-types';

export type {
  DocBlock, DocImage, DocParagraph, DocRun, DocTable, DocTableCell, DocumentResponse,
} from '../../../shared/document-types';

export interface OutlineEntry {
  /** Index into the block list — the scroll target. */
  index: number;
  level: number;
  text: string;
}

/** Headings, in document order, for the outline sidebar. */
export function buildOutline(blocks: DocBlock[]): OutlineEntry[] {
  const out: OutlineEntry[] = [];
  blocks.forEach((b, index) => {
    if (b.type !== 'paragraph' || !b.heading) return;
    const text = b.runs.map((r) => r.text).join('').trim();
    if (text) out.push({ index, level: b.heading, text });
  });
  return out;
}

/** Plain text of one paragraph (runs joined). */
export function paragraphText(p: DocParagraph): string {
  return p.runs.map((r) => r.text).join('');
}

/** Whole-document plain text — what "Copy text" puts on the clipboard. */
export function blocksToPlainText(blocks: DocBlock[]): string {
  const lines: string[] = [];
  for (const b of blocks) {
    if (b.type === 'paragraph') {
      lines.push(paragraphText(b));
    } else {
      for (const row of b.rows) {
        lines.push(row.map((c) => blocksToPlainText(c.blocks).replace(/\n+/g, ' ').trim()).join('\t'));
      }
      lines.push('');
    }
  }
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function escapeMarkdown(text: string): string {
  return text.replace(/([\\`*_{}[\]()#+\-!])/g, '\\$1');
}

function runToMarkdown(run: DocRun): string {
  let text = escapeMarkdown(run.text);
  if (text === '') return '';
  if (run.mono) text = `\`${run.text}\``;      // code spans keep raw text
  if (run.bold) text = `**${text}**`;
  if (run.italic) text = `*${text}*`;
  if (run.strike) text = `~~${text}~~`;
  if (run.href) text = `[${text}](${run.href})`;
  return text;
}

/** Markdown rendering — the "Copy as Markdown" action and the .md download. */
export function blocksToMarkdown(blocks: DocBlock[]): string {
  const lines: string[] = [];
  for (const b of blocks) {
    if (b.type === 'paragraph') {
      const text = b.runs.map(runToMarkdown).join('').trim();
      if (b.heading) {
        lines.push(`${'#'.repeat(Math.min(6, b.heading))} ${text}`, '');
        continue;
      }
      if (b.list) {
        const indent = '  '.repeat(b.list.level);
        lines.push(`${indent}${b.list.kind === 'ordered' ? '1.' : '-'} ${text}`);
        continue;
      }
      if (b.images?.length && text === '') {
        lines.push(...b.images.map((img) => `![${img.alt ?? 'image'}](${img.entry})`), '');
        continue;
      }
      if (text) lines.push(text, '');
      continue;
    }
    // Table → GFM. The first row is the header when the document says so.
    const rows = b.rows.map((row) => row.map((c) => blocksToPlainText(c.blocks).replace(/\|/g, '\\|').replace(/\n+/g, ' ').trim()));
    if (rows.length === 0) continue;
    const width = Math.max(...rows.map((r) => r.length));
    const pad = (r: string[]) => [...r, ...Array(Math.max(0, width - r.length)).fill('')];
    const headerRow = b.rows[0]?.some((c) => c.header) ? pad(rows[0]) : Array(width).fill('');
    const bodyRows = b.rows[0]?.some((c) => c.header) ? rows.slice(1) : rows;
    lines.push(`| ${headerRow.join(' | ')} |`);
    lines.push(`| ${Array(width).fill('---').join(' | ')} |`);
    for (const r of bodyRows) lines.push(`| ${pad(r).join(' | ')} |`);
    lines.push('');
  }
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

/** Case-insensitive match count of `query` across the document. */
export function countMatches(blocks: DocBlock[], query: string): number {
  const q = query.trim().toLowerCase();
  if (!q) return 0;
  let n = 0;
  const scan = (list: DocBlock[]) => {
    for (const b of list) {
      if (b.type === 'paragraph') {
        const hay = paragraphText(b).toLowerCase();
        let from = 0;
        for (;;) {
          const at = hay.indexOf(q, from);
          if (at === -1) break;
          n++;
          from = at + q.length;
        }
      } else {
        for (const row of b.rows) for (const c of row) scan(c.blocks);
      }
    }
  };
  scan(blocks);
  return n;
}

/** Block indices that contain `query` — the jump targets of the search box. */
export function findMatchingBlocks(blocks: DocBlock[], query: string): number[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const hits: number[] = [];
  blocks.forEach((b, i) => {
    const text = b.type === 'paragraph' ? paragraphText(b) : blocksToPlainText([b]);
    if (text.toLowerCase().includes(q)) hits.push(i);
  });
  return hits;
}

/** Split a string into alternating non-match / match segments for highlighting. */
export function splitHighlight(text: string, query: string): Array<{ text: string; match: boolean }> {
  const q = query.trim().toLowerCase();
  if (!q) return [{ text, match: false }];
  const out: Array<{ text: string; match: boolean }> = [];
  const hay = text.toLowerCase();
  let from = 0;
  for (;;) {
    const at = hay.indexOf(q, from);
    if (at === -1) break;
    if (at > from) out.push({ text: text.slice(from, at), match: false });
    out.push({ text: text.slice(at, at + q.length), match: true });
    from = at + q.length;
  }
  if (from < text.length) out.push({ text: text.slice(from), match: false });
  return out.length > 0 ? out : [{ text, match: false }];
}

/** `1,234 words · 12 pages`-style summary bits for the header. */
export function formatDocSummary(data: Pick<DocumentResponse, 'wordCount' | 'blockCount'>): string {
  return `${data.wordCount.toLocaleString()} · ${data.blockCount.toLocaleString()}`;
}

/** Group consecutive list paragraphs so the renderer can emit real <ul>/<ol>. */
export interface RenderGroup {
  kind: 'block' | 'list';
  /** For `block`: the single block. For `list`: the consecutive list items. */
  blocks: Array<{ block: DocBlock; index: number }>;
  listKind?: 'bullet' | 'ordered';
  level?: number;
}

export function groupBlocks(blocks: DocBlock[]): RenderGroup[] {
  const groups: RenderGroup[] = [];
  let current: RenderGroup | null = null;
  blocks.forEach((block, index) => {
    const list = block.type === 'paragraph' ? block.list : undefined;
    if (list) {
      if (current && current.kind === 'list' && current.listKind === list.kind && current.level === list.level) {
        current.blocks.push({ block, index });
        return;
      }
      current = { kind: 'list', blocks: [{ block, index }], listKind: list.kind, level: list.level };
      groups.push(current);
      return;
    }
    current = null;
    groups.push({ kind: 'block', blocks: [{ block, index }] });
  });
  return groups;
}
