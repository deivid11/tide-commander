export const AGENT_CHAT_COLLAPSE_LINE_THRESHOLD = 5;
export const AGENT_CHAT_COLLAPSE_CHAR_THRESHOLD = 280;

const AGENT_CHAT_HEADER_RE = /^\s*Message from agent\s+(.+?)\s*\(([a-zA-Z0-9_-]+)\)\s*:\s*([\s\S]*)$/;

export interface ParsedAgentChatMessage {
  senderName: string;
  senderId: string;
  body: string;
}

export function parseAgentChatMessage(text: string): ParsedAgentChatMessage | null {
  if (!text) return null;
  const m = text.match(AGENT_CHAT_HEADER_RE);
  if (!m) return null;
  const senderName = m[1].trim();
  const senderId = m[2].trim();
  const body = m[3].trim();
  if (!senderName || !senderId || !body) return null;
  return { senderName, senderId, body };
}

export function shouldCollapseAgentChatBody(body: string): boolean {
  if (!body) return false;
  return body.split('\n').length > AGENT_CHAT_COLLAPSE_LINE_THRESHOLD
    || body.length > AGENT_CHAT_COLLAPSE_CHAR_THRESHOLD;
}
