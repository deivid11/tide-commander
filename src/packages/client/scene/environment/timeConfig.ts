/**
 * Time Configuration
 *
 * Day/night cycle configuration and interpolation.
 */

import * as THREE from 'three';
import type { TimeConfig, TimePhase } from './types';

/**
 * Get dawn configuration.
 */
export function getDawnConfig(): TimeConfig {
  return {
    phase: 'dawn',
    sunPosition: new THREE.Vector3(50, 10, -60), // Sun low on horizon
    moonPosition: new THREE.Vector3(-40, 15, -50), // Moon setting
    ambientColor: 0xffaa77, // Warm orange ambient
    ambientIntensity: 0.5,
    hemiSkyColor: 0xff8844, // Orange sky from above
    hemiGroundColor: 0x553322, // Warm ground reflection
    hemiIntensity: 0.6,
    mainLightColor: 0xffcc66, // Golden sunlight
    mainLightIntensity: 0.9,
    fogColor: 0xffbb88, // Orange/peach fog
    fogDensity: 0.008,
    skyColor: 0xff9966, // Orange/coral sky
    starsOpacity: 0.2, // Few stars still visible
    moonOpacity: 0.3, // Moon fading
    sunOpacity: 0.9, // Sun rising
    lampIntensity: 0.3, // Lamps dimming
    windowEmissive: 0.3,
  };
}

/**
 * Get dusk configuration.
 */
export function getDuskConfig(): TimeConfig {
  return {
    phase: 'dusk',
    sunPosition: new THREE.Vector3(-50, 8, -60), // Sun setting on opposite side
    moonPosition: new THREE.Vector3(40, 12, -50), // Moon rising
    ambientColor: 0xff7755, // Warm red-orange ambient
    ambientIntensity: 0.45,
    hemiSkyColor: 0xff6633, // Deep orange sky
    hemiGroundColor: 0x442222, // Dark warm ground
    hemiIntensity: 0.5,
    mainLightColor: 0xff9944, // Deep golden sunlight
    mainLightIntensity: 0.7,
    fogColor: 0xdd7766, // Red-orange fog
    fogDensity: 0.01,
    skyColor: 0xff7744, // Deep orange sky
    starsOpacity: 0.3, // Stars appearing
    moonOpacity: 0.4, // Moon appearing
    sunOpacity: 0.8, // Sun setting
    lampIntensity: 1.0, // Lamps turning on
    windowEmissive: 0.5,
  };
}

/**
 * Get night configuration.
 */
export function getNightConfig(): TimeConfig {
  return {
    phase: 'night',
    sunPosition: new THREE.Vector3(30, -20, -50),
    moonPosition: new THREE.Vector3(-30, 35, -50),
    ambientColor: 0x334466,
    ambientIntensity: 0.3,
    hemiSkyColor: 0x223344,
    hemiGroundColor: 0x111122,
    hemiIntensity: 0.4,
    mainLightColor: 0xaabbff,
    mainLightIntensity: 0.6,
    fogColor: 0x101020,
    fogDensity: 0.012,
    skyColor: 0x080810,
    starsOpacity: 0.9,
    moonOpacity: 1.0,
    sunOpacity: 0,
    lampIntensity: 2.0,
    windowEmissive: 0.8,
  };
}

/**
 * Get day configuration.
 */
export function getDayConfig(): TimeConfig {
  return {
    phase: 'day',
    sunPosition: new THREE.Vector3(30, 50, -30),
    moonPosition: new THREE.Vector3(-30, -20, -50),
    ambientColor: 0xffffff,
    ambientIntensity: 0.7,
    hemiSkyColor: 0x87ceeb,
    hemiGroundColor: 0x555544,
    hemiIntensity: 0.8,
    mainLightColor: 0xffffee,
    mainLightIntensity: 1.2,
    fogColor: 0xc8d8e8,
    fogDensity: 0.005,
    skyColor: 0x87ceeb,
    starsOpacity: 0,
    moonOpacity: 0,
    sunOpacity: 1.0,
    lampIntensity: 0,
    windowEmissive: 0.1,
  };
}

