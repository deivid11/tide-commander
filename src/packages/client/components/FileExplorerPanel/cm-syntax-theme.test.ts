/**
 * Guards the one property that makes the file explorer's editor match the rest
 * of the app: its token colours must come from the theme's CSS variables, not
 * from a hardcoded palette. Regressing to `oneDark` (or any literal hex) is
 * exactly the bug this replaced.
 */
import { describe, it, expect } from 'vitest';
import { tags as t } from '@lezer/highlight';
import { tideHighlightStyle } from './cm-syntax-theme';

// HighlightStyle keeps the specs it was defined with.
const specs = (tideHighlightStyle as unknown as {
  specs: Array<{ tag: unknown; color?: string }>;
}).specs;

function colorFor(tag: unknown): string | undefined {
  for (const spec of specs) {
    const tagList = Array.isArray(spec.tag) ? spec.tag : [spec.tag];
    if (tagList.includes(tag)) return spec.color;
  }
  return undefined;
}

describe('tideHighlightStyle', () => {
  it('never hardcodes a colour — every colour is a theme variable', () => {
    const colors = specs.map((s) => s.color).filter((c): c is string => !!c);
    expect(colors.length).toBeGreaterThan(0);
    const hardcoded = colors.filter((c) => !c.startsWith('var(--'));
    expect(hardcoded).toEqual([]);
  });

  it('matches the Prism palette on the everyday tokens', () => {
    // Same role -> same variable as file-explorer/_syntax.scss.
    expect(colorFor(t.propertyName)).toBe('var(--accent-pink)'); // JSON keys
    expect(colorFor(t.string)).toBe('var(--accent-green)');
    expect(colorFor(t.number)).toBe('var(--accent-purple)');
    expect(colorFor(t.bool)).toBe('var(--accent-purple)');
    expect(colorFor(t.null)).toBe('var(--accent-purple)');
    expect(colorFor(t.keyword)).toBe('var(--accent-pink)');
    expect(colorFor(t.className)).toBe('var(--accent-yellow)');
    expect(colorFor(t.punctuation)).toBe('var(--text-primary)');
    expect(colorFor(t.operator)).toBe('var(--text-primary)');
    expect(colorFor(t.comment)).toBe('var(--text-muted)');
    expect(colorFor(t.regexp)).toBe('var(--accent-orange)');
    expect(colorFor(t.tagName)).toBe('var(--accent-pink)');
    expect(colorFor(t.attributeName)).toBe('var(--accent-green)');
    expect(colorFor(t.attributeValue)).toBe('var(--accent-yellow)');
  });

  it('covers the JSON tag set, so .json files are never left unstyled', () => {
    for (const tag of [t.propertyName, t.string, t.number, t.bool, t.null, t.punctuation, t.separator]) {
      expect(colorFor(tag)).toBeDefined();
    }
  });
});
