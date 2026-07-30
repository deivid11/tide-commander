import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  NOTIFICATION_TONES,
  DEFAULT_TONES,
  SILENT_TONE_ID,
  getTone,
  isToneSilent,
} from './notificationTones';

const TONE_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../..',
  'public/assets/notification-sounds'
);

describe('NOTIFICATION_TONES', () => {
  it('ships every sampled tone as a real file', () => {
    // A missing file plays nothing (the engine falls back to synth), so the gap
    // is invisible in code review but audible — or rather, inaudible — in use.
    const available = new Set(fs.readdirSync(TONE_DIR));
    const missing = NOTIFICATION_TONES
      .filter((tone) => tone.file && !available.has(tone.file))
      .map((tone) => `${tone.id} -> ${tone.file}`);
    expect(missing).toEqual([]);
  });

  it('has unique ids and a label for each tone', () => {
    const ids = NOTIFICATION_TONES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(NOTIFICATION_TONES.every((t) => t.label.length > 0)).toBe(true);
  });

  it('describes every entry as exactly one of sample, synth cue or silence', () => {
    for (const tone of NOTIFICATION_TONES) {
      const kinds = [tone.file, tone.synth, tone.silent].filter(Boolean).length;
      expect(kinds, `tone "${tone.id}" must have exactly one kind`).toBe(1);
    }
  });

  it('offers a silent option so a single cue can be switched off', () => {
    const none = getTone(SILENT_TONE_ID);
    expect(none?.silent).toBe(true);
    expect(none?.file).toBeUndefined();
    expect(none?.synth).toBeUndefined();
    expect(isToneSilent(SILENT_TONE_ID)).toBe(true);
    // Everything else must still make noise.
    for (const tone of NOTIFICATION_TONES.filter((t) => t.id !== SILENT_TONE_ID)) {
      expect(isToneSilent(tone.id)).toBe(false);
    }
    // An unknown id is not silence — it falls back to the built-in cue.
    expect(isToneSilent('bogus')).toBe(false);
    expect(isToneSilent(undefined)).toBe(false);
  });

  it('keeps every cue audible by default', () => {
    for (const id of Object.values(DEFAULT_TONES)) {
      expect(isToneSilent(id)).toBe(false);
    }
  });

  it('offers a usable library of sampled tones', () => {
    expect(NOTIFICATION_TONES.filter((t) => t.file).length).toBeGreaterThanOrEqual(20);
  });

  it('resolves the per-cue defaults', () => {
    for (const id of Object.values(DEFAULT_TONES)) {
      expect(getTone(id)).toBeDefined();
    }
    expect(getTone('nope')).toBeUndefined();
    expect(getTone(undefined)).toBeUndefined();
  });
});
