/**
 * Building Label Utilities
 *
 * Functions for creating and updating text labels for buildings.
 */

import * as THREE from 'three';
import type { Building } from '../../../shared/types';
import type { BuildingMeshData } from './types';

/**
 * Get the display text for a building label (just the name).
 * Ports are shown in the popup instead.
 */
export function getBuildingLabelText(building: Building): string {
  return building.name;
}

/**
 * Create a text label sprite with high-quality rendering.
 * Uses same techniques as agent name labels for crisp text.
 */
export function createLabel(text: string): THREE.Sprite {
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d')!;

  // Higher resolution canvas for crisp text (matching agent label quality)
  const fontSize = 56;
  const padding = 28;
  const bgHeight = 72;
  const canvasHeight = 144;

  // Measure text to determine required canvas width
  canvas.width = 1024;
  canvas.height = canvasHeight;
  context.font = `bold ${fontSize}px Arial`;
  const measuredWidth = context.measureText(text).width;

  // Set canvas width to fit text (minimum 256 for short names)
  const minCanvasWidth = 256;
  const requiredWidth = measuredWidth + padding * 2 + 16;
  canvas.width = Math.max(minCanvasWidth, requiredWidth);

  // Clear canvas and reset context after resize
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.font = `bold ${fontSize}px Arial`;

  // Calculate centered background dimensions
  const bgWidth = measuredWidth + padding * 2;
  const bgX = (canvas.width - bgWidth) / 2;
  const bgY = (canvas.height - bgHeight) / 2;

  // Draw background (semi-transparent dark with rounded corners)
  context.fillStyle = 'rgba(0, 0, 0, 0.8)';
  context.beginPath();
  context.roundRect(bgX, bgY, bgWidth, bgHeight, 10);
  context.fill();

  // Draw text
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillStyle = '#ffffff';
  context.fillText(text, canvas.width / 2, canvas.height / 2);

  // Create texture with high quality filtering (prevents pixelation)
  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;

  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
  });

  // Scale must match canvas aspect ratio to avoid distortion
  // Base: 256x144 canvas = 1.0x0.5 sprite
  const sprite = new THREE.Sprite(material);
  const baseHeight = 0.5;
  const aspectRatio = canvas.width / canvas.height;
  sprite.scale.set(baseHeight * aspectRatio, baseHeight, 1);
  // Store aspect ratio for SceneManager to use when scaling (like agent labels)
  sprite.userData.aspectRatio = aspectRatio;

  return sprite;
}

/**
 * Update label text on a building mesh.
 */
export function updateLabel(meshData: BuildingMeshData, text: string): void {
  const oldLabel = meshData.label;
  const newLabel = createLabel(text);
  newLabel.position.copy(oldLabel.position);
  newLabel.name = 'buildingLabel';

  meshData.group.remove(oldLabel);
  if (oldLabel.material instanceof THREE.SpriteMaterial) {
    if (oldLabel.material.map) oldLabel.material.map.dispose();
    oldLabel.material.dispose();
  }

  meshData.group.add(newLabel);
  meshData.label = newLabel;
}

