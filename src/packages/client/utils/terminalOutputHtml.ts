/**
 * Raw command output (Bash tool results, exec streams, log tails) → HTML lines
 * that keep the command's original colors — and give color to output that
 * never had any.
 *
 * Bash tool results reach the client with their ANSI escapes intact (Claude's
 * Bash tool never strips them, and `FORCE_COLOR` in the agent env makes
 * node/chalk tools colorize even without a TTY). Rendering that text verbatim
 * shows `[33m6548[39m` garbage; running it through `ansiToHtml` alone still
 * leaks non-SGR control sequences (`[?25l`, `[2K`) and stacks every `\r`
 * progress redraw. So the text is first replayed through the shared
 * TerminalRenderer — "what the screen would show" — and each resulting line
 * is converted to inline-styled HTML.
 *
 * Lines that carry SGR keep the tool's own colors (`ansiToHtml`). Lines that
 * carry none (git, ls, grep, cat, curl bodies… — everything that only
 * colorizes on a TTY) go through the semantic highlighter instead, so diffs,
 * `git status`, log levels, paths, numbers and hashes still read like a real
 * terminal would show them.
 */

import { TerminalRenderer } from '../../shared/terminal-render';
import { ansiToHtml } from './ansiToHtml';
import { analyzeShellOutput, highlightShellLine, isSegmentBoundary, structuralHtml, wrapCode, type ShellHighlightContext } from './shellOutputHighlight';
import { highlightCodeHtml, splitHighlightedHtml } from './codeHighlight';

const SGR_RE = /\x1b\[[0-9;]*m/g;
const HAS_SGR_RE = /\x1b\[[0-9;]*m/;
// Trailing whitespace that sits before a run of closing SGR sequences (or the
// end of the line) — redraw leftovers padded by the renderer.
const TRAILING_WS_RE = /[ \t]+((?:\x1b\[[0-9;]*m)*)$/;
// Replay budget per render. Bash tool results are forwarded untruncated (the
// backend prefers `tool_use_result.stdout`), so a stray `cat big.log` can be
// megabytes; only the tail is replayed and a dim marker notes the cut. The
// terminal renderer keeps at most 10k lines anyway.
export const MAX_RENDER_CHARS = 512_000;

// Per-line memo: streaming exec cards re-render their whole visible window on
// every chunk, and the same lines come back unchanged each time.
const LINE_CACHE_MAX = 4000;
const lineCache = new Map<string, string>();

const NO_CTX: ShellHighlightContext = { diff: false, format: null, lang: null };

function cacheKey(line: string, ctx: ShellHighlightContext): string {
  return `${ctx.diff ? 'd' : 'p'}|${ctx.format ?? ''}|${ctx.lang ?? ''}|${line}`;
}

/**
 * One rendered line → HTML. ANSI-colored lines keep their colors; plain lines
 * get semantic highlighting.
 */
export function shellLineToHtml(line: string, ctx: ShellHighlightContext = NO_CTX): string {
  if (line.length === 0) return '';
  const key = cacheKey(line, ctx);
  const hit = lineCache.get(key);
  if (hit !== undefined) return hit;
  const html = HAS_SGR_RE.test(line) ? ansiToHtml(line) : highlightShellLine(line, ctx);
  if (line.length <= 2000) {
    if (lineCache.size >= LINE_CACHE_MAX) {
      // Drop the oldest ~quarter (Map preserves insertion order).
      let n = LINE_CACHE_MAX >> 2;
      for (const k of lineCache.keys()) {
        lineCache.delete(k);
        if (--n <= 0) break;
      }
    }
    lineCache.set(key, html);
  }
  return html;
}

/**
 * Split raw terminal output into rendered lines (SGR sequences preserved,
 * trailing blank lines dropped, per-line trailing whitespace trimmed).
 */
export function renderTerminalLines(text: string): string[] {
  const renderer = new TerminalRenderer();
  if (text.length > MAX_RENDER_CHARS) {
    let cut = text.length - MAX_RENDER_CHARS;
    const nl = text.indexOf('\n', cut);
    if (nl !== -1 && nl - cut < 4096) cut = nl + 1;
    const omittedKb = Math.round(cut / 1024);
    renderer.write(`\x1b[2m[… ${omittedKb} KB of earlier output omitted]\x1b[0m\n`);
    renderer.write(text.slice(cut));
  } else {
    renderer.write(text);
  }
  const lines = renderer.getLines();
  let end = lines.length;
  while (end > 0 && lines[end - 1].replace(SGR_RE, '').trim() === '') end -= 1;
  return lines.slice(0, end).map((line) => line.replace(TRAILING_WS_RE, '$1'));
}

/**
 * Rendered lines converted to HTML strings (one per line, safe to inject).
 *
 * Multi-command outputs (`cat a.tsx; echo "=== scss ==="; sed -n … b.scss`)
 * are split at section markers / separators and each segment is analysed on
 * its own, so a TSX dump followed by an SCSS dump each get the right grammar
 * and a `git status` before a `git diff` does not inherit diff context.
 */
export function terminalOutputToHtmlLines(text: string): string[] {
  return renderedLinesToHtml(renderTerminalLines(text));
}

/** Same as terminalOutputToHtmlLines for lines that were already rendered (exec cards). */
export function renderedLinesToHtml(lines: string[]): string[] {
  const out: string[] = new Array(lines.length);
  let start = 0;
  for (let i = 0; i <= lines.length; i += 1) {
    const boundary = i === lines.length || isSegmentBoundary(lines[i]);
    if (!boundary) continue;
    if (i > start) renderSegment(lines, start, i, out);
    if (i < lines.length) out[i] = shellLineToHtml(lines[i], NO_CTX);
    start = i + 1;
  }
  return out;
}

function renderSegment(lines: string[], start: number, end: number, out: string[]): void {
  const seg = lines.slice(start, end);
  const ctx = analyzeShellOutput(seg);
  if (ctx.format === 'code' && ctx.lang) {
    // A source-file dump: highlight the whole block at once so block
    // comments / template strings that span lines keep their state, then
    // split back into lines. Structural lines (`Exit code`, wc/path lines)
    // keep their semantic rendering.
    const prismLines = splitHighlightedHtml(highlightCodeHtml(seg.join('\n'), ctx.lang));
    for (let i = 0; i < seg.length; i += 1) {
      const line = seg[i];
      out[start + i] = HAS_SGR_RE.test(line)
        ? ansiToHtml(line)
        : (structuralHtml(line, ctx) ?? (prismLines[i] !== undefined ? wrapCode(prismLines[i]) : shellLineToHtml(line, ctx)));
    }
    return;
  }
  for (let i = 0; i < seg.length; i += 1) out[start + i] = shellLineToHtml(seg[i], ctx);
}

/** Whole output as one HTML block (lines joined by `\n`, for a `<pre>`). */
export function terminalOutputToHtml(text: string): string {
  return terminalOutputToHtmlLines(text).join('\n');
}

/**
 * Click delegation for highlighted paths: returns the `data-path` of the
 * `.sh-path` span under the event target, or null.
 */
export function pathFromOutputClick(target: EventTarget | null): string | null {
  const el = target instanceof Element ? target.closest('.sh-path') : null;
  const path = el?.getAttribute('data-path');
  return path && path.length > 0 ? path : null;
}
