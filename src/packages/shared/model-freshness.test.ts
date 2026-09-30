import { describe, expect, it } from 'vitest';
import { outdatedAgentModel, outdatedClaudeModel, outdatedCodexModel } from './model-freshness.js';

describe('outdatedClaudeModel', () => {
  it('flags older Opus/Fable/Sonnet generations with the newest of the family', () => {
    expect(outdatedClaudeModel('claude-opus-5[1m]')).toEqual({ newerModel: 'claude-opus-5-5[1m]', newerLabel: 'Opus 5.5 [1M]' });
    expect(outdatedClaudeModel('opus[1m]')?.newerLabel).toBe('Opus 5.5 [1M]'); // Opus 4.7
    expect(outdatedClaudeModel('claude-opus-4-6')?.newerLabel).toBe('Opus 5.5 [1M]');
    expect(outdatedClaudeModel('claude-fable-5[1m]')?.newerLabel).toBe('Fable 5.1 [1M]');
    expect(outdatedClaudeModel('claude-sonnet-5[1m]')).toEqual({ newerModel: 'claude-sonnet-5-5', newerLabel: 'Sonnet 5.5 [1M]' });
    expect(outdatedClaudeModel('claude-sonnet-5')?.newerLabel).toBe('Sonnet 5.5 [1M]');
  });

  it('never flags the current generation, aliases or Haiku', () => {
    for (const current of ['claude-opus-5-5[1m]', 'claude-opus-5-5', 'claude-fable-5-1', 'claude-sonnet-5-5', 'opus', 'sonnet', 'haiku', undefined]) {
      expect(outdatedClaudeModel(current)).toBeNull();
    }
  });
});

describe('outdatedCodexModel', () => {
  it('flags GPT-5.x with its GPT-6 successor', () => {
    expect(outdatedCodexModel('gpt-5.6-luna')?.newerLabel).toBe('GPT-6 Luna');
    expect(outdatedCodexModel('gpt-5.6-terra')?.newerLabel).toBe('GPT-6.1 Sol');
    expect(outdatedCodexModel('gpt-6-astra')).toBeNull();
    expect(outdatedCodexModel('gpt-6.1-sol')).toBeNull();
    expect(outdatedCodexModel('gpt-6-sol')).toEqual({ newerModel: 'gpt-6.1-sol', newerLabel: 'GPT-6.1 Sol' });
  });
});

describe('outdatedAgentModel', () => {
  it('reads the model field of each provider', () => {
    expect(outdatedAgentModel({ provider: 'claude', model: 'claude-opus-5[1m]' })?.newerLabel).toBe('Opus 5.5 [1M]');
    expect(outdatedAgentModel({ model: 'claude-opus-5[1m]' })?.newerLabel).toBe('Opus 5.5 [1M]'); // legacy agents: provider unset
    expect(outdatedAgentModel({ provider: 'codex', codexModel: 'gpt-5.6-terra' })?.newerLabel).toBe('GPT-6.1 Sol');
    expect(outdatedAgentModel({ provider: 'pi', piModel: 'openai-codex/gpt-5.6-sol' })).toEqual({ newerModel: 'openai-codex/gpt-6.1-sol', newerLabel: 'GPT-6.1 Sol' });
    expect(outdatedAgentModel({ provider: 'pi', piModel: 'openai-codex/gpt-6-sol' })).toEqual({ newerModel: 'openai-codex/gpt-6.1-sol', newerLabel: 'GPT-6.1 Sol' });
  });

  it('stays quiet where the newer model is not available to that provider', () => {
    // Pi's Anthropic catalog has no Opus 5.5 yet.
    expect(outdatedAgentModel({ provider: 'pi', piModel: 'anthropic/claude-opus-5' })).toBeNull();
    expect(outdatedAgentModel({ provider: 'grok', model: 'claude-opus-5' })).toBeNull();
  });
});
