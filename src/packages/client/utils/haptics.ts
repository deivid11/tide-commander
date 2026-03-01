/**
 * Shared haptics utility for triggering vibration feedback.
 * Works on both Capacitor (APK) and web (navigator.vibrate).
 *
 * Intensity levels:
 *   0 = Off (no vibration)
 *   1 = Light (8ms web / ImpactStyle.Light)
 *   2 = Medium (15ms web / ImpactStyle.Medium)
 *   3 = Heavy (25ms web / ImpactStyle.Heavy)
 */

// Conditionally import Capacitor Haptics (only available on Android/APK builds)
let Haptics: any;
let ImpactStyle: any;

try {
  Haptics = require('@capacitor/haptics').Haptics;
  ImpactStyle = require('@capacitor/haptics').ImpactStyle;
} catch {
  // Capacitor Haptics not available (web build)
}

/** Vibration intensity: 0=off, 1=light, 2=medium, 3=heavy */
export type VibrationIntensity = 0 | 1 | 2 | 3;

const WEB_VIBRATION_MS: Record<VibrationIntensity, number> = {
  0: 0,
  1: 8,
  2: 15,
  3: 25,
};

const IMPACT_STYLE_NAMES: Record<number, string> = {
  1: 'Light',
  2: 'Medium',
  3: 'Heavy',
};

/**
 * Trigger haptic feedback at the specified intensity.
 * No-op when intensity is 0 (off).
 */
export function triggerHaptic(intensity: VibrationIntensity): void {
  if (intensity === 0) return;

  if (Haptics && ImpactStyle) {
    const styleName = IMPACT_STYLE_NAMES[intensity];
    if (styleName && ImpactStyle[styleName]) {
      Haptics.impact({ style: ImpactStyle[styleName] }).catch(() => {
        if (navigator.vibrate) {
          navigator.vibrate(WEB_VIBRATION_MS[intensity]);
        }
      });
    }
  } else if (navigator.vibrate) {
    navigator.vibrate(WEB_VIBRATION_MS[intensity]);
  }
}
