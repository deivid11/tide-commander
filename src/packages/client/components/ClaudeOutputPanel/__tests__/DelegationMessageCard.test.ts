import { describe, it, expect } from 'vitest';
import {
  parseDelegationMessage,
  shouldCollapseDelegationBody,
} from '../delegationMessageParser';

const SHORT_BODY = 'Quick task: bump the version number.';

const LONG_BODY = `BUG FIX TASK — REGRESSION / SECOND VARIANT of the Guake terminal send-message flicker.

Repro:
1. Open the Guake terminal.
2. Type a long message into the chat input.
3. Hit enter rapidly while the previous send is still in flight.

Observed: input flickers between empty and previous draft.

Expected: input clears once and stays cleared.

Investigation already done:
- Confirmed the bug only reproduces in Firefox Nightly.
- Tracked the flicker to a stale state read inside the send handler.

Files of interest:
- src/packages/client/components/GuakeTerminal/ChatInput.tsx
- src/packages/client/components/GuakeTerminal/useSendMessage.ts

Quality gates: TS strict, lint clean, no console.log.`;

const sampleDelegation = `📋 **Task delegated from TC BOSS:**

${LONG_BODY}`;

const sampleSpaceyHeader = `📋  **Task delegated from   Triton Bravo  :**

${SHORT_BODY}`;

describe('parseDelegationMessage', () => {
  it('parses boss name and body from a standard delegation broadcast', () => {
    const parsed = parseDelegationMessage(sampleDelegation);
    expect(parsed).not.toBeNull();
    expect(parsed!.bossName).toBe('TC BOSS');
    expect(parsed!.body.startsWith('BUG FIX TASK')).toBe(true);
    expect(parsed!.body.includes('Quality gates')).toBe(true);
  });

  it('tolerates extra whitespace and trailing colon variants in the header', () => {
    const parsed = parseDelegationMessage(sampleSpaceyHeader);
    expect(parsed).not.toBeNull();
    expect(parsed!.bossName).toBe('Triton Bravo');
    expect(parsed!.body).toBe(SHORT_BODY);
  });

  it('returns null for non-delegation text', () => {
    expect(parseDelegationMessage('')).toBeNull();
    expect(parseDelegationMessage('Hello world')).toBeNull();
    expect(parseDelegationMessage('📋 Some unrelated emoji message')).toBeNull();
    expect(parseDelegationMessage('**Task delegated from X:**\n\nbody')).toBeNull();
  });

  it('returns null when the body is empty (header only)', () => {
    expect(parseDelegationMessage('📋 **Task delegated from X:**\n\n')).toBeNull();
  });
});

describe('shouldCollapseDelegationBody', () => {
  it('does not collapse short bodies', () => {
    expect(shouldCollapseDelegationBody(SHORT_BODY)).toBe(false);
    expect(shouldCollapseDelegationBody('')).toBe(false);
  });

  it('collapses when the body exceeds the line threshold', () => {
    const sixLines = 'a\nb\nc\nd\ne\nf';
    expect(shouldCollapseDelegationBody(sixLines)).toBe(true);
  });

  it('collapses when the body exceeds the character threshold', () => {
    const wide = 'x'.repeat(400);
    expect(shouldCollapseDelegationBody(wide)).toBe(true);
  });

  it('returns true for the realistic long delegation body sample', () => {
    expect(shouldCollapseDelegationBody(LONG_BODY)).toBe(true);
  });
});
