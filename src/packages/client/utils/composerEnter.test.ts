import { describe, expect, it } from 'vitest';
import { enterInsertsNewline } from './composerEnter';

const env = (coarse: boolean, width: number) => ({
  matchMedia: (query: string) => ({ matches: query === '(pointer: coarse)' && coarse }),
  innerWidth: width,
});

describe('enterInsertsNewline', () => {
  it('desktop (fine pointer, wide window): Enter sends', () => {
    expect(enterInsertsNewline(env(false, 1280))).toBe(false);
  });
  it('phone in portrait (touch, narrow): Enter adds a line', () => {
    expect(enterInsertsNewline(env(true, 412))).toBe(true);
  });
  it('phone in landscape (touch, wider than 768): still adds a line', () => {
    expect(enterInsertsNewline(env(true, 915))).toBe(true);
  });
  it('keeps the old width rule for a narrow desktop window, boundary included', () => {
    expect(enterInsertsNewline(env(false, 768))).toBe(true);
    expect(enterInsertsNewline(env(false, 769))).toBe(false);
  });
  it('without matchMedia it falls back to the width alone', () => {
    expect(enterInsertsNewline({ innerWidth: 400 })).toBe(true);
    expect(enterInsertsNewline({ innerWidth: 1200 })).toBe(false);
  });
  it('without a window (server render) Enter keeps sending', () => {
    expect(enterInsertsNewline(undefined)).toBe(false);
  });
});
