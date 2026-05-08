export const DELEGATION_COLLAPSE_LINE_THRESHOLD = 5;
export const DELEGATION_COLLAPSE_CHAR_THRESHOLD = 280;

const DELEGATION_HEADER_RE = /^\s*📋\s*\*\*\s*Task delegated from\s+([^*\n]+?)\s*:?\s*\*\*\s*\n+([\s\S]*)$/;

export interface ParsedDelegationMessage {
  bossName: string;
  body: string;
}

export function parseDelegationMessage(text: string): ParsedDelegationMessage | null {
  if (!text) return null;
  const m = text.match(DELEGATION_HEADER_RE);
  if (!m) return null;
  const bossName = m[1].trim().replace(/:+$/, '').trim();
  const body = m[2].trim();
  if (!bossName || !body) return null;
  return { bossName, body };
}

export function shouldCollapseDelegationBody(body: string): boolean {
  if (!body) return false;
  return body.split('\n').length > DELEGATION_COLLAPSE_LINE_THRESHOLD
    || body.length > DELEGATION_COLLAPSE_CHAR_THRESHOLD;
}
