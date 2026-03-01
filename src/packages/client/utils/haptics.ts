/**
 * Shared haptics utility for triggering vibration feedback.
 * Works on both Capacitor (APK) and web (navigator.vibrate).
 *
 * Intensity levels:
 *   0 = Off (no vibration)
 *   1 = Light
 *   2 = Medium
 *   3 = Heavy
 */

/** Vibration intensity: 0=off, 1=light, 2=medium, 3=heavy */
export type VibrationIntensity = 0 | 1 | 2 | 3;

// Web vibration durations (ms) — tuned for perceptible differences
const WEB_VIBRATION_MS: Record<VibrationIntensity, number> = {
  0: 0,
  1: 5,
  2: 25,
  3: 50,
};

// Capacitor Haptics — loaded once via dynamic import
let capacitorHaptics: { Haptics: any; ImpactStyle: any } | null = null;
let capacitorLoaded = false;

async function loadCapacitorHaptics() {
  if (capacitorLoaded) return capacitorHaptics;
  capacitorLoaded = true;
  try {
    const mod = await import('@capacitor/haptics');
    capacitorHaptics = { Haptics: mod.Haptics, ImpactStyle: mod.ImpactStyle };
  } catch {
    // Not available (web build)
  }
  return capacitorHaptics;
}

// Eagerly start loading so it's ready by the time first swipe happens
loadCapacitorHaptics();

/**
 * Trigger haptic feedback at the specified intensity.
 * No-op when intensity is 0 (off).
 */
export function triggerHaptic(intensity: VibrationIntensity): void {
  if (intensity === 0) return;

  if (capacitorHaptics) {
    const { Haptics, ImpactStyle } = capacitorHaptics;
    const styleMap: Record<number, string> = { 1: 'Light', 2: 'Medium', 3: 'Heavy' };
    const styleName = styleMap[intensity];
    if (styleName && ImpactStyle[styleName]) {
      Haptics.impact({ style: ImpactStyle[styleName] }).catch(() => {
        if (navigator.vibrate) {
          navigator.vibrate(WEB_VIBRATION_MS[intensity]);
        }
      });
      return;
    }
  }

  // Web fallback
  if (navigator.vibrate) {
    navigator.vibrate(WEB_VIBRATION_MS[intensity]);
  }
}
