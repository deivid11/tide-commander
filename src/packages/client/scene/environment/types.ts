/**
 * Battlefield Environment Types
 *
 * Type definitions for the battlefield environment system.
 */

import * as THREE from 'three';

/**
 * Time of day phases
 */
export type TimePhase = 'night' | 'dawn' | 'day' | 'dusk';

/**
 * Floor texture styles
 */
export type FloorStyle = 'none' | 'concrete' | 'galactic' | 'metal' | 'hex' | 'circuit';

/**
 * Time-based configuration for the environment
 */
export interface TimeConfig {
  phase: TimePhase;
  sunPosition: THREE.Vector3;
  moonPosition: THREE.Vector3;
  ambientColor: number;
  ambientIntensity: number;
  hemiSkyColor: number;
  hemiGroundColor: number;
  hemiIntensity: number;
  mainLightColor: number;
  mainLightIntensity: number;
  fogColor: number;
  fogDensity: number;
  skyColor: number;
  starsOpacity: number;
  moonOpacity: number;
  sunOpacity: number;
  lampIntensity: number;
  windowEmissive: number;
}

/**
 * Galactic floor state for animations
 */
export interface GalacticState {
  group: THREE.Group;
  stars: THREE.Points | null;
  nebulas: THREE.Mesh[];
  time: number;
}
