import { describe, it, expect } from 'vitest';
import {
  parseAgentChatMessage,
  shouldCollapseAgentChatBody,
} from '../agentChatMessageParser';

const SHORT_BODY = 'Quick ping: did the build pass?';

const LONG_BODY = `FOLLOW-UP TASK — Apply your compact + 'Show more' pattern (just shipped on .curl-card--agent-message) to delegation-task messages in the Guake terminal chat.

## The message type
User-prompt outputs that start with '📋 Task delegated from TC BOSS:' (or similar — boss name varies). Body is the full task spec, often hundreds of lines / 5KB+.

## Implementation
- SAME visual mechanics as AgentMessageCard: tight padding, smaller font, line-clamp ~5 collapsed.
- HEADER: pull out the first line.
- DON'T BREAK virtualization.`;

const sampleSingleLine = 'Message from agent TC BOSS (dsq2oet7): Quick ping: did the build pass?';

const sampleMultilineBody = `Message from agent TC BOSS (dsq2oet7): ${LONG_BODY}`;

const sampleSpaceyName = `Message from agent  Triton  Bravo  (abc-123_xy):

${SHORT_BODY}`;

describe('parseAgentChatMessage', () => {
  it('parses single-line message with sender name and id', () => {
    const parsed = parseAgentChatMessage(sampleSingleLine);
    expect(parsed).not.toBeNull();
    expect(parsed!.senderName).toBe('TC BOSS');
    expect(parsed!.senderId).toBe('dsq2oet7');
    expect(parsed!.body).toBe('Quick ping: did the build pass?');
  });

  it('parses multiline body when message wraps onto subsequent lines', () => {
    const parsed = parseAgentChatMessage(sampleMultilineBody);
    expect(parsed).not.toBeNull();
    expect(parsed!.senderName).toBe('TC BOSS');
    expect(parsed!.senderId).toBe('dsq2oet7');
    expect(parsed!.body.startsWith('FOLLOW-UP TASK')).toBe(true);
    expect(parsed!.body.includes('virtualization')).toBe(true);
  });

  it('tolerates extra whitespace and id suffixes with hyphen/underscore', () => {
    const parsed = parseAgentChatMessage(sampleSpaceyName);
    expect(parsed).not.toBeNull();
    expect(parsed!.senderName).toBe('Triton  Bravo');
    expect(parsed!.senderId).toBe('abc-123_xy');
    expect(parsed!.body).toBe(SHORT_BODY);
  });

  it('returns null for non-matching text', () => {
    expect(parseAgentChatMessage('')).toBeNull();
    expect(parseAgentChatMessage('Hello world')).toBeNull();
    expect(parseAgentChatMessage('Message from David: hi')).toBeNull();
    expect(parseAgentChatMessage('Message from agent X (id):')).toBeNull();
    expect(parseAgentChatMessage('agent X (id): body')).toBeNull();
  });
});

describe('shouldCollapseAgentChatBody', () => {
  it('does not collapse short bodies', () => {
    expect(shouldCollapseAgentChatBody(SHORT_BODY)).toBe(false);
    expect(shouldCollapseAgentChatBody('')).toBe(false);
  });

  it('collapses when body exceeds the line threshold', () => {
    expect(shouldCollapseAgentChatBody('a\nb\nc\nd\ne\nf')).toBe(true);
  });

  it('collapses when body exceeds the char threshold', () => {
    expect(shouldCollapseAgentChatBody('x'.repeat(400))).toBe(true);
  });

  it('returns true for the realistic long body sample', () => {
    expect(shouldCollapseAgentChatBody(LONG_BODY)).toBe(true);
  });
});
