/**
 * Guard for the Settings search box.
 *
 * Sections are filtered by a shared hand-written keyword index, so every row
 * added to ConfigSection has to be represented there or it silently becomes
 * unreachable from both the panel and Spotlight. This test reads rendered
 * labels from the source and checks them against that shared index.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SETTINGS_SEARCH_SECTIONS, searchSettingsSections } from './settingsSearch';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_SECTION = path.join(HERE, 'ConfigSection.tsx');
const EN_CONFIG = path.resolve(HERE, '../../../../..', 'public/locales/en/config.json');

const source = fs.readFileSync(CONFIG_SECTION, 'utf8');
const enConfig = JSON.parse(fs.readFileSync(EN_CONFIG, 'utf8')) as Record<string, unknown>;

function translate(key: string): string | undefined {
  const value = key.split('.').reduce<unknown>(
    (node, part) => (node && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined),
    enConfig
  );
  return typeof value === 'string' ? value : undefined;
}

/** Rendered labels, attributed to the section block they appear in. */
function parseLabels(): Map<string, Set<string>> {
  const markers = [...source.matchAll(/shouldShowSection\('([a-zA-Z]+)'\)/g)]
    .map((m) => ({ id: m[1], at: m.index ?? 0 }));

  const sectionAt = (index: number): string | null => {
    let current: string | null = null;
    for (const marker of markers) {
      if (marker.at <= index) current = marker.id;
      else break;
    }
    return current;
  };

  const labels = new Map<string, Set<string>>();
  const add = (index: number, text?: string) => {
    const id = sectionAt(index);
    if (!id || !text) return;
    if (!labels.has(id)) labels.set(id, new Set());
    labels.get(id)!.add(text);
  };

  for (const m of source.matchAll(/<HighlightText\s+text="([^"]+)"/g)) add(m.index ?? 0, m[1]);
  for (const m of source.matchAll(/<HighlightText\s+text=\{t\('config:([^']+)'[^}]*\)\}/g)) {
    add(m.index ?? 0, translate(m[1]));
  }
  return labels;
}

// Words too generic to be worth a keyword of their own.
const STOP_WORDS = new Set([
  'the', 'and', 'for', 'with', 'per', 'this', 'that', 'all', 'new', 'your', 'you',
  'when', 'from', 'show', 'use', 'set', 'not', 'only',
]);

describe('settings search', () => {
  const sections = SETTINGS_SEARCH_SECTIONS;
  const labels = parseLabels();

  it('indexes every rendered section', () => {
    const renderedIds = new Set(
      [...source.matchAll(/shouldShowSection\('([a-zA-Z]+)'\)/g)].map((match) => match[1])
    );
    expect([...renderedIds].sort()).toEqual(sections.map((section) => section.id).sort());
    expect([...labels.values()].reduce((count, values) => count + values.size, 0)).toBeGreaterThan(30);
  });

  it('can reach every rendered row through its section keywords', () => {
    const unreachable: string[] = [];

    for (const section of sections) {
      const haystack = [section.title, ...section.keywords].join(' ').toLowerCase();
      for (const label of labels.get(section.id) ?? []) {
        const words = (label.toLowerCase().match(/[a-z0-9]+/g) ?? [])
          .filter((w) => w.length > 2 && !STOP_WORDS.has(w));
        // Typing any significant word of the label must surface its section.
        if (words.length > 0 && words.every((w) => !haystack.includes(w))) {
          unreachable.push(`[${section.id}] "${label}" — add one of: ${words.join(', ')}`);
        }
      }
    }

    expect(unreachable).toEqual([]);
  });

  it('surfaces the notification-sound rows for the obvious queries', () => {
    const matches = (query: string) => searchSettingsSections(query).map((section) => section.id);

    for (const query of ['sound', 'notification', 'volume', 'tone', 'mute', 'audio']) {
      expect(matches(query), `query "${query}" finds no section`).not.toEqual([]);
    }
    expect(matches('sound')).toContain('general');
    expect(matches('tone')).toContain('general');
  });

  it('provides the same section matches for Settings and Spotlight', () => {
    expect(searchSettingsSections('notification sound').map((section) => section.id)).toContain('general');
    expect(searchSettingsSections('gmail').map((section) => section.id)).toContain('integrations');
    expect(searchSettingsSections('wireframe').map((section) => section.id)).toContain('modelStyle');
  });
});
