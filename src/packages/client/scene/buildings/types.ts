/**
 * Building Manager Types and Constants
 *
 * Shared types, interfaces, and color palettes for building rendering.
 */

import * as THREE from 'three';
import type { BuildingStatus, BuildingStyle } from '../../../shared/types';

/**
 * Building mesh data structure
 */
export interface BuildingMeshData {
  group: THREE.Group;
  statusLight: THREE.Mesh;
  label: THREE.Sprite;
}

/**
 * Status colors for building lights
 */
export const STATUS_COLORS: Record<BuildingStatus, number> = {
  running: 0x4aff9e,   // Green
  stopped: 0x888888,   // Gray
  error: 0xff4a4a,     // Red
  unknown: 0xffaa00,   // Orange
  starting: 0x4a9eff,  // Blue
  stopping: 0xffaa00,  // Orange
};

/**
 * Color palettes for each building style - vibrant and distinct
 */
export const STYLE_PALETTES: Record<BuildingStyle, {
  primary: number;
  secondary: number;
  accent: number;
  glow: number;
}> = {
  'server-rack': {
    primary: 0x4a5568,    // Slate gray
    secondary: 0x2d3748,  // Dark slate
    accent: 0x4a9eff,     // Blue
    glow: 0x4aff9e,       // Green
  },
  'tower': {
    primary: 0x5a67d8,    // Indigo
    secondary: 0x4c51bf,  // Dark indigo
    accent: 0x9f7aea,     // Purple
    glow: 0x4a9eff,       // Blue
  },
  'dome': {
    primary: 0x38b2ac,    // Teal
    secondary: 0x319795,  // Dark teal
    accent: 0x4fd1c5,     // Light teal
    glow: 0x4aff9e,       // Green
  },
  'pyramid': {
    primary: 0xd69e2e,    // Gold
    secondary: 0xb7791f,  // Dark gold
    accent: 0xecc94b,     // Yellow
    glow: 0xffaa00,       // Orange
  },
  'desktop': {
    primary: 0x718096,    // Gray blue
    secondary: 0x4a5568,  // Slate
    accent: 0x63b3ed,     // Light blue
    glow: 0x4aff9e,       // Green
  },
  'filing-cabinet': {
    primary: 0x68d391,    // Green
    secondary: 0x48bb78,  // Dark green
    accent: 0x9ae6b4,     // Light green
    glow: 0x4aff9e,       // Green
  },
  'satellite': {
    primary: 0x805ad5,    // Purple
    secondary: 0x6b46c1,  // Dark purple
    accent: 0xb794f4,     // Light purple
    glow: 0x4a9eff,       // Blue
  },
  'crystal': {
    primary: 0xed64a6,    // Pink
    secondary: 0xd53f8c,  // Dark pink
    accent: 0xf687b3,     // Light pink
    glow: 0x9f7aea,       // Purple
  },
  'factory': {
    primary: 0xed8936,    // Orange
    secondary: 0xdd6b20,  // Dark orange
    accent: 0xf6ad55,     // Light orange
    glow: 0xffaa00,       // Yellow-orange
  },
};
