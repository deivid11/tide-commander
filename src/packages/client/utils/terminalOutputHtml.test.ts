import { describe, expect, it } from 'vitest';
import {
  MAX_RENDER_CHARS,
  renderTerminalLines,
  terminalOutputToHtml,
  terminalOutputToHtmlLines,
} from './terminalOutputHtml';

describe('renderTerminalLines', () => {
  it('splits plain output into lines and drops trailing blank lines', () => {
    expect(renderTerminalLines('a\nb\n\n\n')).toEqual(['a', 'b']);
    expect(renderTerminalLines('')).toEqual([]);
    expect(renderTerminalLines('   \n \n')).toEqual([]);
  });

  it('keeps SGR color runs on the rendered lines', () => {
    const lines = renderTerminalLines('\x1b[32m✓\x1b[39m ok\n\x1b[31m✗\x1b[39m bad');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('\x1b[32m✓');
    expect(lines[1]).toContain('\x1b[31m✗');
  });

  it('resolves \\r progress rewrites into the final frame instead of stacking them', () => {
    const lines = renderTerminalLines('progress 10%\rprogress 50%\rprogress 100%\ndone');
    expect(lines).toEqual(['progress 100%', 'done']);
  });

  it('applies erase-line / cursor sequences and drops non-SGR control sequences', () => {
    // hide cursor, spinner frame, erase line, final text — the `[?25l`/`[2K`
    // must not leak as visible text.
    const lines = renderTerminalLines('\x1b[?25l⠋ working\r\x1b[2Kdone\x1b[?25h\n');
    expect(lines).toEqual(['done']);
  });

  it('trims trailing whitespace left by shorter redraws', () => {
    // "long line" overwritten by "hi" leaves "hi" + remnants in a real
    // terminal; here the remnant is spaces from an erase-to-end sequence.
    const lines = renderTerminalLines('long line\rhi\x1b[K\n');
    expect(lines).toEqual(['hi']);
  });

  it('replays only the tail of oversized outputs and marks the cut', () => {
    const line = 'x'.repeat(99) + '\n';
    const big = line.repeat(Math.ceil((MAX_RENDER_CHARS * 2) / line.length));
    const lines = renderTerminalLines(big);
    expect(lines[0]).toMatch(/KB of earlier output omitted/);
    // The cut lands on a line boundary so the first real line is intact.
    expect(lines[1]).toBe('x'.repeat(99));
    expect(lines.length).toBeLessThanOrEqual(MAX_RENDER_CHARS / line.length + 2);
  });
});

describe('terminalOutputToHtml(Lines)', () => {
  it('converts each rendered line to color-preserving, escaped HTML', () => {
    const lines = terminalOutputToHtmlLines('\x1b[33m6548\x1b[39m <tokens>\nplain');
    expect(lines).toEqual([
      '<span style="color:#ebcb8b">6548</span> &lt;tokens&gt;',
      'plain',
    ]);
    expect(terminalOutputToHtml('a\nb')).toBe('a\nb');
  });

  it('handles the "vitest under FORCE_COLOR" shape end to end', () => {
    const raw = ' \x1b[32m✓\x1b[39m src/x.test.ts \x1b[2m(3 tests)\x1b[22m \x1b[33m41ms\x1b[39m\n'
      + '\x1b[1m\x1b[32m Test Files \x1b[39m\x1b[22m \x1b[1m\x1b[32m1 passed\x1b[39m\x1b[22m\x1b[90m (1)\x1b[39m\n';
    const html = terminalOutputToHtml(raw);
    expect(html).toContain('<span style="color:#a3be8c">✓</span>');
    expect(html).toContain('<span style="color:#ebcb8b">41ms</span>');
    expect(html).toContain('<span style="color:#a3be8c;font-weight:bold">1 passed</span>');
    expect(html).not.toContain('\x1b');
    expect(html).not.toMatch(/\[\d+m/);
  });
});
