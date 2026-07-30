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
// Any cue can be replaced by a user-uploaded file (Settings → General). When a
// custom sound is set for an event it wins over everything else; removing it
// falls back to the configured tone, and then to the synthesized cue.
//
// Callers pass a volume LEVEL (0..10). Level 0 is silent, so callers can simply
// forward `settings.notificationSoundEnabled ? settings.notificationSoundVolume : 0`
// without branching. This module never imports the store, keeping it dependency-free.
//
// Each cue can also be swapped for a sampled tone (Settings → Sound Effects):
// callers pass the configured tone id alongside the level, and an unknown id or
// a failed download silently falls back to the synthesized cue.

import { CUSTOM_TONE_ID, getTone, isToneSilent, toneAssetUrl } from './notificationTones';

export const MAX_NOTIFICATION_SOUND_VOLUME = 10;

export type SoundKind = 'question' | 'notification' | 'completion';

export const SOUND_KINDS: SoundKind[] = ['question', 'notification', 'completion'];

/** User-uploaded audio per event, or null to use the built-in synthesized cue. */
type CustomSoundMap = Partial<Record<SoundKind, string | null>>;
let customSounds: CustomSoundMap = {};

/**
 * Point one or more events at user-uploaded audio. Pass null/undefined for an
 * event to restore its built-in cue. Called after loading or changing settings.
 */
export function setCustomSounds(map: CustomSoundMap): void {
  customSounds = { ...customSounds, ...map };
}

export function getCustomSounds(): CustomSoundMap {
  return customSounds;
}

/**
 * Pull the uploaded-sound map from the server. Custom sounds live server-side so
 * they apply on every device that connects to this commander, not just the
 * browser that uploaded them. Safe to call repeatedly (e.g. after an upload).
 */
export async function refreshCustomSounds(): Promise<CustomSoundMap> {
  try {
    const { apiUrl, authFetch } = await import('./storage');
    const res = await authFetch(apiUrl('/api/custom-sounds'));
    if (!res.ok) return customSounds;
    const data = (await res.json()) as { sounds?: CustomSoundMap };
    // Absolute URLs so playback works from any client origin.
    const resolved: CustomSoundMap = {};
    for (const kind of SOUND_KINDS) {
      const value = data.sounds?.[kind];
      resolved[kind] = value ? apiUrl(value) : null;
    }
    customSounds = resolved;
  } catch {
    // Server unreachable — keep whatever we already had and use built-ins.
  }
  return customSounds;
}

/**
 * Play a user-uploaded file. Returns false when there is nothing to play, so the
 * caller can fall back to the synthesized cue (also covers a broken/missing file).
 */
function playCustom(kind: SoundKind, level: number, onFailure: () => void): boolean {
  const url = customSounds[kind];
  if (!url || typeof Audio === 'undefined') return false;
  try {
    const audio = new Audio(url);
    // Same curve as the bundled tones so an uploaded file sits at the same
    // loudness as everything else on the 0..10 scale.
    audio.volume = Math.max(0, Math.min(1, sampleGainForLevel(level)));
    void audio.play().catch(() => {
      // Missing/corrupt file, unsupported codec, autoplay blocked: nothing was
      // heard, so fall back to the built-in cue rather than going silent.
      onFailure();
    });
    return true;
  } catch {
    return false;
  }
}

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

/**
 * Volume curves, indexed by level (0 = silent, 10 = loudest).
 *
 * Levels 1..5 are exactly the old five-step scale, so a stored setting keeps the
 * loudness it always had; 6..10 are the new headroom above the previous ceiling.
 * Two curves because the sources differ: the synth cue is a couple of sine
 * oscillators (needs a low peak to stay clean), while the sampled tones are
 * loudness-normalised files that are already close to full scale.
 */
const SYNTH_PEAKS = [0, 0.112, 0.164, 0.216, 0.268, 0.32, 0.40, 0.48, 0.57, 0.66, 0.78];
const SAMPLE_GAINS = [0, 0.29, 0.43, 0.56, 0.70, 0.83, 0.88, 0.92, 0.95, 0.98, 1.0];

function clampLevel(level: number): number {
  if (!Number.isFinite(level)) return 0;
  return Math.max(0, Math.min(MAX_NOTIFICATION_SOUND_VOLUME, Math.round(level)));
}

/** Peak gain for the synthesized cues. 0 means silent. */
export function synthPeakForLevel(level: number): number {
  return SYNTH_PEAKS[clampLevel(level)];
}

/** Playback gain for a sampled tone. 0 means silent. */
export function sampleGainForLevel(level: number): number {
  return SAMPLE_GAINS[clampLevel(level)];
}

