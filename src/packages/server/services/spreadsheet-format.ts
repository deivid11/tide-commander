/**
 * Cell VALUE formatting shared by every spreadsheet reader (xlsx, xls, ods):
 * number-format classification (date / time / datetime / percent / general),
 * Excel serial → date text, and "General"-style number text.
 */

// ── number formats / dates ──────────────────────────────────────────────────

/** Built-in numFmtIds that render as dates/times (ECMA-376 §18.8.30 + the
 * common locale ids 27-36 / 50-58 Excel adds for East Asian locales). */
const BUILTIN_DATE_FORMATS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 45, 46, 47, 50, 51, 52, 53, 54, 55, 56, 57, 58]);
const BUILTIN_TIME_ONLY = new Set([18, 19, 20, 21, 45, 46, 47]);
const BUILTIN_DATETIME = new Set([22]);
const BUILTIN_PERCENT: Record<number, number> = { 9: 0, 10: 2 };

export interface NumberFormat {
  kind: 'general' | 'date' | 'time' | 'datetime' | 'percent';
  decimals?: number;
}

/** Strip the parts of a format code that are literal text so date-letter
 * detection only sees format tokens: quoted strings, `[…]` sections (colors,
 * conditions, locale — but NOT elapsed `[h]`/`[mm]`/`[ss]`, which are time),
 * backslash-escaped characters, and `_x` / `*x` padding. */
function formatTokens(code: string): string {
  return code
    .replace(/"[^"]*"/g, '')
    .replace(/\[(?![hms]+\])[^\]]*\]/gi, '')
    .replace(/\\./g, '')
    .replace(/[_*]./g, '')
    .replace(/AM\/PM|A\/P/gi, 'h');
}

export function classifyNumberFormat(numFmtId: number, customCode?: string): NumberFormat {
  if (customCode !== undefined) {
    // Only the first section (positive numbers) decides the display.
    const first = customCode.split(';')[0] ?? customCode;
    if (/general/i.test(first)) return { kind: 'general' };
    const tokens = formatTokens(first);
    if (tokens.includes('%')) {
      const dec = /\.(0+)/.exec(tokens);
      return { kind: 'percent', decimals: dec ? dec[1].length : 0 };
    }
    const hasDate = /[yd]/i.test(tokens);
    const hasTime = /[hs]/i.test(tokens);
    const hasM = /m/i.test(tokens);
    if (hasDate && hasTime) return { kind: 'datetime' };
    if (hasDate) return { kind: 'date' };
    if (hasTime) return { kind: 'time' };
    if (hasM && !/[#0?]/.test(tokens)) return { kind: 'date' };
    return { kind: 'general' };
  }
  if (numFmtId in BUILTIN_PERCENT) return { kind: 'percent', decimals: BUILTIN_PERCENT[numFmtId] };
  if (BUILTIN_DATETIME.has(numFmtId)) return { kind: 'datetime' };
  if (BUILTIN_TIME_ONLY.has(numFmtId)) return { kind: 'time' };
  if (BUILTIN_DATE_FORMATS.has(numFmtId)) return { kind: 'date' };
  return { kind: 'general' };
}

// Serial 0 = 1899-12-30 (this absorbs Excel's phantom 1900-02-29 for serials ≥ 61).
const EPOCH_1900 = Date.UTC(1899, 11, 30);
const EPOCH_1904 = Date.UTC(1904, 0, 1);

function pad2(n: number): string { return n < 10 ? `0${n}` : String(n); }

/** Excel serial → display string, per the format kind. */
export function formatSerialDate(serial: number, kind: 'date' | 'time' | 'datetime', date1904 = false): string {
  const epoch = date1904 ? EPOCH_1904 : EPOCH_1900;
  // Round to the nearest second to hide float noise (0.9999999884 → next second).
  const ms = Math.round(serial * 86_400) * 1000;
  const d = new Date(epoch + ms);
  const datePart = `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
  const secs = d.getUTCSeconds();
  const timePart = `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}${secs ? `:${pad2(secs)}` : ''}`;
  if (kind === 'date') return datePart;
  if (kind === 'time') {
    // Elapsed/plain times keep whole days out of the picture.
    return timePart;
  }
  return `${datePart} ${timePart}`;
}

/** Number text as Excel's General format would show it (15 significant
 * digits, no float noise, no exponent for everyday magnitudes). */
export function formatGeneralNumber(raw: string): string {
  const n = Number(raw);
  if (!Number.isFinite(n)) return raw;
  if (Number.isInteger(n) && Math.abs(n) < 1e15) return String(n);
  const rounded = Number(n.toPrecision(15));
  const s = String(rounded);
  return s;
}

export function formatPercent(raw: string, decimals: number): string {
  const n = Number(raw);
  if (!Number.isFinite(n)) return raw;
  return `${(n * 100).toFixed(decimals)}%`;
}

/** Display text for a numeric cell given its (already classified) format. */
export function formatNumberCell(value: number, fmt: NumberFormat | undefined, date1904: boolean): string {
  if (fmt && fmt.kind !== 'general' && Number.isFinite(value)) {
    if (fmt.kind === 'percent') return formatPercent(String(value), fmt.decimals ?? 0);
    return formatSerialDate(value, fmt.kind, date1904);
  }
  return formatGeneralNumber(String(value));
}

/** Excel error codes (BIFF BOOLERR / FORMULA results) → their display text. */
export const EXCEL_ERROR_CODES: Record<number, string> = {
  0x00: '#NULL!',
  0x07: '#DIV/0!',
  0x0f: '#VALUE!',
  0x17: '#REF!',
  0x1d: '#NAME?',
  0x24: '#NUM!',
  0x2a: '#N/A',
  0x2b: '#GETTING_DATA',
};
