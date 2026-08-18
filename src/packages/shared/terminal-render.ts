/**
 * Minimal terminal renderer for PTY output streams.
 *
 * Exec commands run under a pseudo-terminal (so CLIs like vitest/npm/pip emit
 * live progress instead of buffering silently), which means their output
 * carries ANSI control sequences and in-place rewrites (`\r`, cursor-up line
 * redraws, erase-line). This class replays that stream into a line buffer —
 * "what the screen would show" — used on the server to hand agents clean
 * final text and on the client to render exec cards that update in place
 * instead of appending every redraw.
 *
 * Colors: SGR state is tracked per cell. `getLines()` reconstructs lines WITH
 * their color sequences (the client card renders them via ansiToHtml), while
 * `getText()` returns plain text (what agents receive).
 *
 * Scope: the line-oriented sequences interactive CLIs actually use (CR, BS,
 * CSI A/B/C/D/E/F/G/H/J/K/m, reverse-index). Full-screen TUIs (vim, htop)
 * are out of scope — they render best-effort.
 */

const MAX_LINES = 10_000;
// Once the buffer is full, trim in batches instead of one splice per newline
// (a per-line splice made replaying multi-MB streams quadratic: 4 MB ≈ 1.2 s).
const LINE_DROP_SLACK = 1_000;
// Longest escape sequence we buffer across chunk boundaries before giving up.
const MAX_PENDING_SEQ = 64;
// Cap for pathological SGR accumulation (styles with no reset in sight).
const MAX_SGR_STATE = 128;

export class TerminalRenderer {
  private lines: string[] = [''];
  // attrs[row][col] = SGR sequence string active when that cell was written
  // ('' = default). Parallel to `lines` — every structural mutation touches both.
  private attrs: string[][] = [[]];
  private row = 0;
  private col = 0;
  // Currently active SGR state, e.g. "\x1b[1m\x1b[32m" ('' = default).
  private sgr = '';
  // Tail of the previous chunk that ended mid-escape-sequence.
  private pending = '';

  write(chunk: string): void {
    const data = this.pending + chunk;
    this.pending = '';
    const len = data.length;
    let i = 0;
    while (i < len) {
      const ch = data.charCodeAt(i);
      if (ch === 0x1b) {
        const consumed = this.consumeEscape(data, i);
        if (consumed === -1) {
          // Sequence continues in the next chunk — stash and wait, unless it
          // is implausibly long (malformed), in which case drop the ESC.
          if (len - i <= MAX_PENDING_SEQ) {
            this.pending = data.slice(i);
            return;
          }
          i += 1;
          continue;
        }
        i += consumed;
        continue;
      }
      if (ch === 0x0a) { // \n
        this.newline();
        i += 1;
        continue;
      }
      if (ch === 0x0d) { // \r
        this.col = 0;
        i += 1;
        continue;
      }
      if (ch === 0x08) { // backspace
        this.col = Math.max(0, this.col - 1);
        i += 1;
        continue;
      }
      if (ch === 0x09) { // tab → next 8-column stop
        this.col += 8 - (this.col % 8);
        i += 1;
        continue;
      }
      if (ch < 0x20) { // other control chars (BEL, VT, …) — ignore
        i += 1;
        continue;
      }
      // Printable run: consume up to the next control character in one splice.
      let end = i + 1;
      while (end < len) {
        const c = data.charCodeAt(end);
        if (c < 0x20 || c === 0x1b) break;
        end += 1;
      }
      this.writeText(data.slice(i, end));
      i = end;
    }
  }

  /**
   * Rendered lines with their SGR color sequences reconstructed (bounded
   * copy) — ready for an ANSI-aware display layer.
   */
  getLines(): string[] {
    return this.lines.map((_, r) => this.renderLine(r));
  }

  /**
   * Full rendered PLAIN text: colors dropped, per-line trailing whitespace
   * (redraw leftovers) and trailing blank lines collapsed.
   */
  getText(): string {
    let end = this.lines.length;
    while (end > 0 && this.lines[end - 1].trim() === '') end -= 1;
    return this.lines.slice(0, end).map((line) => line.replace(/\s+$/, '')).join('\n');
  }

  /** One line with SGR sequences re-inserted at attribute-change boundaries. */
  private renderLine(r: number): string {
    const line = this.lines[r];
    const attr = this.attrs[r];
    if (!attr || attr.length === 0) return line;
    let out = '';
    let current = '';
    for (let c = 0; c < line.length; c += 1) {
      const cellAttr = attr[c] ?? '';
      if (cellAttr !== current) {
        out += (current ? '\x1b[0m' : '') + cellAttr;
        current = cellAttr;
      }
      out += line[c];
    }
    if (current) out += '\x1b[0m';
    return out;
  }

  private ensureRow(r: number): void {
    while (this.lines.length <= r) {
      this.lines.push('');
      this.attrs.push([]);
    }
  }

  private newline(): void {
    this.row += 1;
    this.col = 0;
    this.ensureRow(this.row);
    if (this.lines.length > MAX_LINES + LINE_DROP_SLACK) {
      const drop = this.lines.length - MAX_LINES;
      this.lines.splice(0, drop);
      this.attrs.splice(0, drop);
      this.row = Math.max(0, this.row - drop);
    }
  }

