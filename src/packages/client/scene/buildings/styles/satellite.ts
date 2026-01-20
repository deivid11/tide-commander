/**
 * Satellite Dish Building
 *
 * Communication dish with rotating receiver.
 */

import * as THREE from 'three';
import type { Building } from '../../../../shared/types';
import type { BuildingMeshData } from '../types';
import { STATUS_COLORS, STYLE_PALETTES } from '../types';
import { createLabel } from '../labelUtils';

/**
 * Create a Satellite Dish building.
 * Communication dish with rotating receiver.
 */
export function createSatelliteBuildingMesh(building: Building): BuildingMeshData {
  const group = new THREE.Group();
  group.userData.buildingId = building.id;
  group.userData.isBuilding = true;

  const palette = STYLE_PALETTES['satellite'];
  const baseColor = building.color ? new THREE.Color(building.color) : new THREE.Color(palette.primary);

  // Support pole
  const poleGeom = new THREE.CylinderGeometry(0.1, 0.15, 2.0, 8);
  const poleMat = new THREE.MeshStandardMaterial({
    color: palette.secondary,
    metalness: 0.6,
    roughness: 0.4,
  });
  const pole = new THREE.Mesh(poleGeom, poleMat);
  pole.position.y = 1.0;
  pole.castShadow = true;
  group.add(pole);

  // Dish mount
  const mountGeom = new THREE.BoxGeometry(0.3, 0.2, 0.3);
  const mount = new THREE.Mesh(mountGeom, poleMat);
  mount.position.y = 2.1;
  group.add(mount);

  // Rotating dish group
  const dishGroup = new THREE.Group();
  dishGroup.position.y = 2.3;
  dishGroup.name = 'dishGroup';

  // Main dish (parabolic-ish using sphere segment)
  const dishGeom = new THREE.SphereGeometry(1.0, 32, 16, 0, Math.PI * 2, 0, Math.PI / 3);
  const dishMat = new THREE.MeshStandardMaterial({
    color: baseColor,
    metalness: 0.5,
    roughness: 0.5,
    side: THREE.DoubleSide,
  });
  const dish = new THREE.Mesh(dishGeom, dishMat);
  dish.rotation.x = Math.PI / 2 + 0.3;
  dish.name = 'buildingBody';
  dishGroup.add(dish);

  // Dish inner surface (different color)
  const innerDishGeom = new THREE.SphereGeometry(0.95, 32, 16, 0, Math.PI * 2, 0, Math.PI / 3);
  const innerDishMat = new THREE.MeshStandardMaterial({
    color: palette.accent,
    metalness: 0.3,
    roughness: 0.7,
    side: THREE.BackSide,
  });
  const innerDish = new THREE.Mesh(innerDishGeom, innerDishMat);
  innerDish.rotation.x = Math.PI / 2 + 0.3;
  dishGroup.add(innerDish);

  // Receiver arm
  const armGeom = new THREE.CylinderGeometry(0.03, 0.03, 0.8, 8);
  const armMat = new THREE.MeshStandardMaterial({
    color: palette.secondary,
    metalness: 0.6,
    roughness: 0.4,
  });
  const arm = new THREE.Mesh(armGeom, armMat);
  arm.position.set(0, 0.1, 0.5);
  arm.rotation.x = -0.6;
  dishGroup.add(arm);

  // Receiver head
  const receiverGeom = new THREE.ConeGeometry(0.1, 0.2, 8);
  const receiverMat = new THREE.MeshStandardMaterial({
    color: palette.accent,
    metalness: 0.4,
    roughness: 0.6,
  });
  const receiver = new THREE.Mesh(receiverGeom, receiverMat);
  receiver.position.set(0, 0.5, 0.85);
  receiver.rotation.x = Math.PI / 2 - 0.6;
  dishGroup.add(receiver);

  // Signal indicator (pulsing when running)
  const signalGeom = new THREE.SphereGeometry(0.08, 16, 16);
  const signalMat = new THREE.MeshBasicMaterial({
    color: palette.glow,
    transparent: true,
    opacity: 0.9,
  });
  const signal = new THREE.Mesh(signalGeom, signalMat);
  signal.position.set(0, 0.55, 0.92);
  signal.name = 'signal';
  dishGroup.add(signal);

  group.add(dishGroup);

  // Signal waves (concentric rings)
  for (let i = 0; i < 3; i++) {
    const waveGeom = new THREE.RingGeometry(0.2 + i * 0.15, 0.22 + i * 0.15, 16);
    const waveMat = new THREE.MeshBasicMaterial({
      color: palette.glow,
      transparent: true,
      opacity: 0.6 - i * 0.15,
      side: THREE.DoubleSide,
    });
    const wave = new THREE.Mesh(waveGeom, waveMat);
    wave.position.set(0, 2.85 + i * 0.1, 0.92 + i * 0.1);
    wave.rotation.x = -0.6;
    wave.name = `wave_${i}`;
    group.add(wave);
  }

  // Status light
  const statusLightGeom = new THREE.SphereGeometry(0.1, 16, 16);
  const statusLightMat = new THREE.MeshBasicMaterial({
    color: STATUS_COLORS[building.status],
    transparent: true,
    opacity: 0.95,
  });
  const statusLight = new THREE.Mesh(statusLightGeom, statusLightMat);
  statusLight.position.set(0, 0.3, 0.5);
  statusLight.name = 'statusLight';
  group.add(statusLight);

  // Status glow
  const glowGeom = new THREE.SphereGeometry(0.18, 16, 16);
  const glowMat = new THREE.MeshBasicMaterial({
    color: STATUS_COLORS[building.status],
    transparent: true,
    opacity: 0.3,
  });
  const glow = new THREE.Mesh(glowGeom, glowMat);
  glow.position.set(0, 0.3, 0.5);
  glow.name = 'statusGlow';
  group.add(glow);

  // Base
  const baseGeom = new THREE.CylinderGeometry(0.6, 0.7, 0.15, 16);
  const baseMat = new THREE.MeshStandardMaterial({
    color: palette.secondary,
    metalness: 0.5,
    roughness: 0.5,
  });
  const base = new THREE.Mesh(baseGeom, baseMat);
  base.position.y = 0.075;
  base.receiveShadow = true;
  group.add(base);

  // Label
  const label = createLabel(building.name);
  label.position.set(0, 3.8, 0);
  label.name = 'buildingLabel';
  group.add(label);

  group.position.set(building.position.x, 0, building.position.z);

  return { group, statusLight, label };
}

