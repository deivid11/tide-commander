// Pleasant, synthesized notification sounds (Web Audio API — no binary assets).
//
// Two distinct cues, both designed to be gentle and non-fatiguing:
//   - playQuestionSound():     two taps + an upward pitch bend — used when an agent
//                              asks the user something. The only cue that glides,
//                              so it is unmistakable without being an alarm.
//   - playNotificationSound(): a soft two-note chime — used for general agent
//                              notifications.
//   - playCompletionSound():   a mellow descending arpeggio that resolves to the
//                              tonic — used when an agent finishes its work.
//
// Callers pass a volume LEVEL (0..5). Level 0 is silent, so callers can simply
// forward `settings.notificationSoundEnabled ? settings.notificationSoundVolume : 0`
// without branching. This module never imports the store, keeping it dependency-free.
//
// Each cue can also be swapped for a sampled tone (Settings → Sound Effects):
// callers pass the configured tone id alongside the level, and an unknown id or
// a failed download silently falls back to the synthesized cue.

import { getTone, toneAssetUrl } from './notificationTones';

export const MAX_NOTIFICATION_SOUND_VOLUME = 5;

type SoundKind = 'question' | 'notification' | 'completion';

// Lazily-created shared context. Browsers require a user gesture before audio can
// start; these cues fire after real interactions, and we resume() defensively.
let audioContext: AudioContext | null = null;

// Debounce identical cues so a burst of events can't stack into noise.
const DEBOUNCE_MS = 250;
const lastPlayedAt: Record<SoundKind, number> = { question: 0, notification: 0, completion: 0 };

function getContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  try {
    if (!audioContext) {
      const Ctor: typeof AudioContext | undefined =
        window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      audioContext = new Ctor();
    }
    if (audioContext.state === 'suspended') {
      // Fire-and-forget; if the gesture requirement isn't met yet it stays suspended.
      void audioContext.resume().catch(() => {});
    }
    return audioContext;
  } catch {
    return null;
  }
}

// Map a 0..5 level to a peak gain. Kept well below 1.0 so cues stay pleasant.
function levelToPeak(level: number): number {
  const clamped = Math.max(0, Math.min(MAX_NOTIFICATION_SOUND_VOLUME, Math.round(level)));
  if (clamped <= 0) return 0;
  return 0.06 + (clamped / MAX_NOTIFICATION_SOUND_VOLUME) * 0.26; // ~0.11 .. 0.32
}

interface ToneOptions {
  /** Waveform of the fundamental. Sine is the softest; triangle is slightly reedier. */
  type?: OscillatorType;
  /** Bend the pitch to this frequency over the note — the "questioning" lift. */
  glideTo?: number;
  /** Level of the octave overtone (0 = pure tone). Lower = mellower. */
  overtone?: number;
}

// One softened note: a tone with a warmer octave overtone, shaped by a short
// attack and an exponential decay so it reads as a gentle bell, not a beep.
function playTone(
  ctx: AudioContext,
  freq: number,
  startAt: number,
  duration: number,
  peak: number,
  opts: ToneOptions = {},
): void {
  const { type = 'sine', glideTo, overtone: overtoneLevel = 0.25 } = opts;

  const gain = ctx.createGain();
  gain.connect(ctx.destination);
  gain.gain.setValueAtTime(0.0001, startAt);
  gain.gain.exponentialRampToValueAtTime(peak, startAt + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);

  const fundamental = ctx.createOscillator();
  fundamental.type = type;
  fundamental.frequency.setValueAtTime(freq, startAt);
  fundamental.connect(gain);

  const overtone = ctx.createOscillator();
  overtone.type = 'sine';
  overtone.frequency.setValueAtTime(freq * 2, startAt);
  const overtoneGain = ctx.createGain();
  overtoneGain.gain.value = overtoneLevel;
  overtone.connect(overtoneGain);
  overtoneGain.connect(gain);

  if (glideTo) {
    // Bend late in the note so the pitch is established first, then lifts —
    // that ordering is what makes the ear hear a question rather than a slide.
    const bendStart = startAt + duration * 0.35;
    const bendEnd = startAt + duration * 0.85;
    fundamental.frequency.setValueAtTime(freq, bendStart);
    fundamental.frequency.exponentialRampToValueAtTime(glideTo, bendEnd);
    overtone.frequency.setValueAtTime(freq * 2, bendStart);
    overtone.frequency.exponentialRampToValueAtTime(glideTo * 2, bendEnd);
  }

  fundamental.start(startAt);
  overtone.start(startAt);
  fundamental.stop(startAt + duration + 0.05);
  overtone.stop(startAt + duration + 0.05);
}

