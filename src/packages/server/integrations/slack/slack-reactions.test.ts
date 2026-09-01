import { describe, expect, it } from 'vitest';
import { normalizeEmojiName } from './slack-instance.js';

describe('Slack reaction normalization', () => {
  it.each(['eye', 'eyes', ':eye:', ':eyes:', '👁', '👁️', '👀'])(
    'rejects eye reaction %s',
    (reaction) => {
      expect(() => normalizeEmojiName(reaction)).toThrow('Eye reactions are disabled');
    },
  );

  it('continues to normalize other reaction names', () => {
    expect(normalizeEmojiName(':white_check_mark:')).toBe('white_check_mark');
  });
});
