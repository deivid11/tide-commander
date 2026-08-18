/**
 * ANSI escape code to HTML converter
 * Converts terminal color codes to styled spans
 */

// ANSI color codes to CSS color mapping — desaturated terminal-friendly palette
const ANSI_COLORS: Record<number, string> = {
  // Standard colors (30-37)
  30: '#2e3440', // black
  31: '#e88080', // red (lifted lightness for readable error contrast)
  32: '#a3be8c', // green
  33: '#ebcb8b', // yellow
  34: '#81a1c1', // blue
  35: '#b48ead', // magenta
  36: '#88c0d0', // cyan
  37: '#d8dee9', // white (off-white)

  // Bright colors (90-97)
  90: '#4c566a', // bright black (gray)
  91: '#f2a6a6', // bright red (higher luminance for emphasis)
  92: '#b4c99a', // bright green
  93: '#f0d399', // bright yellow
  94: '#9cb9e4', // bright blue
  95: '#c9a6dc', // bright magenta
  96: '#9ad2db', // bright cyan
  97: '#eceff4', // bright white
};

const ANSI_BG_COLORS: Record<number, string> = {
  // Standard background colors (40-47)
  40: '#2e3440',
  41: '#e88080',
  42: '#a3be8c',
  43: '#ebcb8b',
  44: '#81a1c1',
  45: '#b48ead',
  46: '#88c0d0',
  47: '#d8dee9',

  // Bright background colors (100-107)
  100: '#4c566a',
  101: '#f2a6a6',
  102: '#b4c99a',
  103: '#f0d399',
  104: '#9cb9e4',
  105: '#c9a6dc',
  106: '#9ad2db',
  107: '#eceff4',
};

interface TextStyle {
  color?: string;
  bgColor?: string;
  bold?: boolean;
  dim?: boolean;
  italic?: boolean;
  underline?: boolean;
  inverse?: boolean;
  strike?: boolean;
}

// Fallbacks used when `inverse` (SGR 7) swaps fg/bg but the stream never set
// an explicit color — the terminal's default fg/bg pair.
const DEFAULT_FG = '#d8dee9';
const DEFAULT_BG = '#2e3440';

/**
 * xterm 256-color palette → CSS color. 0-15 reuse the desaturated basic
 * palette above (so 256-color output matches the 16-color look), 16-231 is
 * the 6×6×6 cube, 232-255 the 24-step grayscale ramp.
 */
function color256(n: number): string | undefined {
  if (!Number.isInteger(n) || n < 0 || n > 255) return undefined;
  if (n < 8) return ANSI_COLORS[30 + n];
  if (n < 16) return ANSI_COLORS[90 + (n - 8)];
  if (n < 232) {
    const i = n - 16;
    const steps = [0, 95, 135, 175, 215, 255];
    const r = steps[Math.floor(i / 36)];
    const g = steps[Math.floor(i / 6) % 6];
    const b = steps[i % 6];
    return `rgb(${r},${g},${b})`;
  }
  const v = 8 + (n - 232) * 10;
  return `rgb(${v},${v},${v})`;
}

function clampByte(n: number): number {
  return Number.isFinite(n) ? Math.min(255, Math.max(0, Math.round(n))) : 0;
}

function styleToInline(style: TextStyle): string {
  const parts: string[] = [];

  // Inverse video swaps foreground and background. Fall back to the
  // terminal's default pair so `\x1b[7m` alone still reads as highlighted.
  let color = style.color;
  let bgColor = style.bgColor;
  if (style.inverse) {
    color = style.bgColor ?? DEFAULT_BG;
    bgColor = style.color ?? DEFAULT_FG;
  }

  if (color) {
    parts.push(`color:${color}`);
  }
  if (bgColor) {
    parts.push(`background-color:${bgColor}`);
  }
  if (style.bold) {
    parts.push('font-weight:bold');
  }
  if (style.dim) {
    parts.push('opacity:0.6');
  }
  if (style.italic) {
    parts.push('font-style:italic');
  }
  const decorations: string[] = [];
  if (style.underline) decorations.push('underline');
  if (style.strike) decorations.push('line-through');
  if (decorations.length) {
    parts.push(`text-decoration:${decorations.join(' ')}`);
  }

  return parts.join(';');
}

/**
 * Apply one SGR parameter list (already split on `;`) to a style. Handles the
 * multi-parameter forms `38;5;n` / `48;5;n` (256-color) and `38;2;r;g;b` /
 * `48;2;r;g;b` (truecolor) as single units — without this, chalk's truecolor
 * output (`FORCE_COLOR=3`) was being read as "dim + reset" and lost.
 */
