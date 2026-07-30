/**
 * Catalog of selectable notification tones.
 *
 * Three flavours:
 *   - `none`     — silence, so a single cue can be switched off while the
 *                  others keep playing.
 *   - `synth-*`  — the built-in Web Audio cues (no asset, always available).
 *   - sampled    — files under public/assets/notification-sounds (Kenney's
 *                  "Interface Sounds" pack, CC0; see CREDITS.md there).
 *
 * Pure data, no DOM/Web Audio, so both the sound engine and the settings UI can
 * import it freely.
 */

export interface NotificationTone {
  id: string;
  label: string;
  /** Filename under assets/notification-sounds. */
  file?: string;
  /** Which built-in cue to synthesize. */
  synth?: 'notification' | 'question' | 'completion';
  /** Play nothing at all — this cue is switched off. */
  silent?: boolean;
}

/** Id of the "play nothing" option. */
export const SILENT_TONE_ID = 'none';

/**
 * Id meaning "play the file the user uploaded for this event". Not a catalog
 * entry — the settings UI injects it as an option only for events that actually
 * have an upload, and the engine resolves it through the custom-sound map.
 */
export const CUSTOM_TONE_ID = 'custom';

/** Defaults per cue — the synthesized sounds Tide Commander shipped with. */
export const DEFAULT_TONES = {
  notification: 'synth-chime',
  question: 'synth-question',
  completion: 'synth-done',
} as const;

export const NOTIFICATION_TONES: NotificationTone[] = [
  { id: SILENT_TONE_ID, label: 'None (silent)', silent: true },

  { id: 'synth-chime', label: 'Built-in · Chime', synth: 'notification' },
  { id: 'synth-question', label: 'Built-in · Question', synth: 'question' },
  { id: 'synth-done', label: 'Built-in · Done', synth: 'completion' },

  { id: 'chime', label: 'Chime', file: 'chime.mp3' },
  { id: 'chime-soft', label: 'Chime Soft', file: 'chime-soft.mp3' },
  { id: 'chime-double', label: 'Chime Double', file: 'chime-double.mp3' },
  { id: 'bell', label: 'Bell', file: 'bell.mp3' },
  { id: 'glass', label: 'Glass', file: 'glass.mp3' },
  { id: 'glass-tap', label: 'Glass Tap', file: 'glass-tap.mp3' },
  { id: 'pluck', label: 'Pluck', file: 'pluck.mp3' },
  { id: 'drop', label: 'Drop', file: 'drop.mp3' },
  { id: 'drop-soft', label: 'Drop Soft', file: 'drop-soft.mp3' },
  { id: 'question', label: 'Question', file: 'question.mp3' },
  { id: 'question-soft', label: 'Question Soft', file: 'question-soft.mp3' },
  { id: 'question-bright', label: 'Question Bright', file: 'question-bright.mp3' },
  { id: 'blip', label: 'Blip', file: 'blip.mp3' },
  { id: 'blip-soft', label: 'Blip Soft', file: 'blip-soft.mp3' },
  { id: 'switch', label: 'Switch', file: 'switch.mp3' },
  { id: 'switch-soft', label: 'Switch Soft', file: 'switch-soft.mp3' },
  { id: 'alert', label: 'Alert', file: 'alert.mp3' },
  { id: 'alert-low', label: 'Alert Low', file: 'alert-low.mp3' },
  { id: 'pop', label: 'Pop', file: 'pop.mp3' },
  { id: 'tick', label: 'Tick', file: 'tick.mp3' },
];

const BY_ID = new Map(NOTIFICATION_TONES.map((tone) => [tone.id, tone]));

export function getTone(id: string | undefined): NotificationTone | undefined {
  return id ? BY_ID.get(id) : undefined;
}

/** True when this cue is configured to play nothing. */
export function isToneSilent(id: string | undefined): boolean {
  return getTone(id)?.silent === true;
}

/** Public URL of a sampled tone (respects the app's base path). */
export function toneAssetUrl(file: string): string {
  return `${import.meta.env.BASE_URL}assets/notification-sounds/${file}`;
}
