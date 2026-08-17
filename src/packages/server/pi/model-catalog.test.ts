import { describe, expect, it } from 'vitest';
import { parsePiModelCatalog, parsePiTokenCount } from './model-catalog';

describe('Pi model catalog', () => {
  it('parses Pi token-count abbreviations', () => {
    expect(parsePiTokenCount('1M')).toBe(1_000_000);
    expect(parsePiTokenCount('200K')).toBe(200_000);
    expect(parsePiTokenCount('163.8K')).toBe(163_800);
    expect(parsePiTokenCount('bad')).toBe(0);
  });

  it('keeps context-window metadata from pi --list-models', () => {
    const entries = parsePiModelCatalog(`
provider      model                       context  max-out  thinking  images
anthropic     claude-opus-5               1M       128K     yes       yes
openai-codex  gpt-5.6-sol                 272K     128K     yes       yes
ollama        qwen3.8-27b                 32.8K    8.2K     no        no
`);

    expect(entries).toEqual([
      {
        id: 'anthropic/claude-opus-5',
        provider: 'anthropic',
        model: 'claude-opus-5',
        contextWindow: 1_000_000,
        maxOutputTokens: 128_000,
        thinking: true,
        images: true,
      },
      {
        id: 'openai-codex/gpt-5.6-sol',
        provider: 'openai-codex',
        model: 'gpt-5.6-sol',
        contextWindow: 272_000,
        maxOutputTokens: 128_000,
        thinking: true,
        images: true,
      },
      {
        id: 'ollama/qwen3.8-27b',
        provider: 'ollama',
        model: 'qwen3.8-27b',
        contextWindow: 32_800,
        maxOutputTokens: 8_200,
        thinking: false,
        images: false,
      },
    ]);
  });
});
