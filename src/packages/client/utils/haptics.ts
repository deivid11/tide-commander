/**
 * Shared haptics utility for triggering vibration feedback.
 * Works on both Capacitor (APK) and web (navigator.vibrate).
 *
 * Intensity levels:
 *   0 = Off (no vibration)
 *   1 = Ultra Light
 *   2 = Very Light
 *   3 = Light
 *   4 = Medium
 *   5 = Heavy
 */

/** Vibration intensity: 0=off, 1=ultra light, 2=very light, 3=light, 4=medium, 5=heavy */
export type VibrationIntensity = 0 | 1 | 2 | 3 | 4 | 5;
export const MAX_VIBRATION_INTENSITY: VibrationIntensity = 5;

// Web vibration durations (ms) — tuned for perceptible differences
const WEB_VIBRATION_MS: Record<VibrationIntensity, number> = {
  0: 0,
  1: 4,
  2: 8,
  3: 14,
  4: 25,
  5: 50,
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
export function triggerHaptic(intensityInput: VibrationIntensity | number): void {
  const clamped = Math.round(intensityInput);
  const intensity = (clamped <= 0 ? 0 : clamped >= MAX_VIBRATION_INTENSITY ? MAX_VIBRATION_INTENSITY : clamped) as VibrationIntensity;
  if (intensity === 0) return;

  if (capacitorHaptics) {
    const { Haptics, ImpactStyle } = capacitorHaptics;
    // Capacitor only exposes three impact levels, so map the two lighter
    // intensities to selection haptics for APK while preserving web granularity.
    if (intensity <= 2 && typeof Haptics.selectionChanged === 'function') {
      Haptics.selectionChanged().catch(() => {
        if (navigator.vibrate) {
          navigator.vibrate(WEB_VIBRATION_MS[intensity]);
        }
      });
      return;
    }

    const styleMap: Record<number, string> = { 3: 'Light', 4: 'Medium', 5: 'Heavy' };
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
