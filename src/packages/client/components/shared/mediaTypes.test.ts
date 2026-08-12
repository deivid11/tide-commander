import { describe, expect, it } from 'vitest';
import { isAudioFile, isVideoFile, AUDIO_EXTENSIONS, VIDEO_EXTENSIONS } from './mediaTypes';

describe('media classification', () => {
  it('classifies by the declared extension', () => {
    expect(isAudioFile('.wav')).toBe(true);
    expect(isAudioFile('.WAV')).toBe(true);
    expect(isVideoFile('.mp4')).toBe(true);
    expect(isVideoFile('.wav')).toBe(false);
    expect(isAudioFile('.mp4')).toBe(false);
  });

  it('falls back to the path when no extension is declared', () => {
    expect(isAudioFile(undefined, '/home/riven/d/daisy/synth/build/device-flute-capture-listen.wav')).toBe(true);
    expect(isVideoFile('', 'C:\\captures\\screen-capture-10.MP4')).toBe(true);
    expect(isVideoFile(undefined, '/tmp/notes.txt')).toBe(false);
  });

  it('ignores query strings and fragments on a URL-ish path', () => {
    expect(isVideoFile(undefined, '/api/files/binary?path=/x/clip.mp4')).toBe(false);
    expect(isAudioFile(undefined, '/x/take.wav?v=2#t=10')).toBe(true);
  });

  it('treats a dotfile as having no extension', () => {
    expect(isAudioFile(undefined, '/home/riven/.wav')).toBe(false);
  });

  it('leaves MIDI out — the browser has no synth to play it', () => {
    expect(isAudioFile('.mid')).toBe(false);
    expect(isAudioFile('.midi')).toBe(false);
  });

  it('keeps the two lists disjoint', () => {
    const overlap = (AUDIO_EXTENSIONS as readonly string[]).filter((ext) => (VIDEO_EXTENSIONS as readonly string[]).includes(ext));
    expect(overlap).toEqual([]);
  });
});
