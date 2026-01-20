/**
 * Sanitize a string by removing invalid Unicode surrogate pairs.
 * This fixes "no low surrogate in string" JSON errors.
 * Handles both raw Unicode surrogates and JSON-escaped surrogates like \ud83d.
 */
export function sanitizeUnicode(str: string): string {
  // First, handle JSON-escaped surrogates (e.g., \ud83d without \udc00-\udfff following)
  const highPattern = /\\u[dD][89aAbB][0-9a-fA-F]{2}/g;
  const lowPattern = /\\u[dD][cCdDeEfF][0-9a-fA-F]{2}/;

  let sanitized = str.replace(highPattern, (match, offset) => {
    const afterMatch = str.slice(offset + match.length);
    if (lowPattern.test(afterMatch.slice(0, 6))) {
      return match;
    }
    return '\\ufffd';
  });

  sanitized = sanitized.replace(/\\u[dD][cCdDeEfF][0-9a-fA-F]{2}/g, (match, offset) => {
    const beforeMatch = sanitized.slice(Math.max(0, offset - 6), offset);
    if (/\\u[dD][89aAbB][0-9a-fA-F]{2}$/.test(beforeMatch)) {
      return match;
    }
    return '\\ufffd';
  });

  // Then handle raw Unicode surrogates
  let result = '';
  for (let i = 0; i < sanitized.length; i++) {
    const code = sanitized.charCodeAt(i);
    if (code >= 0xD800 && code <= 0xDBFF) {
      const nextCode = sanitized.charCodeAt(i + 1);
      if (nextCode >= 0xDC00 && nextCode <= 0xDFFF) {
        result += sanitized[i] + sanitized[i + 1];
        i++;
      } else {
        result += '\uFFFD';
      }
    } else if (code >= 0xDC00 && code <= 0xDFFF) {
      result += '\uFFFD';
    } else {
      result += sanitized[i];
    }
  }
  return result;
}
