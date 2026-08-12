/**
 * Waveform peak extraction for the audio file viewer.
 *
 * Decoded audio is far too dense to draw sample-per-pixel (a 3 s WAV at 48 kHz
 * is ~144k samples), so it is reduced ONCE to a fixed bucket count and the
 * canvas scales that summary. Peaks are min/max per bucket rather than an
 * average, because averaging flattens transients into a flat line — the exact
 * detail that makes a capture recognizable.
 */

export interface WaveformPeaks {
  /** Per-bucket minimum sample, -1..0. */
  min: Float32Array;
  /** Per-bucket maximum sample, 0..1. */
  max: Float32Array;
}

export const WAVEFORM_BUCKETS = 1200;

/**
 * Reduce channel data (already mixed down to mono) to min/max buckets.
 * Buckets beyond the sample count stay at 0 so short clips draw flat tails
 * rather than reading past the end.
 */
export function computePeaks(samples: Float32Array, buckets = WAVEFORM_BUCKETS): WaveformPeaks {
  const min = new Float32Array(buckets);
  const max = new Float32Array(buckets);
  if (samples.length === 0 || buckets <= 0) return { min, max };

  const perBucket = samples.length / buckets;
  for (let i = 0; i < buckets; i++) {
    const start = Math.floor(i * perBucket);
    const end = Math.min(samples.length, Math.max(start + 1, Math.floor((i + 1) * perBucket)));
    let lo = samples[start];
    let hi = samples[start];
    for (let j = start + 1; j < end; j++) {
      const value = samples[j];
      if (value < lo) lo = value;
      if (value > hi) hi = value;
    }
    min[i] = lo;
    max[i] = hi;
  }
  return { min, max };
}

/**
 * Average every channel into one mono track. Stereo captures whose channels are
 * near-identical would otherwise draw twice for no extra information.
 */
export function mixToMono(channels: Float32Array[]): Float32Array {
  if (channels.length === 0) return new Float32Array(0);
  if (channels.length === 1) return channels[0];

  const length = channels[0].length;
  const mono = new Float32Array(length);
  for (const channel of channels) {
    const usable = Math.min(length, channel.length);
    for (let i = 0; i < usable; i++) mono[i] += channel[i];
  }
  for (let i = 0; i < length; i++) mono[i] /= channels.length;
  return mono;
}

/** mm:ss for anything under an hour, h:mm:ss beyond it. */
export function formatTimecode(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const whole = Math.floor(seconds);
  const s = whole % 60;
  const m = Math.floor(whole / 60) % 60;
  const h = Math.floor(whole / 3600);
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
  return `${h > 0 ? `${h}:` : ''}${mm}:${String(s).padStart(2, '0')}`;
}
