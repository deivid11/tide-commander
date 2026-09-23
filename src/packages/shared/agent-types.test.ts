/**
 * Tests for the Claude Sonnet 5 entries in the CLAUDE_MODELS registry.
 */

import { describe, it, expect } from 'vitest';
import {
  CLAUDE_MODELS,
  CODEX_MODELS,
  DEFAULT_CODEX_MODEL,
  DEFAULT_CODEX_REASONING_EFFORT,
  isDeprecatedCodexModel,
  migrateRetiredCodexModel,
  DEFAULT_CLAUDE_EFFORT,
  DEFAULT_CLAUDE_MODEL,
  isDeprecatedClaudeModel,
  migrateRetiredClaudeModel,
  providerClosesStdinAfterPrompt,
  providerDisplayName,
} from './agent-types.js';

describe('CLAUDE_MODELS — Fable 5.1', () => {
  it('exposes the canonical Fable 5.1 id with its native 1M context', () => {
    expect(CLAUDE_MODELS['claude-fable-5-1']).toMatchObject({
      label: 'Fable 5.1 [1M]',
      contextWindow: 1000000,
    });
    expect(isDeprecatedClaudeModel('claude-fable-5-1')).toBe(false);
  });
});

describe('CLAUDE_MODELS — Sonnet 5', () => {
  it('exposes the 1M-context Sonnet 5 variant as visible (non-deprecated)', () => {
    expect(CLAUDE_MODELS['claude-sonnet-5[1m]']).toBeDefined();
    expect(CLAUDE_MODELS['claude-sonnet-5[1m]'].contextWindow).toBe(1000000);
    expect(isDeprecatedClaudeModel('claude-sonnet-5[1m]')).toBe(false);
  });

  it('hides the plain 200K Sonnet 5 variant from the picker', () => {
    expect(CLAUDE_MODELS['claude-sonnet-5']).toBeDefined();
    expect(CLAUDE_MODELS['claude-sonnet-5'].contextWindow).toBe(200000);
    expect(isDeprecatedClaudeModel('claude-sonnet-5')).toBe(true);
  });
});

describe('providerClosesStdinAfterPrompt', () => {
  it('is true for Grok, Codex, OpenCode, and Pi', () => {
    expect(providerClosesStdinAfterPrompt('grok')).toBe(true);
    expect(providerClosesStdinAfterPrompt('codex')).toBe(true);
    expect(providerClosesStdinAfterPrompt('opencode')).toBe(true);
    expect(providerClosesStdinAfterPrompt('pi')).toBe(true);
  });

  it('is false for Claude and unknown providers', () => {
    expect(providerClosesStdinAfterPrompt('claude')).toBe(false);
    expect(providerClosesStdinAfterPrompt(undefined)).toBe(false);
    expect(providerClosesStdinAfterPrompt(null)).toBe(false);
  });
});

describe('providerDisplayName', () => {
  it('returns friendly labels', () => {
    expect(providerDisplayName('grok')).toBe('Grok');
    expect(providerDisplayName('codex')).toBe('Codex');
    expect(providerDisplayName('opencode')).toBe('OpenCode');
    expect(providerDisplayName('pi')).toBe('Pi');
    expect(providerDisplayName('claude')).toBe('Claude');
  });
});

describe('CLAUDE_MODELS — Opus 5.5', () => {
  it('is the new-agent default: Opus 5.5 with 1M context and high effort', () => {
    expect(DEFAULT_CLAUDE_MODEL).toBe('claude-opus-5-5[1m]');
    expect(DEFAULT_CLAUDE_EFFORT).toBe('high');
    expect(CLAUDE_MODELS[DEFAULT_CLAUDE_MODEL]).toMatchObject({ label: 'Opus 5.5 [1M]', contextWindow: 1000000 });
    expect(isDeprecatedClaudeModel(DEFAULT_CLAUDE_MODEL)).toBe(false);
  });

  it('keeps the plain 200K id valid but out of the picker', () => {
    expect(CLAUDE_MODELS['claude-opus-5-5'].contextWindow).toBe(200000);
    expect(isDeprecatedClaudeModel('claude-opus-5-5')).toBe(true);
  });
});

describe('retired Opus 4.8', () => {
  it('is gone from the registry', () => {
    expect(Object.keys(CLAUDE_MODELS).filter((id) => id.includes('4-8'))).toEqual([]);
  });

  it('moves agents to Opus 5.5, keeping the context-window variant', () => {
    expect(migrateRetiredClaudeModel('claude-opus-4-8[1m]')).toBe('claude-opus-5-5[1m]');
    expect(migrateRetiredClaudeModel('claude-opus-4-8')).toBe('claude-opus-5-5');
    expect(migrateRetiredClaudeModel('claude-opus-5[1m]')).toBe('claude-opus-5[1m]');
  });
});

describe('new/edit agent picker', () => {
  it('offers only the current generation of each family', () => {
    const visible = Object.keys(CLAUDE_MODELS).filter((id) => !isDeprecatedClaudeModel(id as keyof typeof CLAUDE_MODELS));
    // Picker order is the registry's key order: Fable → Opus → Sonnet → Haiku.
    expect(visible).toEqual(['claude-fable-5-1', 'claude-opus-5-5[1m]', 'claude-sonnet-5[1m]', 'haiku']);
  });
});

describe('CODEX_MODELS — GPT-6', () => {
  it('offers Astra → Sol → Luna, defaulting to Sol with high reasoning', () => {
    const visible = (Object.keys(CODEX_MODELS) as (keyof typeof CODEX_MODELS)[]).filter((id) => !isDeprecatedCodexModel(id));
    expect(visible).toEqual(['gpt-6-astra', 'gpt-6-sol', 'gpt-6-luna']);
    expect(DEFAULT_CODEX_MODEL).toBe('gpt-6-sol');
    expect(DEFAULT_CODEX_REASONING_EFFORT).toBe('high');
  });

  it('moves retired GPT-5.6 Luna/Sol to their GPT-6 successors and keeps Terra', () => {
    expect(migrateRetiredCodexModel('gpt-5.6-luna')).toBe('gpt-6-luna');
    expect(migrateRetiredCodexModel('gpt-5.6-sol')).toBe('gpt-6-sol');
    expect(migrateRetiredCodexModel('gpt-5.6-terra')).toBe('gpt-5.6-terra');
    expect(isDeprecatedCodexModel('gpt-5.6-terra')).toBe(true);
  });
});
