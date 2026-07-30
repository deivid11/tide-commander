import { describe, it, expect } from 'vitest';
import {
  MAX_NOTIFICATION_SOUND_VOLUME,
  synthPeakForLevel,
  sampleGainForLevel,
} from './notificationSounds';

/** Loudness of the five-step scale this setting used to have. */
const LEGACY_SYNTH_PEAKS = [0, 0.112, 0.164, 0.216, 0.268, 0.32];

describe('notification volume levels', () => {
  it('offers ten steps plus silence', () => {
    expect(MAX_NOTIFICATION_SOUND_VOLUME).toBe(10);
  });

  it('keeps level 0 silent for both sources', () => {
    expect(synthPeakForLevel(0)).toBe(0);
    expect(sampleGainForLevel(0)).toBe(0);
  });

  it('preserves the loudness of the original 1..5 levels', () => {
    // Stored settings predate the wider scale — the same number must still
    // sound the same, otherwise everyone's volume silently jumps on upgrade.
    for (let level = 1; level <= 5; level++) {
      expect(synthPeakForLevel(level)).toBeCloseTo(LEGACY_SYNTH_PEAKS[level], 5);
    }
  });

  it('adds headroom above the old ceiling', () => {
    expect(synthPeakForLevel(10)).toBeGreaterThan(synthPeakForLevel(5));
    expect(sampleGainForLevel(10)).toBeGreaterThan(sampleGainForLevel(5));
    expect(sampleGainForLevel(10)).toBeLessThanOrEqual(1);
  });

  it('rises monotonically across the whole scale', () => {
    for (let level = 1; level <= MAX_NOTIFICATION_SOUND_VOLUME; level++) {
      expect(synthPeakForLevel(level)).toBeGreaterThan(synthPeakForLevel(level - 1));
      expect(sampleGainForLevel(level)).toBeGreaterThan(sampleGainForLevel(level - 1));
    }
  });

  it('clamps out-of-range, fractional and bogus levels', () => {
    expect(synthPeakForLevel(-3)).toBe(0);
    expect(synthPeakForLevel(99)).toBe(synthPeakForLevel(MAX_NOTIFICATION_SOUND_VOLUME));
    expect(sampleGainForLevel(99)).toBe(sampleGainForLevel(MAX_NOTIFICATION_SOUND_VOLUME));
    expect(synthPeakForLevel(6.4)).toBe(synthPeakForLevel(6));
    expect(synthPeakForLevel(Number.NaN)).toBe(0);
  });
});