/**
 * Update idle animations for satellite.
 */
export function updateSatelliteIdle(
  meshData: BuildingMeshData,
  animationTime: number,
  deltaTime: number
): void {
  const idleDishGroup = meshData.group.getObjectByName('dishGroup');
  if (idleDishGroup) {
    idleDishGroup.rotation.y += deltaTime * 0.1;
  }
  for (let i = 0; i < 3; i++) {
    const wave = meshData.group.getObjectByName(`wave_${i}`) as THREE.Mesh;
    if (wave && wave.material instanceof THREE.MeshBasicMaterial) {
      wave.material.opacity = 0.15 + Math.sin(animationTime * 0.5 + i * 0.3) * 0.1;
    }
  }
}

/**
 * Update running animations for satellite.
 */
export function updateSatelliteRunning(
  meshData: BuildingMeshData,
  animationTime: number,
  deltaTime: number
): void {
  const dishGroup = meshData.group.getObjectByName('dishGroup');
  if (dishGroup) {
    dishGroup.rotation.y += deltaTime * 0.5;
  }

  const signal = meshData.group.getObjectByName('signal') as THREE.Mesh;
  if (signal && signal.material instanceof THREE.MeshBasicMaterial) {
    signal.material.opacity = 0.6 + Math.sin(animationTime * 8) * 0.4;
  }

  for (let i = 0; i < 3; i++) {
    const wave = meshData.group.getObjectByName(`wave_${i}`) as THREE.Mesh;
    if (wave && wave.material instanceof THREE.MeshBasicMaterial) {
      const waveScale = 1 + Math.sin(animationTime * 4 + i) * 0.1;
      wave.scale.set(waveScale, waveScale, 1);
      wave.material.opacity = (0.5 - i * 0.15) * (0.5 + Math.sin(animationTime * 4 + i) * 0.5);
    }
  }
}
