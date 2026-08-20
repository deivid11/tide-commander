import { describe, expect, it } from 'vitest';
import { extractSessionRestoreMetadata } from './session-loader.js';

describe('extractSessionRestoreMetadata', () => {
  it('uses the latest Claude model and effort', () => {
    const jsonl = [
      { type: 'assistant', message: { model: 'claude-opus-4-7' }, effort: 'high' },
      { type: 'assistant', message: { model: 'claude-opus-4-8' }, effort: 'xHigh' },
    ].map((entry) => JSON.stringify(entry)).join('\n');

    expect(extractSessionRestoreMetadata('claude', jsonl)).toEqual({
      provider: 'claude',
      model: 'claude-opus-4-8',
      effort: 'xHigh',
    });
  });

  it('reads Codex turn context', () => {
    const jsonl = JSON.stringify({
      type: 'turn_context',
      payload: { model: 'gpt-5.6-sol', effort: 'xhigh' },
    });

    expect(extractSessionRestoreMetadata('codex', jsonl)).toEqual({
      provider: 'codex',
      model: 'gpt-5.6-sol',
      effort: 'xhigh',
    });
  });

  it('reads Grok assistant settings', () => {
    const jsonl = JSON.stringify({
      type: 'assistant',
      model_id: 'grok-4.5-build',
      reasoning_effort: 'high',
    });

    expect(extractSessionRestoreMetadata('grok', jsonl)).toEqual({
      provider: 'grok',
      model: 'grok-4.5',
      effort: 'high',
    });
  });

  it('combines the latest Pi provider/model and thinking level', () => {
    const jsonl = [
      { type: 'model_change', provider: 'openai-codex', modelId: 'gpt-5.6-sol' },
      { type: 'thinking_level_change', thinkingLevel: 'medium' },
    ].map((entry) => JSON.stringify(entry)).join('\n');

    expect(extractSessionRestoreMetadata('pi', jsonl)).toEqual({
      provider: 'pi',
      model: 'openai-codex/gpt-5.6-sol',
      effort: 'medium',
    });
  });
});
