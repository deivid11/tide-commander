import { describe, expect, it } from 'vitest';
import { TerminalRenderer } from './terminal-render.js';

function render(...chunks: string[]): string {
  const r = new TerminalRenderer();
  for (const chunk of chunks) r.write(chunk);
  return r.getText();
}

describe('TerminalRenderer', () => {
  it('renders plain text and PTY-style CRLF newlines', () => {
    expect(render('hello\r\nworld\r\n')).toBe('hello\nworld');
    expect(render('a\nb\nc')).toBe('a\nb\nc');
  });

  it('collapses \\r progress rewrites to the final state', () => {
    expect(render('progress 1\rprogress 2\rprogress 3\n')).toBe('progress 3');
    // A shorter rewrite overwrites only what it covers (real terminal behavior)
    expect(render('abcdef\rxy')).toBe('xycdef');
    // …unless the CLI erases the line, as they do in practice
    expect(render('abcdef\r\x1b[Kxy')).toBe('xy');
  });

  it('handles cursor-up redraws (vitest/npm live areas)', () => {
    const r = new TerminalRenderer();
    r.write('Tests 0 passed\nDuration 1s\n');
    // Live-area redraw: two lines up, rewrite both
    r.write('\x1b[2A\rTests 1 passed\x1b[K\n\rDuration 2s\x1b[K\n');
    expect(r.getText()).toBe('Tests 1 passed\nDuration 2s');
  });

  it('strips colors and other styling in getText', () => {
    expect(render('\x1b[32m✓\x1b[39m \x1b[1mok\x1b[22m')).toBe('✓ ok');
  });

  it('preserves colors in getLines for the ANSI-aware card', () => {
    const r = new TerminalRenderer();
    r.write('\x1b[32mok\x1b[0m plain');
    expect(r.getLines()[0]).toBe('\x1b[32mok\x1b[0m plain');
    // Plain text stays color-free for the agent response
    expect(r.getText()).toBe('ok plain');
  });

  it('keeps surviving cell colors across partial overwrites', () => {
    const r = new TerminalRenderer();
    r.write('\x1b[31mabc\x1b[0m\n');
    r.write('\x1b[1A\rX');
    expect(r.getLines()[0]).toBe('X\x1b[31mbc\x1b[0m');
  });

  it('consumes the cursor-visibility and sync-output sequences vitest emits at teardown', () => {
    // Real byte tail of a vitest PTY run: show-cursor, col-1, erase, spinner
    // char, col-1, erase — must render to nothing, not leak "[?25h[1G[0K".
    expect(render('done\r\n\r\n\x1b[?25h\x1b[1G\x1b[0K⠙\x1b[1G\x1b[0K')).toBe('done');
    expect(render('Duration 4.91s\r\n\x1b[?2026l')).toBe('Duration 4.91s');
  });

  it('survives escape sequences split across chunks', () => {
    expect(render('\x1b[', '32mhi\x1b[0m')).toBe('hi');
    expect(render('a\x1b', ']0;title\x07b')).toBe('ab');
  });

  it('ignores OSC titles and bells', () => {
    expect(render('\x1b]0;my title\x07hello\x07')).toBe('hello');
  });

  it('clears the screen on ESC[2J', () => {
    expect(render('old content\x1b[2Jnew')).toBe('new');
  });

  it('erase-line variants', () => {
    expect(render('abcdef\r\x1b[2Kxy')).toBe('xy');
    // 1K erases from start THROUGH the cursor, keeping the rest
    expect(render('abcdef\x1b[3G\x1b[1K')).toBe('   def');
  });

  it('collapses trailing blank lines in getText', () => {
    expect(render('done\n\n\n')).toBe('done');
  });

  it('tabs advance to 8-column stops', () => {
    expect(render('ab\tx')).toBe('ab      x');
  });
});
