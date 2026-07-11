/**
 * Tests for the Claude Sonnet 5 entries in the CLAUDE_MODELS registry.
 */

import { describe, it, expect } from 'vitest';
import {
  CLAUDE_MODELS,
  isDeprecatedClaudeModel,
  providerClosesStdinAfterPrompt,
  providerDisplayName,
} from './agent-types.js';

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
  it('is true for Grok, Codex, and OpenCode', () => {
    expect(providerClosesStdinAfterPrompt('grok')).toBe(true);
    expect(providerClosesStdinAfterPrompt('codex')).toBe(true);
    expect(providerClosesStdinAfterPrompt('opencode')).toBe(true);
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
    expect(providerDisplayName('claude')).toBe('Claude');
  });
});
