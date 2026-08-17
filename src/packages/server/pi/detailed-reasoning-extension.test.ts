import { describe, expect, it, vi } from 'vitest';
import detailedReasoningExtension, { requestDetailedReasoningSummary } from './detailed-reasoning-extension.js';

describe('Pi detailed reasoning extension', () => {
  it('changes only encrypted OpenAI Responses reasoning summaries to detailed', () => {
    const payload = {
      model: 'gpt-5.6-sol',
      include: ['reasoning.encrypted_content'],
      reasoning: { effort: 'high', summary: 'auto' },
      input: [{ role: 'user', content: 'hello' }],
    };

    expect(requestDetailedReasoningSummary(payload)).toEqual({
      ...payload,
      reasoning: { effort: 'high', summary: 'detailed' },
    });
    expect(payload.reasoning.summary).toBe('auto');
  });

  it('leaves unrelated provider payloads untouched', () => {
    expect(requestDetailedReasoningSummary({
      model: 'claude',
      thinking: { type: 'adaptive' },
    })).toBeUndefined();
  });

  it('registers the provider request hook used by JSON and RPC modes', () => {
    const on = vi.fn();
    detailedReasoningExtension({ on });
    expect(on).toHaveBeenCalledOnce();
    expect(on.mock.calls[0][0]).toBe('before_provider_request');

    const rewrite = on.mock.calls[0][1] as (event: { payload: unknown }) => unknown;
    expect(rewrite({
      payload: {
        include: ['reasoning.encrypted_content'],
        reasoning: { effort: 'medium', summary: 'auto' },
      },
    })).toMatchObject({ reasoning: { effort: 'medium', summary: 'detailed' } });
  });
});
