/**
 * Time Configuration
 *
 * Day/night cycle configuration and interpolation.
 */

import * as THREE from 'three';
import type { TimeConfig, TimePhase } from './types';

// Pooled Vector3 instances for interpolation to avoid allocations
const pooledSunPos = new THREE.Vector3();
const pooledMoonPos = new THREE.Vector3();

/**
 * Get dawn configuration.
 */
export function getDawnConfig(): TimeConfig {
  return {
    phase: 'dawn',
    sunPosition: new THREE.Vector3(50, 10, -60), // Sun low on horizon
    moonPosition: new THREE.Vector3(-40, 15, -50), // Moon setting
    ambientColor: 0x99bbdd, // Brighter ambient
    ambientIntensity: 0.6, // Increased from 0.5
    hemiSkyColor: 0x6699cc, // Brighter sky
    hemiGroundColor: 0x445566,
    hemiIntensity: 0.75, // Increased from 0.6
    mainLightColor: 0xbbddff, // Brighter sunlight
    mainLightIntensity: 1.1, // Increased from 0.9
    fogColor: 0x4477aa, // Blue fog
    fogDensity: 0.008,
    skyColor: 0x3366aa, // Blue dawn sky
    starsOpacity: 0.2, // Few stars still visible
    moonOpacity: 0.3, // Moon fading
    sunOpacity: 0.9, // Sun rising
    lampIntensity: 0.5, // Slightly brighter lamps
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
    ambientColor: 0x7788bb, // Brighter ambient
    ambientIntensity: 0.55, // Increased from 0.45
    hemiSkyColor: 0x4466bb, // Brighter sky
    hemiGroundColor: 0x334455,
    hemiIntensity: 0.65, // Increased from 0.5
    mainLightColor: 0x99bbee, // Brighter light
    mainLightIntensity: 0.9, // Increased from 0.7
    fogColor: 0x2244aa, // Blue-purple fog
    fogDensity: 0.01,
    skyColor: 0x2244aa, // Deep blue dusk sky
    starsOpacity: 0.3, // Stars appearing
    moonOpacity: 0.4, // Moon appearing
    sunOpacity: 0.8, // Sun setting
    lampIntensity: 1.5, // Increased lamp brightness
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
    ambientColor: 0x5566aa, // Brighter ambient for better model visibility
    ambientIntensity: 0.5, // Increased from 0.3
    hemiSkyColor: 0x334477, // Brighter sky color
    hemiGroundColor: 0x222244,
    hemiIntensity: 0.6, // Increased from 0.4
    mainLightColor: 0xccddff, // Brighter moonlight
    mainLightIntensity: 0.9, // Increased from 0.6
    fogColor: 0x0a1a2a,
    fogDensity: 0.012,
    skyColor: 0x0a1a2a, // Dark blue
    starsOpacity: 0.9,
    moonOpacity: 1.0,
    sunOpacity: 0,
    lampIntensity: 2.5, // Increased lamp brightness
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
    ambientIntensity: 0.85, // Increased from 0.7
    hemiSkyColor: 0x5aa0e9, // Slightly brighter
    hemiGroundColor: 0x556677,
    hemiIntensity: 1.0, // Increased from 0.8
    mainLightColor: 0xffffee,
    mainLightIntensity: 1.5, // Increased from 1.2
    fogColor: 0x6aa8e0,
    fogDensity: 0.005,
    skyColor: 0x4a90d9, // Blue sky
    starsOpacity: 0,
    moonOpacity: 0,
    sunOpacity: 1.0,
    lampIntensity: 0,
    windowEmissive: 0.1,
  };
}

/**
 * Interpolate between two time configurations.
 * Uses pooled Vector3 instances to avoid allocations in the render loop.
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

  // Use pooled vectors to avoid allocations - caller uses .copy() to read values
  pooledSunPos.lerpVectors(from.sunPosition, to.sunPosition, t);
  pooledMoonPos.lerpVectors(from.moonPosition, to.moonPosition, t);

  return {
    phase,
    sunPosition: pooledSunPos,
    moonPosition: pooledMoonPos,
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
