/**
 * Catalog of selectable notification tones.
 *
 * Two flavours:
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
  /** Filename under assets/notification-sounds. Absent = built-in synth cue. */
  file?: string;
  /** Which built-in cue to synthesize (built-ins only). */
  synth?: 'notification' | 'question' | 'completion';
}

/** Defaults per cue — the synthesized sounds Tide Commander shipped with. */
export const DEFAULT_TONES = {
  notification: 'synth-chime',
  question: 'synth-question',
  completion: 'synth-done',
} as const;

export const NOTIFICATION_TONES: NotificationTone[] = [
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

/** Public URL of a sampled tone (respects the app's base path). */
export function toneAssetUrl(file: string): string {
  return `${import.meta.env.BASE_URL}assets/notification-sounds/${file}`;
}
