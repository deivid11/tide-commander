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
}

function styleToInline(style: TextStyle): string {
  const parts: string[] = [];

  if (style.color) {
    parts.push(`color:${style.color}`);
  }
  if (style.bgColor) {
    parts.push(`background-color:${style.bgColor}`);
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
  if (style.underline) {
    parts.push('text-decoration:underline');
  }

  return parts.join(';');
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
  } else if (code === 22) {
    newStyle.bold = false;
    newStyle.dim = false;
  } else if (code === 23) {
    newStyle.italic = false;
  } else if (code === 24) {
    newStyle.underline = false;
  } else if (code === 27) {
    newStyle.inverse = false;
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
      for (const code of codes) {
        currentStyle = applyCode(currentStyle, code);
      }
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
