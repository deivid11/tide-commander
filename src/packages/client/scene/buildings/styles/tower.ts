/**
 * Control Tower Building
 *
 * Tall tower with rotating antenna on top.
 */

import * as THREE from 'three';
import type { Building } from '../../../../shared/types';
import type { BuildingMeshData } from '../types';
import { STATUS_COLORS } from '../types';
import { createLabel } from '../labelUtils';

/**
 * Create a Control Tower building.
 * Tall tower with rotating antenna on top.
 */
export function createTowerBuildingMesh(building: Building): BuildingMeshData {
  const group = new THREE.Group();
  group.userData.buildingId = building.id;
  group.userData.isBuilding = true;

  const baseColor = building.color ? new THREE.Color(building.color) : new THREE.Color(0x2a3a4a);

  // Main tower body (octagonal)
  const towerGeom = new THREE.CylinderGeometry(0.5, 0.7, 3, 8);
  const towerMat = new THREE.MeshStandardMaterial({
    color: baseColor,
    metalness: 0.6,
    roughness: 0.4,
  });
  const tower = new THREE.Mesh(towerGeom, towerMat);
  tower.position.y = 1.5;
  tower.castShadow = true;
  tower.receiveShadow = true;
  tower.name = 'buildingBody';
  group.add(tower);

  // Window bands
  for (let i = 0; i < 4; i++) {
    const bandGeom = new THREE.CylinderGeometry(0.52 - i * 0.03, 0.62 - i * 0.03, 0.1, 8);
    const bandMat = new THREE.MeshBasicMaterial({
      color: 0x4a9eff,
      transparent: true,
      opacity: 0.7,
    });
    const band = new THREE.Mesh(bandGeom, bandMat);
    band.position.y = 0.7 + i * 0.6;
    band.name = `windowBand_${i}`;
    group.add(band);
  }

  // Top platform
  const platformGeom = new THREE.CylinderGeometry(0.6, 0.5, 0.2, 8);
  const platformMat = new THREE.MeshStandardMaterial({
    color: 0x3a3a4a,
    metalness: 0.7,
    roughness: 0.3,
  });
  const platform = new THREE.Mesh(platformGeom, platformMat);
  platform.position.y = 3.1;
  group.add(platform);

  // Antenna base
  const antennaBaseGeom = new THREE.CylinderGeometry(0.15, 0.2, 0.3, 6);
  const antennaBaseMat = new THREE.MeshStandardMaterial({
    color: 0x4a4a5a,
    metalness: 0.8,
    roughness: 0.2,
  });
  const antennaBase = new THREE.Mesh(antennaBaseGeom, antennaBaseMat);
  antennaBase.position.y = 3.35;
  group.add(antennaBase);

  // Rotating antenna (will be animated)
  const antennaGroup = new THREE.Group();
  antennaGroup.position.y = 3.6;
  antennaGroup.name = 'antenna';

  const antennaGeom = new THREE.BoxGeometry(0.05, 0.6, 0.05);
  const antennaMat = new THREE.MeshStandardMaterial({
    color: 0x6a6a7a,
    metalness: 0.9,
    roughness: 0.1,
  });
  const antenna = new THREE.Mesh(antennaGeom, antennaMat);
  antenna.position.y = 0.3;
  antennaGroup.add(antenna);

  // Antenna dishes
  const dishGeom = new THREE.ConeGeometry(0.15, 0.1, 8);
  for (let i = 0; i < 2; i++) {
    const dish = new THREE.Mesh(dishGeom, antennaMat);
    dish.rotation.x = Math.PI / 2;
    dish.position.set(i === 0 ? 0.2 : -0.2, 0.4, 0);
    dish.rotation.z = i === 0 ? Math.PI / 2 : -Math.PI / 2;
    antennaGroup.add(dish);
  }

  group.add(antennaGroup);

  // Status light
  const statusLightGeom = new THREE.SphereGeometry(0.12, 16, 16);
  const statusLightMat = new THREE.MeshBasicMaterial({
    color: STATUS_COLORS[building.status],
    transparent: true,
    opacity: 0.95,
  });
  const statusLight = new THREE.Mesh(statusLightGeom, statusLightMat);
  statusLight.position.set(0, 4.3, 0);
  statusLight.name = 'statusLight';
  group.add(statusLight);

  // Status glow
  const glowGeom = new THREE.SphereGeometry(0.2, 16, 16);
  const glowMat = new THREE.MeshBasicMaterial({
    color: STATUS_COLORS[building.status],
    transparent: true,
    opacity: 0.3,
  });
  const glow = new THREE.Mesh(glowGeom, glowMat);
  glow.position.set(0, 4.3, 0);
  glow.name = 'statusGlow';
  group.add(glow);

  // Base
  const baseGeom = new THREE.CylinderGeometry(0.9, 1.0, 0.15, 8);
  const baseMat = new THREE.MeshStandardMaterial({
    color: 0x3a3a4a,
    metalness: 0.5,
    roughness: 0.5,
  });
  const base = new THREE.Mesh(baseGeom, baseMat);
  base.position.y = 0.075;
  base.receiveShadow = true;
  group.add(base);

  // Name label
  const label = createLabel(building.name);
  label.position.set(0, 4.7, 0);
  label.name = 'buildingLabel';
  group.add(label);

  group.position.set(building.position.x, 0, building.position.z);

  return { group, statusLight, label };
}

/**
 * Update idle animations for tower.
 */
export function updateTowerIdle(
  meshData: BuildingMeshData,
  animationTime: number,
  deltaTime: number
): void {
  const idleAntenna = meshData.group.getObjectByName('antenna');
  if (idleAntenna) {
    idleAntenna.rotation.y += deltaTime * 0.3;
  }
  for (let i = 0; i < 4; i++) {
    const band = meshData.group.getObjectByName(`windowBand_${i}`) as THREE.Mesh;
    if (band && band.material instanceof THREE.MeshBasicMaterial) {
      band.material.opacity = 0.3 + Math.sin(animationTime * 0.5 + i * 0.4) * 0.15;
    }
  }
}

/**
 * Update running animations for tower.
 */
export function updateTowerRunning(
  meshData: BuildingMeshData,
  animationTime: number,
  deltaTime: number
): void {
  const antenna = meshData.group.getObjectByName('antenna');
  if (antenna) {
    antenna.rotation.y += deltaTime * 2;
  }
  for (let i = 0; i < 4; i++) {
    const band = meshData.group.getObjectByName(`windowBand_${i}`) as THREE.Mesh;
    if (band && band.material instanceof THREE.MeshBasicMaterial) {
      const bandPulse = Math.sin(animationTime * 4 + i * 0.5) * 0.3 + 0.7;
      band.material.opacity = bandPulse;
    }
  }
}
