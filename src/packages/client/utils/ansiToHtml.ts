/**
 * ANSI escape code to HTML converter
 * Converts terminal color codes to styled spans
 */

// ANSI color codes to CSS color mapping
const ANSI_COLORS: Record<number, string> = {
  // Standard colors (30-37)
  30: '#000000', // black
  31: '#ef4444', // red
  32: '#22c55e', // green
  33: '#eab308', // yellow
  34: '#3b82f6', // blue
  35: '#a855f7', // magenta
  36: '#06b6d4', // cyan
  37: '#e5e5e5', // white

  // Bright colors (90-97)
  90: '#666666', // bright black (gray)
  91: '#f87171', // bright red
  92: '#4ade80', // bright green
  93: '#facc15', // bright yellow
  94: '#60a5fa', // bright blue
  95: '#c084fc', // bright magenta
  96: '#22d3ee', // bright cyan
  97: '#ffffff', // bright white
};

const ANSI_BG_COLORS: Record<number, string> = {
  // Standard background colors (40-47)
  40: '#000000',
  41: '#ef4444',
  42: '#22c55e',
  43: '#eab308',
  44: '#3b82f6',
  45: '#a855f7',
  46: '#06b6d4',
  47: '#e5e5e5',

  // Bright background colors (100-107)
  100: '#666666',
  101: '#f87171',
  102: '#4ade80',
  103: '#facc15',
  104: '#60a5fa',
  105: '#c084fc',
  106: '#22d3ee',
  107: '#ffffff',
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
