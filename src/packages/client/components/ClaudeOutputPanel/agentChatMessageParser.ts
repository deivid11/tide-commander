export const AGENT_CHAT_COLLAPSE_LINE_THRESHOLD = 5;
export const AGENT_CHAT_COLLAPSE_CHAR_THRESHOLD = 280;

// Canonical skill format: "Message from agent <Name> (<id>): <body>"
const AGENT_CHAT_HEADER_RE = /^\s*Message from agent\s+(.+?)\s*\(([a-zA-Z0-9_-]+)\)\s*:\s*([\s\S]*)$/;

// Inbound /message deliveries where the sending agent composes its own identity
// prefix, e.g. "From <Name> (<id>). <body>" or "Message from <Name> (<id>). <body>".
// The distinguishing token vs. the canonical header is the period+whitespace after
// the closing paren (instead of a colon). The id is restricted to lowercase
// alphanumerics with a length floor — the shape real agent ids take (e.g.
// "mx3ahan8") — so ordinary prose like "From Paris (FR). ..." is not mistaken for
// an agent message.
const AGENT_CHAT_INBOUND_RE = /^\s*(?:Message\s+)?[Ff]rom\s+(.+?)\s+\(([a-z0-9]{4,})\)\.\s+([\s\S]+)$/;

export interface ParsedAgentChatMessage {
  senderName: string;
  senderId: string;
  body: string;
}

export function parseAgentChatMessage(text: string): ParsedAgentChatMessage | null {
  if (!text) return null;

  const m = text.match(AGENT_CHAT_HEADER_RE);
  if (m) {
    const senderName = m[1].trim();
    const senderId = m[2].trim();
    const body = m[3].trim();
    if (!senderName || !senderId || !body) return null;
    return { senderName, senderId, body };
  }

  const inbound = text.match(AGENT_CHAT_INBOUND_RE);
  if (inbound) {
    // Drop an optional leading "agent " keyword so "From agent Foo (id). hi"
    // renders as "Foo" rather than "agent Foo".
    const senderName = inbound[1].trim().replace(/^agent\s+/i, '').trim();
    const senderId = inbound[2].trim();
    const body = inbound[3].trim();
    if (!senderName || !senderId || !body) return null;
    return { senderName, senderId, body };
  }

  return null;
}

export function shouldCollapseAgentChatBody(body: string): boolean {
  if (!body) return false;
  return body.split('\n').length > AGENT_CHAT_COLLAPSE_LINE_THRESHOLD
    || body.length > AGENT_CHAT_COLLAPSE_CHAR_THRESHOLD;
}
