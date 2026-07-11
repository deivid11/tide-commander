import { describe, it, expect } from 'vitest';
import { nextStreamFadeState, splitStreamWords } from '../StreamFadeText';

describe('nextStreamFadeState', () => {
  it('returns full text with no fade when not streaming', () => {
    expect(nextStreamFadeState('', 'Hello world', false)).toEqual({
      solid: 'Hello world',
      fade: null,
    });
  });

  it('fades the first chunk from empty base', () => {
    expect(nextStreamFadeState('', 'Hello', true)).toEqual({
      solid: '',
      fade: 'Hello',
    });
  });

  it('fades only the newest suffix on append', () => {
    expect(nextStreamFadeState('Hello', 'Hello world', true)).toEqual({
      solid: 'Hello',
      fade: ' world',
    });
  });

  it('resets solid when text does not append previous base', () => {
    expect(nextStreamFadeState('Hello', 'Goodbye', true)).toEqual({
      solid: 'Goodbye',
      fade: null,
    });
  });
});

describe('splitStreamWords', () => {
  it('keeps whitespace tokens for layout', () => {
    expect(splitStreamWords('hello world')).toEqual(['hello', ' ', 'world']);
    expect(splitStreamWords(' a  b')).toEqual([' ', 'a', '  ', 'b']);
  });
});