interface ToneOptions {
  /** Waveform of the fundamental. Sine is the softest; triangle is slightly reedier. */
  type?: OscillatorType;
  /** Bend the pitch to this frequency over the note — the "questioning" lift. */
  glideTo?: number;
  /** Level of the octave overtone (0 = pure tone). Lower = mellower. */
  overtone?: number;
  /** Level of the noise transient (the "mallet"). 0 removes it. */
  strike?: number;
  /** Brightness of the lowpass, in Hz. Lower = darker, woodier. */
  tone?: number;
}

/**
 * Partials of a struck bar (marimba/celesta-like), as ratios of the fundamental.
 *
 * Real struck instruments are INHARMONIC — their partials are not exact multiples
 * of the fundamental — and their upper partials die away much faster than the body
 * of the note. Exact octaves decaying at the same rate is precisely what makes
 * plain oscillator tones read as "electronic beep". These ratios and per-partial
 * decays are what give the cues an acoustic, wooden character instead.
 */
const STRUCK_PARTIALS: Array<{ ratio: number; gain: number; decay: number }> = [
  { ratio: 1, gain: 1, decay: 1 },
  { ratio: 2.005, gain: 0.2, decay: 0.55 }, // detuned octave → gentle shimmer
  { ratio: 3.01, gain: 0.07, decay: 0.32 },
  { ratio: 5.43, gain: 0.03, decay: 0.16 }, // inharmonic sparkle, very short
];

/**
 * A short burst of decaying noise at onset — the sound of the mallet meeting the
 * bar. Adding this transient is the single biggest step from "synth beep" to
 * "something was physically struck".
 */
function playStrike(ctx: AudioContext, freq: number, startAt: number, peak: number, amount: number): void {
  const duration = 0.045;
  const frames = Math.max(1, Math.ceil(ctx.sampleRate * duration));
  const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < frames; i++) {
    const fade = 1 - i / frames;
    data[i] = (Math.random() * 2 - 1) * fade * fade * fade; // fast cubic decay
  }

  const source = ctx.createBufferSource();
  source.buffer = buffer;

  // Centre the noise around the note so the click belongs to the pitch.
  const band = ctx.createBiquadFilter();
  band.type = 'bandpass';
  band.frequency.value = Math.min(freq * 2.5, 6000);
  band.Q.value = 0.7;

  const gain = ctx.createGain();
  gain.gain.value = peak * amount;

  source.connect(band);
  band.connect(gain);
  gain.connect(ctx.destination);
  source.start(startAt);
}

// One note of a struck-bar instrument: a mallet transient plus inharmonic
// partials that each decay at their own rate, rolled off by a gentle lowpass.
function playTone(
  ctx: AudioContext,
  freq: number,
  startAt: number,
  duration: number,
  peak: number,
  opts: ToneOptions = {},
): void {
  const { type = 'sine', glideTo, overtone: overtoneLevel = 0.25, strike = 0.5, tone = 3800 } = opts;

  // Shared lowpass keeps the upper partials from ever sounding brittle.
  const lowpass = ctx.createBiquadFilter();
  lowpass.type = 'lowpass';
  lowpass.frequency.value = tone;
  lowpass.Q.value = 0.4;
  lowpass.connect(ctx.destination);

  if (strike > 0) playStrike(ctx, freq, startAt, peak, strike);

  STRUCK_PARTIALS.forEach((partial, index) => {
    // `overtone` scales everything above the fundamental, so existing callers
    // keep their "how much overtone" control.
    const level = index === 0 ? partial.gain : partial.gain * (overtoneLevel / 0.25);
    if (level <= 0.001) return;

    // Higher partials fade early, exactly as they do on a real bar.
    const partialDuration = Math.max(0.05, duration * partial.decay);

    const gain = ctx.createGain();
    gain.connect(lowpass);
    gain.gain.setValueAtTime(0.0001, startAt);
    // A hair slower than an instant attack — instantaneous onsets sound clicky
    // and mechanical; ~10ms reads as a soft mallet.
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak * level), startAt + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, startAt + partialDuration);

    const osc = ctx.createOscillator();
    osc.type = index === 0 ? type : 'sine';
    osc.frequency.setValueAtTime(freq * partial.ratio, startAt);
    osc.connect(gain);

    if (glideTo) {
      // Bend late in the note so the pitch is established first, then lifts —
      // that ordering is what makes the ear hear a question rather than a slide.
      const bendStart = startAt + duration * 0.35;
      const bendEnd = startAt + duration * 0.85;
      osc.frequency.setValueAtTime(freq * partial.ratio, bendStart);
      osc.frequency.exponentialRampToValueAtTime(glideTo * partial.ratio, bendEnd);
    }

    osc.start(startAt);
    osc.stop(startAt + partialDuration + 0.05);
  });
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
function playSample(ctx: AudioContext, file: string, gainValue: number): boolean {
  const buffer = sampleCache.get(file);
  if (!buffer) {
    loadSample(ctx, file);
    return false;
  }

  const gain = ctx.createGain();
  // Samples are loudness-normalised, so SAMPLE_GAINS is tuned to match the
  // perceived loudness of the synth cues at the same level — switching tones
  // shouldn't change how loud a notification feels.
  gain.gain.value = Math.min(1, gainValue);
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
  // This cue is switched off — other cues keep their sound.
  if (isToneSilent(toneId)) return;

  const peak = synthPeakForLevel(level);
  if (peak <= 0) return;

  const now = Date.now();
  if (now - lastPlayedAt[kind] < DEBOUNCE_MS) return;
  lastPlayedAt[kind] = now;

  // The tone picked for this event decides what plays: the user's uploaded file
  // ("custom"), a bundled tone, or the built-in cue. An upload that can't play
  // (bad codec, deleted file, autoplay blocked) falls back to the built-in cue
  // rather than going silent.
  if (toneId === CUSTOM_TONE_ID) {
    if (playCustom(kind, level, () => playBuiltInCue(kind, peak))) return;
    playBuiltInCue(kind, peak);
    return;
  }

  playConfigured(kind, level, peak, toneId);
}