// ─── Sampled tones ───────────────────────────────────────────────────────────
// Decoded once per tone and reused; a fetch/decode failure is remembered as
// `null` so a missing file degrades to the synth cue instead of retrying on
// every notification.

const sampleCache = new Map<string, AudioBuffer | null>();
const samplesLoading = new Set<string>();

function loadSample(ctx: AudioContext, file: string): void {
  if (sampleCache.has(file) || samplesLoading.has(file)) return;
  samplesLoading.add(file);
  void fetch(toneAssetUrl(file))
    .then((res) => (res.ok ? res.arrayBuffer() : Promise.reject(new Error(String(res.status)))))
    .then((data) => ctx.decodeAudioData(data))
    .then((buffer) => { sampleCache.set(file, buffer); })
    .catch(() => { sampleCache.set(file, null); })
    .finally(() => { samplesLoading.delete(file); });
}

/**
 * Play a decoded sample. Returns false when the buffer isn't ready yet (the
 * download is kicked off for next time) so the caller can fall back to synth.
 */
function playSample(ctx: AudioContext, file: string, peak: number): boolean {
  const buffer = sampleCache.get(file);
  if (!buffer) {
    loadSample(ctx, file);
    return false;
  }

  const gain = ctx.createGain();
  // Samples are loudness-normalised, so the same 0..5 curve as the synth cues
  // keeps switching tones from changing the perceived volume. The headroom
  // factor accounts for samples peaking higher than a single sine.
  gain.gain.value = Math.min(1, peak * 2.6);
  gain.connect(ctx.destination);

  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.connect(gain);
  source.start();
  return true;
}

/** Warm the decode cache for the tones the user has configured. */
export function preloadTones(toneIds: Array<string | undefined>): void {
  const ctx = getContext();
  if (!ctx) return;
  for (const id of toneIds) {
    const file = getTone(id)?.file;
    if (file) loadSample(ctx, file);
  }
}

function play(kind: SoundKind, level: number, toneId?: string): void {
  const peak = levelToPeak(level);
  if (peak <= 0) return;

  const now = Date.now();
  if (now - lastPlayedAt[kind] < DEBOUNCE_MS) return;
  lastPlayedAt[kind] = now;

  const ctx = getContext();
  if (!ctx) return;

  // A configured tone wins: a sample if it is decoded, otherwise the built-in
  // cue it maps to (or this cue's own default while the sample downloads).
  const tone = getTone(toneId);
  if (tone?.file && playSample(ctx, tone.file, peak)) return;
  if (tone?.synth && tone.synth !== kind) {
    playSynth(tone.synth, peak, ctx);
    return;
  }

  playSynth(kind, peak, ctx);
}

function playSynth(kind: SoundKind, peak: number, ctx: AudioContext): void {

  const t = ctx.currentTime + 0.01;
  if (kind === 'question') {
    // The one cue that must never be mistaken for another. Three traits combine,
    // none of which appear in any other sound:
    //   1. two rising taps a fifth apart (a leap, not a step) — grabs attention
    //   2. a held note that BENDS UP A FOURTH — exaggerated question intonation
    //   3. a fifth-below pedal + a soft echo tail — body and a signature ending
    // It reads as "someone is asking you something", not as an alarm: everything
    // stays in tune, the attack is soft, and loudness never exceeds the others.
    const tap = peak * 0.7;
    playTone(ctx, 587.33, t, 0.11, tap, { type: 'triangle', overtone: 0.18 });        // D5
    playTone(ctx, 880.0, t + 0.11, 0.11, tap, { type: 'triangle', overtone: 0.18 });  // A5 (leap of a 5th)

    // Held, bending note — the signature.
    const holdAt = t + 0.24;
    playTone(ctx, 880.0, holdAt, 0.56, peak, {
      type: 'triangle',
      overtone: 0.2,
      glideTo: 1174.66, // A5 → D6: a full fourth of "lift"
    });
    // Pedal a fifth below gives the hold body so it carries without being louder.
    playTone(ctx, 587.33, holdAt, 0.5, peak * 0.32, { type: 'sine', overtone: 0.1 });
    // Echo that ASKS AGAIN an octave up — the "…right? …right?" tail. Repeating
    // the bend is what makes the cue carry across a room; it adds brightness and
    // length rather than volume, so it stands out without ever sounding harsh.
    playTone(ctx, 1174.66, holdAt + 0.44, 0.46, peak * 0.38, {
      type: 'triangle',
      overtone: 0.12,
      glideTo: 1318.51, // D6 → E6
    });
  } else if (kind === 'completion') {
    // Descending arpeggio resolving to the tonic (G5 → E5 → C5) — a calm "done".
    const soft = peak * 0.85;
    playTone(ctx, 783.99, t, 0.16, soft);
    playTone(ctx, 659.25, t + 0.12, 0.16, soft);
    playTone(ctx, 523.25, t + 0.24, 0.46, soft);
  } else {
    // Soft two-note chime up a fourth (E5 → A5) — gentle "something happened".
    const soft = peak * 0.8;
    playTone(ctx, 659.25, t, 0.16, soft);
    playTone(ctx, 880.0, t + 0.11, 0.34, soft);
  }
}