function applyCodes(style: TextStyle, codes: number[]): TextStyle {
  let s: TextStyle = { ...style };
  for (let i = 0; i < codes.length; i += 1) {
    const code = codes[i];
    if (code === 38 || code === 48) {
      const mode = codes[i + 1];
      let css: string | undefined;
      let consumed = 0;
      if (mode === 5) {
        css = color256(codes[i + 2]);
        consumed = 2;
      } else if (mode === 2) {
        const r = clampByte(codes[i + 2]);
        const g = clampByte(codes[i + 3]);
        const b = clampByte(codes[i + 4]);
        css = `rgb(${r},${g},${b})`;
        consumed = 4;
      }
      if (css) {
        if (code === 38) s.color = css;
        else s.bgColor = css;
      }
      i += consumed;
      continue;
    }
    s = applyCode(s, code);
  }
  return s;
}

function applyCode(style: TextStyle, code: number): TextStyle {
  const newStyle = { ...style };

  if (code === 0) {
    // Reset
    return {};
  } else if (code === 1) {
    newStyle.bold = true;
  } else if (code === 2) {
    newStyle.dim = true;
  } else if (code === 3) {
    newStyle.italic = true;
  } else if (code === 4) {
    newStyle.underline = true;
  } else if (code === 7) {
    newStyle.inverse = true;
  } else if (code === 9) {
    newStyle.strike = true;
  } else if (code === 22) {
    newStyle.bold = false;
    newStyle.dim = false;
  } else if (code === 23) {
    newStyle.italic = false;
  } else if (code === 24) {
    newStyle.underline = false;
  } else if (code === 27) {
    newStyle.inverse = false;
  } else if (code === 29) {
    newStyle.strike = false;
  } else if (code === 39) {
    // Default foreground
    delete newStyle.color;
  } else if (code === 49) {
    // Default background
    delete newStyle.bgColor;
  } else if (code >= 30 && code <= 37) {
    newStyle.color = ANSI_COLORS[code];
  } else if (code >= 40 && code <= 47) {
    newStyle.bgColor = ANSI_BG_COLORS[code];
  } else if (code >= 90 && code <= 97) {
    newStyle.color = ANSI_COLORS[code];
  } else if (code >= 100 && code <= 107) {
    newStyle.bgColor = ANSI_BG_COLORS[code];
  }

  return newStyle;
}

/**
 * Convert ANSI escape sequences to HTML with inline styles
 */
export function ansiToHtml(text: string): string {
  // Match ANSI escape sequences in multiple formats:
  // 1. With ESC character: \x1b[32m or \u001b[32m
  // 2. Without ESC (stripped by some terminals): [32m at start of string or after newline/space
  // The second pattern is more permissive to catch orphaned sequences
  const ansiRegex = /(?:\x1b|\u001b)?\[([0-9;]*)m/g;

  let result = '';
  let lastIndex = 0;
  let currentStyle: TextStyle = {};
  let match: RegExpExecArray | null;

  while ((match = ansiRegex.exec(text)) !== null) {
    // Add text before this escape sequence
    const textBefore = text.slice(lastIndex, match.index);
    if (textBefore) {
      const inlineStyle = styleToInline(currentStyle);
      if (inlineStyle) {
        result += `<span style="${inlineStyle}">${escapeHtml(textBefore)}</span>`;
      } else {
        result += escapeHtml(textBefore);
      }
    }

    // Parse the ANSI codes
    const codes = match[1].split(';').filter(Boolean).map(Number);

    // If empty codes (like ESC[m), treat as reset
    if (codes.length === 0) {
      currentStyle = {};
    } else {
      currentStyle = applyCodes(currentStyle, codes);
    }

    lastIndex = match.index + match[0].length;
  }

  // Add remaining text
  const remaining = text.slice(lastIndex);
  if (remaining) {
    const inlineStyle = styleToInline(currentStyle);
    if (inlineStyle) {
      result += `<span style="${inlineStyle}">${escapeHtml(remaining)}</span>`;
    } else {
      result += escapeHtml(remaining);
    }
  }

  return result;
}

/**
 * Escape HTML special characters
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Check if text contains ANSI escape sequences
 */
export function hasAnsiCodes(text: string): boolean {
  return /\x1b\[/.test(text);
}

/**
 * Strip ANSI escape sequences from text
 */
export function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;]*m/g, '');
}