  private writeText(text: string): void {
    this.ensureRow(this.row);
    let line = this.lines[this.row];
    if (line.length < this.col) line = line.padEnd(this.col, ' ');
    this.lines[this.row] = line.slice(0, this.col) + text + line.slice(this.col + text.length);
    const attr = this.attrs[this.row];
    for (let k = attr.length; k < this.col; k += 1) attr[k] = '';
    for (let k = 0; k < text.length; k += 1) attr[this.col + k] = this.sgr;
    this.col += text.length;
  }

  /**
   * Consume one escape sequence starting at data[i] (an ESC). Returns the
   * number of chars consumed, or -1 when the sequence is incomplete.
   */
  private consumeEscape(data: string, i: number): number {
    if (i + 1 >= data.length) return -1;
    const next = data[i + 1];

    if (next === '[') { // CSI: ESC [ params final-byte(@ … ~)
      let j = i + 2;
      while (j < data.length) {
        const c = data.charCodeAt(j);
        if (c >= 0x40 && c <= 0x7e) {
          this.applyCsi(data.slice(i + 2, j), data[j]);
          return j - i + 1;
        }
        j += 1;
      }
      return -1;
    }

    if (next === ']') { // OSC: ESC ] … (BEL | ESC \)
      let j = i + 2;
      while (j < data.length) {
        if (data.charCodeAt(j) === 0x07) return j - i + 1;
        if (data.charCodeAt(j) === 0x1b && data[j + 1] === '\\') return j - i + 2;
        j += 1;
      }
      return -1;
    }

    if (next === 'M') { // reverse index — cursor up one line
      this.row = Math.max(0, this.row - 1);
      return 2;
    }
    if (next === '(' || next === ')') { // charset designation: ESC ( B
      return i + 2 < data.length ? 3 : -1;
    }
    // Any other two-char sequence (ESC =, ESC >, ESC 7/8, …) — ignore.
    return 2;
  }

  private applyCsi(params: string, final: string): void {
    // First numeric parameter, defaulting to the sequence's standard default.
    const firstParam = (def: number): number => {
      const n = parseInt(params.replace(/^\?/, ''), 10);
      return Number.isFinite(n) && n > 0 ? n : def;
    };
    switch (final) {
      case 'A': // cursor up
        this.row = Math.max(0, this.row - firstParam(1));
        break;
      case 'B': // cursor down
        this.row += firstParam(1);
        this.ensureRow(this.row);
        break;
      case 'C': // forward
        this.col += firstParam(1);
        break;
      case 'D': // back
        this.col = Math.max(0, this.col - firstParam(1));
        break;
      case 'E': // next line
        this.row += firstParam(1);
        this.col = 0;
        this.ensureRow(this.row);
        break;
      case 'F': // previous line
        this.row = Math.max(0, this.row - firstParam(1));
        this.col = 0;
        break;
      case 'G': // absolute column (1-based)
        this.col = Math.max(0, firstParam(1) - 1);
        break;
      case 'H':
      case 'f': { // absolute position (1-based row;col) — clamp into buffer
        const parts = params.split(';');
        const r = parseInt(parts[0], 10);
        const c = parseInt(parts[1] ?? '', 10);
        this.row = Math.min(Math.max(0, (Number.isFinite(r) ? r : 1) - 1), this.lines.length - 1);
        this.col = Math.max(0, (Number.isFinite(c) ? c : 1) - 1);
        break;
      }
      case 'J': { // erase display
        const mode = firstParam(0);
        if (mode >= 2) {
          this.lines = [''];
          this.attrs = [[]];
          this.row = 0;
          this.col = 0;
        } else if (mode === 1) { // above + left of cursor
          for (let r = 0; r < this.row; r += 1) {
            this.lines[r] = '';
            this.attrs[r] = [];
          }
          this.lines[this.row] = ' '.repeat(this.col) + (this.lines[this.row] ?? '').slice(this.col);
          const attr = this.attrs[this.row] ?? [];
          for (let k = 0; k < this.col; k += 1) attr[k] = '';
        } else { // below + right of cursor
          this.lines.length = this.row + 1;
          this.attrs.length = this.row + 1;
          this.lines[this.row] = (this.lines[this.row] ?? '').slice(0, this.col);
          (this.attrs[this.row] ?? []).length = Math.min((this.attrs[this.row] ?? []).length, this.col);
        }
        break;
      }
      case 'K': { // erase line
        const mode = firstParam(0);
        const line = this.lines[this.row] ?? '';
        const attr = this.attrs[this.row] ?? [];
        if (mode === 2) {
          this.lines[this.row] = '';
          this.attrs[this.row] = [];
        } else if (mode === 1) {
          // From start THROUGH the cursor (inclusive), keeping what follows.
          const blank = Math.min(this.col + 1, line.length);
          this.lines[this.row] = ' '.repeat(blank) + line.slice(this.col + 1);
          for (let k = 0; k < blank; k += 1) attr[k] = '';
        } else {
          this.lines[this.row] = line.slice(0, this.col);
          attr.length = Math.min(attr.length, this.col);
        }
        break;
      }
      case 'm': { // SGR — track color/style state for per-cell attribution
        if (params === '' || params === '0') {
          this.sgr = '';
        } else if (params.startsWith('0;')) {
          this.sgr = `\x1b[${params.slice(2)}m`;
        } else if (this.sgr.length < MAX_SGR_STATE) {
          this.sgr += `\x1b[${params}m`;
        }
        break;
      }
      default:
        // Modes (h/l), save/restore (s/u), scroll regions (r), … — screen
        // management, irrelevant to the text content.
        break;
    }
  }
}
