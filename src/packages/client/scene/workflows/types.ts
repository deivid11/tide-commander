/**
 * Workflow 3D Types and Constants
 *
 * Shared types, interfaces, and color palettes for workflow rendering.
 */

import * as THREE from 'three';
import type { WorkflowModelStatus, WorkflowStyle } from '../../../shared/workflow-types';

/**
 * Workflow mesh data structure (analogous to BuildingMeshData)
 */
export interface WorkflowMeshData {
  group: THREE.Group;
  statusLight: THREE.Mesh;
  label: THREE.Sprite;
  instanceBadge?: THREE.Sprite;
}

/**
 * Status colors for workflow lights
 */
export const WORKFLOW_STATUS_COLORS: Record<WorkflowModelStatus, number> = {
  idle: 0x888888,       // Gray
  running: 0x4aff9e,    // Green
  completed: 0x4a9eff,  // Blue
  error: 0xff4a4a,      // Red
};

/**
 * Color palettes for each workflow style
 */
export const WORKFLOW_STYLE_PALETTES: Record<WorkflowStyle, {
  primary: number;
  secondary: number;
  accent: number;
  glow: number;
}> = {
  'flowchart': {
    primary: 0x5a67d8,    // Indigo
    secondary: 0x4c51bf,  // Dark indigo
    accent: 0x9f7aea,     // Purple
    glow: 0x4a9eff,       // Blue
  },
  'circuit-board': {
    primary: 0x38b2ac,    // Teal
    secondary: 0x2c7a7b,  // Dark teal
    accent: 0x4fd1c5,     // Light teal
    glow: 0x4aff9e,       // Green
  },
  'constellation': {
    primary: 0x805ad5,    // Purple
    secondary: 0x6b46c1,  // Dark purple
    accent: 0xd6bcfa,     // Light purple
    glow: 0xb794f4,       // Medium purple
  },
  'helix': {
    primary: 0xed64a6,    // Pink
    secondary: 0xd53f8c,  // Dark pink
    accent: 0xf687b3,     // Light pink
    glow: 0x9f7aea,       // Purple
  },
  'clockwork': {
    primary: 0xd69e2e,    // Gold
    secondary: 0xb7791f,  // Dark gold
    accent: 0xecc94b,     // Yellow
    glow: 0xffaa00,       // Orange
  },
};
