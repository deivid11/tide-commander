import { describe, expect, it } from 'vitest';
import { extractPiReasoningMetadata } from './reasoning-metadata.js';

describe('extractPiReasoningMetadata', () => {
  it('identifies OpenAI summary-only encrypted reasoning', () => {
    const metadata = extractPiReasoningMetadata(JSON.stringify({
      encrypted_content: 'opaque-provider-payload',
      content: [],
      summary: [
        { type: 'summary_text', text: 'Inspecting parser flow' },
        { type: 'summary_text', text: 'Planning the patch' },
      ],
    }), 693);

    expect(metadata).toEqual({
      reasoningTokens: 693,
      reasoningSummaryCount: 2,
      reasoningEncrypted: true,
      reasoningSummaryOnly: true,
    });
  });

  it('does not label provider-returned reasoning text as summary-only', () => {
    const metadata = extractPiReasoningMetadata(JSON.stringify({
      encrypted_content: 'opaque-provider-payload',
      content: [{ type: 'reasoning_text', text: 'Detailed reasoning' }],
      summary: [{ type: 'summary_text', text: 'Summary' }],
    }), 42);

    expect(metadata.reasoningSummaryOnly).toBeUndefined();
    expect(metadata.reasoningEncrypted).toBe(true);
    expect(metadata.reasoningSummaryCount).toBe(1);
  });

  it('keeps token usage when a provider has no parseable signature', () => {
    expect(extractPiReasoningMetadata('not-json', 12)).toEqual({ reasoningTokens: 12 });
  });
});
