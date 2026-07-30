import { describe, it, expect } from 'vitest';
import {
  buildBashPreviewLines,
  buildEditPreview,
  buildFilePreviewLines,
  clampLine,
  MAX_PREVIEW_LINE_CHARS,
  parseUnifiedDiffPreview,
  previewStartLine,
} from '../toolPreviewContent';

describe('clampLine', () => {
  it('leaves short lines alone', () => {
    expect(clampLine('const a = 1;')).toBe('const a = 1;');
  });

  it('truncates a minified monster so it cannot stretch the popup', () => {
    const long = 'x'.repeat(MAX_PREVIEW_LINE_CHARS + 500);
    const out = clampLine(long);
    expect(out).toHaveLength(MAX_PREVIEW_LINE_CHARS + 1);
    expect(out.endsWith('…')).toBe(true);
  });
});

describe('buildEditPreview', () => {
  it('counts added and removed lines', () => {
    const preview = buildEditPreview('a\nb\nc\n', 'a\nB\nc\nd\n');
    expect(preview.added).toBe(2); // 'B' and 'd'
    expect(preview.removed).toBe(1); // 'b'
  });

  it('collapses long unchanged runs into a gap row', () => {
    const common = Array.from({ length: 30 }, (_, i) => `line${i}`);
    const preview = buildEditPreview(
      [...common, 'old'].join('\n'),
      [...common, 'new'].join('\n'),
    );
    const gaps = preview.rows.filter((r) => r.type === 'gap');
    expect(gaps).toHaveLength(1);
    expect(gaps[0]).toMatchObject({ type: 'gap', skipped: 28 });
    // 2 context lines survive on the side facing the change.
    expect(preview.rows.filter((r) => r.type === 'equal')).toHaveLength(2);
  });

  it('keeps no context on the far side of leading/trailing runs', () => {
    const preview = buildEditPreview('a\nb\nc\nd\ne\nf', 'CHANGED\nb\nc\nd\ne\nf');
    // The trailing equal run faces the change on its head side only.
    expect(preview.rows[0]).toEqual({ type: 'del', text: 'a' });
    expect(preview.rows[1]).toEqual({ type: 'add', text: 'CHANGED' });
    expect(preview.rows.at(-1)).toMatchObject({ type: 'gap' });
  });

  it('flags truncation past maxRows instead of returning a wall of text', () => {
    const oldText = Array.from({ length: 100 }, (_, i) => `a${i}`).join('\n');
    const newText = Array.from({ length: 100 }, (_, i) => `b${i}`).join('\n');
    const preview = buildEditPreview(oldText, newText, { maxRows: 10 });
    expect(preview.rows).toHaveLength(10);
    expect(preview.truncated).toBe(true);
    // Counts describe the whole edit, not just the visible slice.
    expect(preview.added).toBe(100);
    expect(preview.removed).toBe(100);
  });

  it('handles a pure insertion (empty oldString)', () => {
    const preview = buildEditPreview('', 'new line\n');
    expect(preview.removed).toBe(0);
    expect(preview.added).toBe(1);
    expect(preview.rows).toEqual([{ type: 'add', text: 'new line' }]);
  });
});

describe('parseUnifiedDiffPreview', () => {
  const diff = [
    'diff --git a/foo.ts b/foo.ts',
    'index 1234567..89abcde 100644',
    '--- a/foo.ts',
    '+++ b/foo.ts',
    '@@ -1,3 +1,3 @@',
    ' context',
    '-removed',
    '+added',
    '\\ No newline at end of file',
  ].join('\n');

  it('drops file headers and keeps +/- rows', () => {
    const preview = parseUnifiedDiffPreview(diff);
    expect(preview.added).toBe(1);
    expect(preview.removed).toBe(1);
    expect(preview.rows).toEqual([
      { type: 'equal', text: 'context' },
      { type: 'del', text: 'removed' },
      { type: 'add', text: 'added' },
    ]);
  });

  it('marks a gap between hunks but not before the first one', () => {
    const twoHunks = '@@ -1 +1 @@\n+a\n@@ -9 +9 @@\n+b';
    const rows = parseUnifiedDiffPreview(twoHunks).rows;
    expect(rows.filter((r) => r.type === 'gap')).toHaveLength(1);
    expect(rows[0]).toEqual({ type: 'add', text: 'a' });
  });
});

describe('buildBashPreviewLines', () => {
  it('returns everything when the output fits', () => {
    const { lines, skipped } = buildBashPreviewLines('one\ntwo\nthree', 10);
    expect(lines).toEqual(['one', 'two', 'three']);
    expect(skipped).toBe(0);
  });

  it('keeps head AND tail of a long log — the failure is usually at the end', () => {
    const output = Array.from({ length: 100 }, (_, i) => `line${i}`).join('\n');
    const { lines, skipped, tailStart } = buildBashPreviewLines(output, 10);
    expect(lines).toHaveLength(10);
    expect(skipped).toBe(90);
    expect(lines[0]).toBe('line0');
    expect(lines.at(-1)).toBe('line99');
    expect(lines[tailStart]).toBe('line94');
  });

  it('treats empty output as no lines', () => {
    expect(buildBashPreviewLines('').lines).toEqual([]);
  });
});

describe('buildFilePreviewLines', () => {
  it('numbers lines from the requested start offset', () => {
    const { lines, truncated } = buildFilePreviewLines('a\nb\nc', { maxLines: 5, startLine: 10 });
    expect(lines).toEqual([
      { n: 10, text: 'a' },
      { n: 11, text: 'b' },
      { n: 12, text: 'c' },
    ]);
    expect(truncated).toBe(false);
  });

  it('flags truncation past maxLines', () => {
    const content = Array.from({ length: 50 }, (_, i) => `l${i}`).join('\n');
    const { lines, truncated } = buildFilePreviewLines(content, { maxLines: 3 });
    expect(lines).toHaveLength(3);
    expect(truncated).toBe(true);
  });

  it('ignores the phantom line a trailing newline creates', () => {
    expect(buildFilePreviewLines('a\n').lines).toHaveLength(1);
  });
});

describe('previewStartLine', () => {
  it('defaults to the top of the file', () => {
    expect(previewStartLine()).toBe(1);
  });

  it('backs up two lines of context around a Read offset', () => {
    expect(previewStartLine({ offset: 40, limit: 20 })).toBe(38);
  });

  it('never goes below line 1', () => {
    expect(previewStartLine({ offset: 2, limit: 5 })).toBe(1);
  });
});
