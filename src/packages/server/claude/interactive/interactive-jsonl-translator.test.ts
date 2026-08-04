import { describe, it, expect } from 'vitest';
import { InteractiveJsonlTranslator } from './interactive-jsonl-translator.js';

/**
 * Interactive transcripts have no `system/init`, so the fallback baseline comes
 * from the agent record rather than from the stream. These cover that wiring.
 */
describe('InteractiveJsonlTranslator model fallback', () => {
  const assistantRecord = (model: string, extra: Record<string, unknown> = {}) => ({
    type: 'assistant',
    uuid: 'u1',
    sessionId: 's1',
    message: { model, content: [{ type: 'text', text: 'hi' }], stop_reason: null },
    ...extra,
  });

  it('flags a transcript answered by a model the agent was not configured for', () => {
    const translator = new InteractiveJsonlTranslator('claude-fable-5');
    const events = translator.translate(assistantRecord('claude-opus-4-8'));

    expect(events.find((e) => e.type === 'model_fallback')).toMatchObject({
      requestedModel: 'claude-fable-5',
      servedModel: 'claude-opus-4-8',
      text: 'Fable 5 → Opus 4.8',
    });
  });

  it('catches a swap present from the very first record', () => {
    // The synthesized `init` reports the served model, so it cannot be the
    // baseline — this is exactly why the agent record supplies it.
    const translator = new InteractiveJsonlTranslator('claude-fable-5');
    const events = translator.translate(assistantRecord('claude-opus-4-8'));

    expect(events[0]).toMatchObject({ type: 'init', model: 'claude-opus-4-8' });
    expect(events.some((e) => e.type === 'model_fallback')).toBe(true);
  });

  it('says nothing while the configured model is answering', () => {
    const translator = new InteractiveJsonlTranslator('claude-fable-5');
    const events = translator.translate(assistantRecord('claude-fable-5'));
    expect(events.some((e) => e.type === 'model_fallback')).toBe(false);
  });

  it('ignores sidechain (Task subagent) records', () => {
    const translator = new InteractiveJsonlTranslator('claude-fable-5');
    const events = translator.translate(
      assistantRecord('claude-haiku-4-5', { isSidechain: true })
    );
    expect(events.some((e) => e.type === 'model_fallback')).toBe(false);
  });

  it('does nothing when the agent has no configured model to compare against', () => {
    const translator = new InteractiveJsonlTranslator();
    const events = translator.translate(assistantRecord('claude-opus-4-8'));
    expect(events.some((e) => e.type === 'model_fallback')).toBe(false);
  });
});