/**
 * Interpolate between two time configurations.
 */
export function interpolateConfig(from: TimeConfig, to: TimeConfig, t: number, phase: TimePhase): TimeConfig {
  const lerp = (a: number, b: number) => a + (b - a) * t;
  const lerpColor = (a: number, b: number) => {
    const ar = (a >> 16) & 0xff, ag = (a >> 8) & 0xff, ab = a & 0xff;
    const br = (b >> 16) & 0xff, bg = (b >> 8) & 0xff, bb = b & 0xff;
    const r = Math.round(lerp(ar, br));
    const g = Math.round(lerp(ag, bg));
    const blue = Math.round(lerp(ab, bb));
    return (r << 16) | (g << 8) | blue;
  };

  return {
    phase,
    sunPosition: new THREE.Vector3().lerpVectors(from.sunPosition, to.sunPosition, t),
    moonPosition: new THREE.Vector3().lerpVectors(from.moonPosition, to.moonPosition, t),
    ambientColor: lerpColor(from.ambientColor, to.ambientColor),
    ambientIntensity: lerp(from.ambientIntensity, to.ambientIntensity),
    hemiSkyColor: lerpColor(from.hemiSkyColor, to.hemiSkyColor),
    hemiGroundColor: lerpColor(from.hemiGroundColor, to.hemiGroundColor),
    hemiIntensity: lerp(from.hemiIntensity, to.hemiIntensity),
    mainLightColor: lerpColor(from.mainLightColor, to.mainLightColor),
    mainLightIntensity: lerp(from.mainLightIntensity, to.mainLightIntensity),
    fogColor: lerpColor(from.fogColor, to.fogColor),
    fogDensity: lerp(from.fogDensity, to.fogDensity),
    skyColor: lerpColor(from.skyColor, to.skyColor),
    starsOpacity: lerp(from.starsOpacity, to.starsOpacity),
    moonOpacity: lerp(from.moonOpacity, to.moonOpacity),
    sunOpacity: lerp(from.sunOpacity, to.sunOpacity),
    lampIntensity: lerp(from.lampIntensity, to.lampIntensity),
    windowEmissive: lerp(from.windowEmissive, to.windowEmissive),
  };
}

/**
 * Get the time configuration based on current hour.
 */
export function getTimeConfig(hour: number): TimeConfig {
  // Define time phases
  // Night: 21:00 - 5:00
  // Dawn: 5:00 - 7:00
  // Day: 7:00 - 18:00
  // Dusk: 18:00 - 21:00

  if (hour >= 5 && hour < 6) {
    // Early dawn - night to sunrise peak
    const t = hour - 5; // 0 to 1
    return interpolateConfig(getNightConfig(), getDawnConfig(), t, 'dawn');
  } else if (hour >= 6 && hour < 7) {
    // Late dawn - sunrise peak to day
    const t = hour - 6; // 0 to 1
    return interpolateConfig(getDawnConfig(), getDayConfig(), t, 'dawn');
  } else if (hour >= 7 && hour < 18) {
    // Day
    return getDayConfig();
  } else if (hour >= 18 && hour < 19.5) {
    // Early dusk - day to sunset peak
    const t = (hour - 18) / 1.5; // 0 to 1
    return interpolateConfig(getDayConfig(), getDuskConfig(), t, 'dusk');
  } else if (hour >= 19.5 && hour < 21) {
    // Late dusk - sunset peak to night
    const t = (hour - 19.5) / 1.5; // 0 to 1
    return interpolateConfig(getDuskConfig(), getNightConfig(), t, 'dusk');
  } else {
    // Night (21:00 - 5:00)
    return getNightConfig();
  }
}
