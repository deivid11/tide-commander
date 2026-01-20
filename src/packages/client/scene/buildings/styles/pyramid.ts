/**
 * Power Pyramid Building
 *
 * Egyptian-style pyramid with glowing core.
 */

import * as THREE from 'three';
import type { Building } from '../../../../shared/types';
import type { BuildingMeshData } from '../types';
import { STATUS_COLORS } from '../types';
import { createLabel } from '../labelUtils';

/**
 * Create a Power Pyramid building.
 * Egyptian-style pyramid with glowing core.
 */
export function createPyramidBuildingMesh(building: Building): BuildingMeshData {
  const group = new THREE.Group();
  group.userData.buildingId = building.id;
  group.userData.isBuilding = true;

  const baseColor = building.color ? new THREE.Color(building.color) : new THREE.Color(0x3a3a2a);

  // Main pyramid
  const pyramidGeom = new THREE.ConeGeometry(1.3, 2.5, 4);
  const pyramidMat = new THREE.MeshStandardMaterial({
    color: baseColor,
    metalness: 0.3,
    roughness: 0.7,
  });
  const pyramid = new THREE.Mesh(pyramidGeom, pyramidMat);
  pyramid.position.y = 1.25;
  pyramid.rotation.y = Math.PI / 4; // Rotate 45 degrees for diamond orientation
  pyramid.castShadow = true;
  pyramid.receiveShadow = true;
  pyramid.name = 'buildingBody';
  group.add(pyramid);

  // Glowing core (smaller inner pyramid)
  const coreGeom = new THREE.ConeGeometry(0.6, 1.2, 4);
  const coreMat = new THREE.MeshBasicMaterial({
    color: 0xffaa00,
    transparent: true,
    opacity: 0.6,
  });
  const core = new THREE.Mesh(coreGeom, coreMat);
  core.position.y = 0.8;
  core.rotation.y = Math.PI / 4;
  core.name = 'pyramidCore';
  group.add(core);

  // Energy lines on edges
  const edgePositions = [
    { x: 0.9, z: 0 },
    { x: -0.9, z: 0 },
    { x: 0, z: 0.9 },
    { x: 0, z: -0.9 },
  ];
  for (let i = 0; i < 4; i++) {
    const lineGeom = new THREE.CylinderGeometry(0.02, 0.02, 2.7, 8);
    const lineMat = new THREE.MeshBasicMaterial({
      color: 0x4aff9e,
      transparent: true,
      opacity: 0.7,
    });
    const line = new THREE.Mesh(lineGeom, lineMat);
    const pos = edgePositions[i];
    line.position.set(pos.x * 0.5, 1.25, pos.z * 0.5);
    // Tilt lines to follow pyramid edge
    const tiltAngle = Math.atan2(1.25, 0.65);
    if (i < 2) {
      line.rotation.z = i === 0 ? -tiltAngle : tiltAngle;
    } else {
      line.rotation.x = i === 2 ? tiltAngle : -tiltAngle;
    }
    line.name = `edgeLine_${i}`;
    group.add(line);
  }

  // Floating eye/orb at apex
  const eyeGeom = new THREE.SphereGeometry(0.15, 16, 16);
  const eyeMat = new THREE.MeshBasicMaterial({
    color: 0xffaa00,
    transparent: true,
    opacity: 0.9,
  });
  const eye = new THREE.Mesh(eyeGeom, eyeMat);
  eye.position.y = 2.7;
  eye.name = 'pyramidEye';
  group.add(eye);

  // Eye glow
  const eyeGlowGeom = new THREE.SphereGeometry(0.25, 16, 16);
  const eyeGlowMat = new THREE.MeshBasicMaterial({
    color: 0xffaa00,
    transparent: true,
    opacity: 0.3,
  });
  const eyeGlow = new THREE.Mesh(eyeGlowGeom, eyeGlowMat);
  eyeGlow.position.y = 2.7;
  eyeGlow.name = 'pyramidEyeGlow';
  group.add(eyeGlow);

  // Status light (separate from eye, below pyramid)
  const statusLightGeom = new THREE.SphereGeometry(0.12, 16, 16);
  const statusLightMat = new THREE.MeshBasicMaterial({
    color: STATUS_COLORS[building.status],
    transparent: true,
    opacity: 0.95,
  });
  const statusLight = new THREE.Mesh(statusLightGeom, statusLightMat);
  statusLight.position.set(1.2, 0.3, 0);
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
  glow.position.set(1.2, 0.3, 0);
  glow.name = 'statusGlow';
  group.add(glow);

  // Base platform (stone slab)
  const baseGeom = new THREE.BoxGeometry(2.8, 0.15, 2.8);
  const baseMat = new THREE.MeshStandardMaterial({
    color: 0x4a4a3a,
    metalness: 0.2,
    roughness: 0.8,
  });
  const base = new THREE.Mesh(baseGeom, baseMat);
  base.position.y = 0.075;
  base.receiveShadow = true;
  group.add(base);

  // Name label
  const label = createLabel(building.name);
  label.position.set(0, 3.2, 0);
  label.name = 'buildingLabel';
  group.add(label);

  group.position.set(building.position.x, 0, building.position.z);

  return { group, statusLight, label };
}