/**
 * Distinctive "an agent is asking you something" cue: two taps plus an upward
 * pitch bend. Deliberately the only gliding sound in the app.
 */
export function playQuestionSound(level: number, toneId?: string): void {
  play('question', level, toneId);
}

/** Soft chime for general agent notifications. */
export function playNotificationSound(level: number, toneId?: string): void {
  play('notification', level, toneId);
}

/** Mellow resolving cue for when an agent finishes its work (working → idle). */
export function playCompletionSound(level: number, toneId?: string): void {
  play('completion', level, toneId);
}

/**
 * Play a tone on demand for the Settings preview. Bypasses the per-cue debounce
 * so repeated taps on the same row always sound, and awaits the sample so the
 * first preview of a tone isn't silent.
 */
export async function previewTone(toneId: string, level: number): Promise<void> {
  const peak = levelToPeak(level);
  if (peak <= 0) return;
  const ctx = getContext();
  if (!ctx) return;

  const tone = getTone(toneId);
  if (tone?.file) {
    if (!sampleCache.has(tone.file)) {
      loadSample(ctx, tone.file);
      // Give the fetch+decode a moment; the cache entry appears when it settles.
      for (let i = 0; i < 40 && !sampleCache.has(tone.file); i++) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }
    if (playSample(ctx, tone.file, peak)) return;
  }
  playSynth(tone?.synth ?? 'notification', peak, ctx);
}

// ─── Unanswered-question reminder ────────────────────────────────────────────
// A single cue is easy to miss if you stepped away. While a question is still
// waiting, the cue repeats: two hits up front, then one every 10s, giving up
// after 2 minutes so it can never nag indefinitely.

const QUESTION_ALERT_MAX_MS = 2 * 60 * 1000;
const QUESTION_ALERT_INTERVAL_MS = 10_000;
/** Gap between the two opening hits — clearly a pair, not one long sound. */
const QUESTION_ALERT_PAIR_GAP_MS = 800;

let alertTimer: number | null = null;
let alertDeadline = 0;
let getAlertLevel: (() => number) | null = null;
let getAlertTone: (() => string | undefined) | null = null;
let questionsStillPending: (() => boolean) | null = null;

function fireAlert(pair: boolean): void {
  const level = getAlertLevel?.() ?? 0;
  if (level <= 0) return;
  play('question', level, getAlertTone?.());
  if (pair) {
    window.setTimeout(() => {
      // Skip the second hit if the user answered in the meantime.
      if (questionsStillPending?.()) play('question', getAlertLevel?.() ?? 0, getAlertTone?.());
    }, QUESTION_ALERT_PAIR_GAP_MS);
  }
}

function tickAlert(): void {
  if (!questionsStillPending?.() || Date.now() >= alertDeadline) {
    stopQuestionAlert();
    return;
  }
  fireAlert(false);
}

/**
 * Start (or restart) the repeating alert for an unanswered agent question.
 *
 * @param level         reads the current volume level, so a settings change applies mid-alert
 * @param stillPending  checked before every repeat; the alert stops as soon as it returns false
 * @param tone          reads the configured question tone, so it can be changed mid-alert too
 */
export function startQuestionAlert(
  level: () => number,
  stillPending: () => boolean,
  tone?: () => string | undefined,
): void {
  getAlertLevel = level;
  getAlertTone = tone ?? null;
  questionsStillPending = stillPending;
  // A newly arrived question restarts the 2-minute window.
  alertDeadline = Date.now() + QUESTION_ALERT_MAX_MS;

  fireAlert(true);

  if (alertTimer === null) {
    alertTimer = window.setInterval(tickAlert, QUESTION_ALERT_INTERVAL_MS);
  }
}

/** Stop the repeating alert (question answered, or the window elapsed). */
export function stopQuestionAlert(): void {
  if (alertTimer !== null) {
    window.clearInterval(alertTimer);
    alertTimer = null;
  }
  getAlertLevel = null;
  getAlertTone = null;
  questionsStillPending = null;
}
