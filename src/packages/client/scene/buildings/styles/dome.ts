/**
 * Data Dome Building
 *
 * Futuristic dome with energy ring.
 */

import * as THREE from 'three';
import type { Building } from '../../../../shared/types';
import type { BuildingMeshData } from '../types';
import { STATUS_COLORS } from '../types';
import { createLabel } from '../labelUtils';

/**
 * Create a Data Dome building.
 * Futuristic dome with energy ring.
 */
export function createDomeBuildingMesh(building: Building): BuildingMeshData {
  const group = new THREE.Group();
  group.userData.buildingId = building.id;
  group.userData.isBuilding = true;

  const baseColor = building.color ? new THREE.Color(building.color) : new THREE.Color(0x2a2a4a);

  // Main dome
  const domeGeom = new THREE.SphereGeometry(1.2, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2);
  const domeMat = new THREE.MeshStandardMaterial({
    color: baseColor,
    metalness: 0.4,
    roughness: 0.6,
    transparent: true,
    opacity: 0.9,
  });
  const dome = new THREE.Mesh(domeGeom, domeMat);
  dome.position.y = 0.15;
  dome.castShadow = true;
  dome.receiveShadow = true;
  dome.name = 'buildingBody';
  group.add(dome);

  // Inner dome (glowing core)
  const innerDomeGeom = new THREE.SphereGeometry(0.8, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2);
  const innerDomeMat = new THREE.MeshBasicMaterial({
    color: 0x4a9eff,
    transparent: true,
    opacity: 0.3,
  });
  const innerDome = new THREE.Mesh(innerDomeGeom, innerDomeMat);
  innerDome.position.y = 0.15;
  innerDome.name = 'innerDome';
  group.add(innerDome);

  // Energy ring (rotating torus)
  const ringGeom = new THREE.TorusGeometry(1.0, 0.05, 8, 32);
  const ringMat = new THREE.MeshBasicMaterial({
    color: 0x4aff9e,
    transparent: true,
    opacity: 0.8,
  });
  const ring = new THREE.Mesh(ringGeom, ringMat);
  ring.position.y = 0.6;
  ring.rotation.x = Math.PI / 2;
  ring.name = 'energyRing';
  group.add(ring);

  // Second ring (counter-rotating)
  const ring2 = new THREE.Mesh(ringGeom.clone(), ringMat.clone());
  ring2.position.y = 0.8;
  ring2.rotation.x = Math.PI / 3;
  ring2.name = 'energyRing2';
  group.add(ring2);

  // Vertical energy beams
  for (let i = 0; i < 4; i++) {
    const beamGeom = new THREE.CylinderGeometry(0.03, 0.03, 1.2, 8);
    const beamMat = new THREE.MeshBasicMaterial({
      color: 0x4a9eff,
      transparent: true,
      opacity: 0.6,
    });
    const beam = new THREE.Mesh(beamGeom, beamMat);
    const angle = (i / 4) * Math.PI * 2;
    beam.position.set(Math.cos(angle) * 0.5, 0.75, Math.sin(angle) * 0.5);
    beam.name = `beam_${i}`;
    group.add(beam);
  }

  // Status light on top
  const statusLightGeom = new THREE.SphereGeometry(0.15, 16, 16);
  const statusLightMat = new THREE.MeshBasicMaterial({
    color: STATUS_COLORS[building.status],
    transparent: true,
    opacity: 0.95,
  });
  const statusLight = new THREE.Mesh(statusLightGeom, statusLightMat);
  statusLight.position.set(0, 1.4, 0);
  statusLight.name = 'statusLight';
  group.add(statusLight);

  // Status glow
  const glowGeom = new THREE.SphereGeometry(0.25, 16, 16);
  const glowMat = new THREE.MeshBasicMaterial({
    color: STATUS_COLORS[building.status],
    transparent: true,
    opacity: 0.3,
  });
  const glow = new THREE.Mesh(glowGeom, glowMat);
  glow.position.set(0, 1.4, 0);
  glow.name = 'statusGlow';
  group.add(glow);

  // Base platform
  const baseGeom = new THREE.CylinderGeometry(1.4, 1.5, 0.15, 32);
  const baseMat = new THREE.MeshStandardMaterial({
    color: 0x3a3a4a,
    metalness: 0.6,
    roughness: 0.4,
  });
  const base = new THREE.Mesh(baseGeom, baseMat);
  base.position.y = 0.075;
  base.receiveShadow = true;
  group.add(base);

  // Name label
  const label = createLabel(building.name);
  label.position.set(0, 1.9, 0);
  label.name = 'buildingLabel';
  group.add(label);

  group.position.set(building.position.x, 0, building.position.z);

  return { group, statusLight, label };
}

/**
 * Update idle animations for dome.
 */
export function updateDomeIdle(
  meshData: BuildingMeshData,
  animationTime: number,
  deltaTime: number
): void {
  const idleRing1 = meshData.group.getObjectByName('energyRing') as THREE.Mesh;
  const idleRing2 = meshData.group.getObjectByName('energyRing2') as THREE.Mesh;
  if (idleRing1) idleRing1.rotation.z += deltaTime * 0.2;
  if (idleRing2) idleRing2.rotation.z -= deltaTime * 0.15;

  const idleInnerDome = meshData.group.getObjectByName('innerDome') as THREE.Mesh;
  if (idleInnerDome && idleInnerDome.material instanceof THREE.MeshBasicMaterial) {
    idleInnerDome.material.opacity = 0.15 + Math.sin(animationTime * 0.6) * 0.1;
  }

  for (let i = 0; i < 4; i++) {
    const beam = meshData.group.getObjectByName(`beam_${i}`) as THREE.Mesh;
    if (beam && beam.material instanceof THREE.MeshBasicMaterial) {
      beam.material.opacity = 0.2 + Math.sin(animationTime * 0.5 + i * 0.3) * 0.1;
    }
  }
}

/**
 * Update running animations for dome.
 */
export function updateDomeRunning(
  meshData: BuildingMeshData,
  animationTime: number,
  deltaTime: number
): void {
  const ring1 = meshData.group.getObjectByName('energyRing') as THREE.Mesh;
  const ring2 = meshData.group.getObjectByName('energyRing2') as THREE.Mesh;
  if (ring1) ring1.rotation.z += deltaTime * 1.5;
  if (ring2) ring2.rotation.z -= deltaTime * 1.2;

  const innerDome = meshData.group.getObjectByName('innerDome') as THREE.Mesh;
  if (innerDome && innerDome.material instanceof THREE.MeshBasicMaterial) {
    innerDome.material.opacity = 0.2 + Math.sin(animationTime * 2) * 0.15;
  }

  for (let i = 0; i < 4; i++) {
    const beam = meshData.group.getObjectByName(`beam_${i}`) as THREE.Mesh;
    if (beam && beam.material instanceof THREE.MeshBasicMaterial) {
      const beamPulse = Math.sin(animationTime * 5 + i * 1.5) * 0.3 + 0.6;
      beam.material.opacity = beamPulse;
    }
  }
}