/**
 * Update idle animations for pyramid.
 */
export function updatePyramidIdle(meshData: BuildingMeshData, animationTime: number): void {
  const idleEye = meshData.group.getObjectByName('pyramidEye') as THREE.Mesh;
  const idleEyeGlow = meshData.group.getObjectByName('pyramidEyeGlow') as THREE.Mesh;
  if (idleEye) {
    idleEye.position.y = 2.7 + Math.sin(animationTime * 0.5) * 0.03;
    if (idleEye.material instanceof THREE.MeshBasicMaterial) {
      idleEye.material.opacity = 0.4 + Math.sin(animationTime * 0.7) * 0.2;
    }
  }
  if (idleEyeGlow) {
    idleEyeGlow.position.y = 2.7 + Math.sin(animationTime * 0.5) * 0.03;
    if (idleEyeGlow.material instanceof THREE.MeshBasicMaterial) {
      idleEyeGlow.material.opacity = 0.15 + Math.sin(animationTime * 0.7) * 0.1;
    }
  }

  const idleCore = meshData.group.getObjectByName('pyramidCore') as THREE.Mesh;
  if (idleCore && idleCore.material instanceof THREE.MeshBasicMaterial) {
    idleCore.material.opacity = 0.2 + Math.sin(animationTime * 0.5) * 0.1;
  }
}

/**
 * Update running animations for pyramid.
 */
export function updatePyramidRunning(meshData: BuildingMeshData, animationTime: number): void {
  const core = meshData.group.getObjectByName('pyramidCore') as THREE.Mesh;
  if (core && core.material instanceof THREE.MeshBasicMaterial) {
    core.material.opacity = 0.4 + Math.sin(animationTime * 2) * 0.2;
  }

  const eye = meshData.group.getObjectByName('pyramidEye') as THREE.Mesh;
  const eyeGlow = meshData.group.getObjectByName('pyramidEyeGlow') as THREE.Mesh;
  if (eye && eye.material instanceof THREE.MeshBasicMaterial) {
    eye.material.opacity = 0.7 + Math.sin(animationTime * 3) * 0.3;
  }
  if (eyeGlow && eyeGlow.material instanceof THREE.MeshBasicMaterial) {
    eyeGlow.material.opacity = 0.2 + Math.sin(animationTime * 3) * 0.15;
  }
  if (eye) {
    eye.position.y = 2.7 + Math.sin(animationTime * 1.5) * 0.1;
  }
  if (eyeGlow) {
    eyeGlow.position.y = 2.7 + Math.sin(animationTime * 1.5) * 0.1;
  }
}
