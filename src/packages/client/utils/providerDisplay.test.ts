import { describe, expect, it } from 'vitest';
import {
  piModelProviderAssetUrl,
  piModelProviderLabel,
  providerAgentTitle,
  providerLabel,
  resolvePiModelProvider,
} from './providerDisplay';

describe('Pi provider display', () => {
  it('extracts the source provider from provider/model patterns', () => {
    expect(resolvePiModelProvider('anthropic/claude-sonnet-4-5')).toBe('anthropic');
    expect(resolvePiModelProvider(' ollama/qwen3.6-35b-a3b ')).toBe('ollama');
  });

  it('uses the runtime-reported provider for Pi defaults', () => {
    expect(resolvePiModelProvider('', 'anthropic')).toBe('anthropic');
    expect(resolvePiModelProvider(undefined, 'google')).toBe('google');
  });

  it('does not invent a provider for fuzzy model names', () => {
    expect(resolvePiModelProvider('claude-sonnet')).toBeUndefined();
    expect(resolvePiModelProvider('')).toBeUndefined();
  });

  it('maps known Pi providers to existing brand assets and labels unknown ones', () => {
    expect(piModelProviderAssetUrl('anthropic', '/base/')).toBe('/base/assets/claude.png');
    expect(piModelProviderAssetUrl('openai', '/base/')).toBe('/base/assets/codex.png');
    expect(piModelProviderAssetUrl('openai-codex', '/base/')).toBe('/base/assets/codex.png');
    expect(piModelProviderAssetUrl('xai', '/base/')).toBe('/base/assets/grok.png');
    expect(piModelProviderAssetUrl('google', '/base/')).toContain('file_type_gemini.svg');
    expect(piModelProviderAssetUrl('ollama', '/base/')).toBeUndefined();
    expect(piModelProviderLabel('openrouter')).toBe('OpenRouter');
    expect(piModelProviderLabel('my-local')).toBe('My Local');
  });

  it('describes both layers for Pi agents', () => {
    expect(providerLabel('pi', 'anthropic/claude-sonnet')).toBe('Anthropic via Pi');
    expect(providerAgentTitle('pi', 'openai/gpt-5')).toBe('OpenAI via Pi Agent');
    expect(providerLabel('pi')).toBe('Pi');
  });
});