/** This event's built-in cue, used when an upload fails to play. */
function playBuiltInCue(kind: SoundKind, peak: number): void {
  const ctx = getContext();
  if (ctx) playSynth(kind, peak, ctx);
}

/** The tone configured for this event, falling back to its built-in cue. */
function playConfigured(kind: SoundKind, level: number, peak: number, toneId?: string): void {
  const ctx = getContext();
  if (!ctx) return;

  const tone = getTone(toneId);
  if (tone?.file && playSample(ctx, tone.file, sampleGainForLevel(level))) return;
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
    playTone(ctx, 587.33, t, 0.5, tap, { overtone: 0.2, strike: 0.6, tone: 3200 });        // D5
    playTone(ctx, 880.0, t + 0.11, 0.5, tap, { overtone: 0.2, strike: 0.6, tone: 3400 });  // A5 (leap of a 5th)

    // Held, bending note — the signature. Rings on well past the taps.
    const holdAt = t + 0.24;
    playTone(ctx, 880.0, holdAt, 1.05, peak, {
      overtone: 0.22,
      strike: 0.45,
      tone: 3600,
      glideTo: 1174.66, // A5 → D6: a full fourth of "lift"
    });
    // Pedal a fifth below gives the hold body so it carries without being louder.
    // No strike here — it is the resonance under the note, not a second mallet.
    playTone(ctx, 587.33, holdAt, 1.1, peak * 0.3, { overtone: 0.1, strike: 0, tone: 2200 });
    // Echo that ASKS AGAIN an octave up — the "…right? …right?" tail. Repeating
    // the bend is what makes the cue carry across a room; it adds brightness and
    // length rather than volume, so it stands out without ever sounding harsh.
    playTone(ctx, 1174.66, holdAt + 0.44, 0.9, peak * 0.36, {
      overtone: 0.12,
      strike: 0.35,
      tone: 4200,
      glideTo: 1318.51, // D6 → E6
    });
  } else if (kind === 'completion') {
    // Descending arpeggio resolving to the tonic (G5 → E5 → C5) — a calm "done".
    const soft = peak * 0.85;
    playTone(ctx, 783.99, t, 0.55, soft, { strike: 0.5, tone: 3000 });
    playTone(ctx, 659.25, t + 0.12, 0.6, soft, { strike: 0.5, tone: 2900 });
    playTone(ctx, 523.25, t + 0.24, 1.2, soft, { strike: 0.45, tone: 2600 });
  } else {
    // Soft two-note chime up a fourth (E5 → A5) — gentle "something happened".
    const soft = peak * 0.8;
    playTone(ctx, 659.25, t, 0.5, soft, { strike: 0.5, tone: 3000 });
    playTone(ctx, 880.0, t + 0.11, 1.0, soft, { strike: 0.45, tone: 3200 });
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
export async function previewTone(toneId: string, level: number, kind: SoundKind = 'notification'): Promise<void> {
  if (isToneSilent(toneId)) return;
  const peak = synthPeakForLevel(level);
  if (peak <= 0) return;

  if (toneId === CUSTOM_TONE_ID) {
    if (!playCustom(kind, level, () => playBuiltInCue(kind, peak))) playBuiltInCue(kind, peak);
    return;
  }

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
    if (playSample(ctx, tone.file, sampleGainForLevel(level))) return;
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
  // Question cue set to None: no alert to arm, and nothing to stop later.
  if (isToneSilent(tone?.())) return;

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
