/**
 * Pure content shaping for the Ctrl+hover tool preview popup.
 *
 * Kept free of React/Prism/DOM imports so it stays unit-testable under vitest's
 * node environment (importing anything that reaches the store barrel would drag
 * in `window` and kill collection).
 *
 * Everything here answers the same question: given a potentially huge blob
 * (a whole file, a 3k-line build log, a diff of a 500-line replacement), what
 * are the ~25 lines worth showing in a tooltip?
 */

import { computeDiffOps } from '../diffLineOps';

/** Hard cap per rendered line — one 40k-char minified line must not blow up the popup. */
export const MAX_PREVIEW_LINE_CHARS = 400;

export type EditPreviewRow =
  | { type: 'equal' | 'add' | 'del'; text: string }
  | { type: 'gap'; skipped: number };

export interface EditPreview {
  rows: EditPreviewRow[];
  added: number;
  removed: number;
  /** Rows were dropped to satisfy `maxRows` — the popup shows a "…" footer. */
  truncated: boolean;
}

export interface FilePreviewLine {
  /** 1-based line number in the source file. */
  n: number;
  text: string;
}

/** Trim a single line so one pathological line can't stretch the popup. */
export function clampLine(text: string): string {
  return text.length > MAX_PREVIEW_LINE_CHARS
    ? `${text.slice(0, MAX_PREVIEW_LINE_CHARS)}…`
    : text;
}

/**
 * Split into lines, dropping the phantom trailing entry a final newline creates.
 * Empty input is zero lines, not one blank one — otherwise an empty file
 * previews as a stray blank row instead of the "(empty file)" notice, and an
 * Edit that only inserts text reports a bogus removed line.
 */
function toLines(text: string): string[] {
  if (!text) return [];
  const lines = text.split('\n');
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

/**
 * Collapse long unchanged runs down to `context` lines on each side, so a
 * one-line edit inside a 200-line snippet previews as a handful of rows.
 */
function collapseEqualRuns(rows: EditPreviewRow[], context: number): EditPreviewRow[] {
  const out: EditPreviewRow[] = [];
  let i = 0;

  while (i < rows.length) {
    if (rows[i].type !== 'equal') {
      out.push(rows[i]);
      i++;
      continue;
    }

    let end = i;
    while (end < rows.length && rows[end].type === 'equal') end++;
    const run = rows.slice(i, end);

    // Leading/trailing runs only need context on the side facing a change.
    const keepHead = i === 0 ? 0 : context;
    const keepTail = end === rows.length ? 0 : context;

    if (run.length <= keepHead + keepTail) {
      out.push(...run);
    } else {
      out.push(...run.slice(0, keepHead));
      out.push({ type: 'gap', skipped: run.length - keepHead - keepTail });
      if (keepTail > 0) out.push(...run.slice(run.length - keepTail));
    }
    i = end;
  }

  return out;
}

function capRows(rows: EditPreviewRow[], maxRows: number): { rows: EditPreviewRow[]; truncated: boolean } {
  if (rows.length <= maxRows) return { rows, truncated: false };
  return { rows: rows.slice(0, maxRows), truncated: true };
}

/**
 * Mini diff for an `Edit` tool row, built from the tool's own old/new strings.
 * These are *snippets*, not whole files, so rows carry no line numbers — only
 * +/- markers, which is all the tooltip needs.
 */
export function buildEditPreview(
  oldString: string,
  newString: string,
  opts: { context?: number; maxRows?: number } = {},
): EditPreview {
  const context = opts.context ?? 2;
  const maxRows = opts.maxRows ?? 22;

  const oldLines = toLines(oldString ?? '');
  const newLines = toLines(newString ?? '');
  const ops = computeDiffOps(oldLines, newLines);

  let added = 0;
  let removed = 0;
  const rows: EditPreviewRow[] = ops.map((op) => {
    if (op.type === 'equal') return { type: 'equal' as const, text: clampLine(oldLines[op.origIdx!] ?? '') };
    if (op.type === 'delete') {
      removed++;
      return { type: 'del' as const, text: clampLine(oldLines[op.origIdx!] ?? '') };
    }
    added++;
    return { type: 'add' as const, text: clampLine(newLines[op.modIdx!] ?? '') };
  });

  const capped = capRows(collapseEqualRuns(rows, context), maxRows);
  return { rows: capped.rows, added, removed, truncated: capped.truncated };
}

/**
 * Mini diff from a pre-computed unified diff (Codex/OpenCode send `unified_diff`
 * instead of old/new strings). Hunk headers become gap rows.
 */
export function parseUnifiedDiffPreview(
  unifiedDiff: string,
  opts: { maxRows?: number } = {},
): EditPreview {
  const maxRows = opts.maxRows ?? 22;
  const rows: EditPreviewRow[] = [];
  let added = 0;
  let removed = 0;
  let seenHunk = false;

  for (const raw of toLines(unifiedDiff ?? '')) {
    if (raw.startsWith('diff ') || raw.startsWith('index ') || raw.startsWith('--- ') || raw.startsWith('+++ ')) continue;
    if (raw.startsWith('\\')) continue; // "\ No newline at end of file"
    if (raw.startsWith('@@')) {
      // Only mark a gap *between* hunks; a leading header adds no information.
      if (seenHunk) rows.push({ type: 'gap', skipped: 0 });
      seenHunk = true;
      continue;
    }
    if (raw.startsWith('+')) {
      added++;
      rows.push({ type: 'add', text: clampLine(raw.slice(1)) });
    } else if (raw.startsWith('-')) {
      removed++;
      rows.push({ type: 'del', text: clampLine(raw.slice(1)) });
    } else {
      rows.push({ type: 'equal', text: clampLine(raw.startsWith(' ') ? raw.slice(1) : raw) });
    }
  }

  const capped = capRows(rows, maxRows);
  return { rows: capped.rows, added, removed, truncated: capped.truncated };
}

/**
 * Head + tail of a command's captured output. Build logs bury the interesting
 * part (the failure, the summary) at the end, so keep both ends rather than a
 * plain `slice(0, n)`.
 */
export function buildBashPreviewLines(
  output: string,
  maxLines = 20,
): { lines: string[]; skipped: number; tailStart: number } {
  const lines = toLines(output ?? '').map(clampLine);
  if (lines.length <= maxLines) return { lines, skipped: 0, tailStart: lines.length };

  const head = Math.max(1, Math.ceil(maxLines * 0.4));
  const tail = maxLines - head;
  return {
    lines: [...lines.slice(0, head), ...lines.slice(lines.length - tail)],
    skipped: lines.length - maxLines,
    tailStart: head,
  };
}

/**
 * First `maxLines` of a file (or of the slice the server returned), numbered
 * from `startLine` so a Read with an offset shows the real line numbers.
 */
export function buildFilePreviewLines(
  content: string,
  opts: { maxLines?: number; startLine?: number } = {},
): { lines: FilePreviewLine[]; truncated: boolean } {
  const maxLines = opts.maxLines ?? 24;
  const startLine = opts.startLine ?? 1;
  const all = toLines(content ?? '');
  return {
    lines: all.slice(0, maxLines).map((text, i) => ({ n: startLine + i, text: clampLine(text) })),
    truncated: all.length > maxLines,
  };
}

/**
 * Where to start a file preview. A `Read` with an offset is about *that* region,
 * so back up a couple of lines for context instead of previewing the file head.
 */
export function previewStartLine(highlightRange?: { offset: number; limit: number }): number {
  if (!highlightRange || !Number.isFinite(highlightRange.offset)) return 1;
  return Math.max(1, Math.floor(highlightRange.offset) - 2);
}
