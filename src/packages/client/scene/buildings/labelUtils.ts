/**
 * Building Label Utilities
 *
 * Functions for creating and updating text labels for buildings.
 */

import * as THREE from 'three';
import type { BuildingMeshData } from './types';

/**
 * Create a text label sprite.
 */
export function createLabel(text: string): THREE.Sprite {
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d')!;

  const fontSize = 24;
  const padding = 20;
  const canvasHeight = 64;

  // Set initial canvas size for accurate text measurement
  canvas.width = 1024;
  canvas.height = canvasHeight;
  context.font = `bold ${fontSize}px Arial`;
  const measuredWidth = context.measureText(text).width;

  // Resize canvas to fit text (with minimum width)
  const minCanvasWidth = 256;
  canvas.width = Math.max(minCanvasWidth, measuredWidth + padding * 2);

  // Clear canvas and reset context after resize
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.font = `bold ${fontSize}px Arial`;

  // Background
  context.fillStyle = 'rgba(0, 0, 0, 0.7)';
  context.roundRect(10, 10, canvas.width - 20, canvas.height - 20, 8);
  context.fill();

  // Text
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillStyle = '#ffffff';
  context.fillText(text, canvas.width / 2, canvas.height / 2);

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;

  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
  });

  // Scale must match canvas aspect ratio to avoid distortion
  // Original: 256x64 canvas = 2x0.5 sprite (both 4:1 ratio)
  const sprite = new THREE.Sprite(material);
  const baseHeight = 0.5;
  const widthScale = 2 * (canvas.width / 256);
  sprite.scale.set(widthScale, baseHeight, 1);

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
