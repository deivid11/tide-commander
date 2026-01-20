/**
 * Data Crystal Building
 *
 * Floating crystal with energy particles.
 */

import * as THREE from 'three';
import type { Building } from '../../../../shared/types';
import type { BuildingMeshData } from '../types';
import { STATUS_COLORS, STYLE_PALETTES } from '../types';
import { createLabel } from '../labelUtils';

/**
 * Create a Data Crystal building.
 * Floating crystal with energy particles.
 */
export function createCrystalBuildingMesh(building: Building): BuildingMeshData {
  const group = new THREE.Group();
  group.userData.buildingId = building.id;
  group.userData.isBuilding = true;

  const palette = STYLE_PALETTES['crystal'];
  const baseColor = building.color ? new THREE.Color(building.color) : new THREE.Color(palette.primary);

  // Main crystal (octahedron)
  const crystalGeom = new THREE.OctahedronGeometry(0.8);
  const crystalMat = new THREE.MeshStandardMaterial({
    color: baseColor,
    metalness: 0.3,
    roughness: 0.2,
    transparent: true,
    opacity: 0.85,
  });
  const crystal = new THREE.Mesh(crystalGeom, crystalMat);
  crystal.position.y = 1.8;
  crystal.castShadow = true;
  crystal.name = 'buildingBody';
  group.add(crystal);

  // Inner glow
  const innerGeom = new THREE.OctahedronGeometry(0.5);
  const innerMat = new THREE.MeshBasicMaterial({
    color: palette.glow,
    transparent: true,
    opacity: 0.6,
  });
  const inner = new THREE.Mesh(innerGeom, innerMat);
  inner.position.y = 1.8;
  inner.name = 'crystalInner';
  group.add(inner);

  // Orbiting particles
  for (let i = 0; i < 6; i++) {
    const particleGeom = new THREE.SphereGeometry(0.06, 8, 8);
    const particleMat = new THREE.MeshBasicMaterial({
      color: i % 2 === 0 ? palette.accent : palette.glow,
      transparent: true,
      opacity: 0.9,
    });
    const particle = new THREE.Mesh(particleGeom, particleMat);
    const angle = (i / 6) * Math.PI * 2;
    particle.position.set(Math.cos(angle) * 1.2, 1.8 + Math.sin(angle * 2) * 0.3, Math.sin(angle) * 1.2);
    particle.name = `particle_${i}`;
    group.add(particle);
  }

  // Energy field (wireframe sphere)
  const fieldGeom = new THREE.IcosahedronGeometry(1.3, 1);
  const fieldMat = new THREE.MeshBasicMaterial({
    color: palette.accent,
    wireframe: true,
    transparent: true,
    opacity: 0.4,
  });
  const field = new THREE.Mesh(fieldGeom, fieldMat);
  field.position.y = 1.8;
  field.name = 'energyField';
  group.add(field);

  // Pedestal base
  const pedestalGeom = new THREE.CylinderGeometry(0.3, 0.5, 0.8, 6);
  const pedestalMat = new THREE.MeshStandardMaterial({
    color: palette.secondary,
    metalness: 0.5,
    roughness: 0.5,
  });
  const pedestal = new THREE.Mesh(pedestalGeom, pedestalMat);
  pedestal.position.y = 0.4;
  group.add(pedestal);

  // Energy beam from pedestal to crystal
  const beamGeom = new THREE.CylinderGeometry(0.05, 0.05, 0.9, 8);
  const beamMat = new THREE.MeshBasicMaterial({
    color: palette.glow,
    transparent: true,
    opacity: 0.7,
  });
  const beam = new THREE.Mesh(beamGeom, beamMat);
  beam.position.y = 1.25;
  beam.name = 'energyBeam';
  group.add(beam);

  // Status light
  const statusLightGeom = new THREE.SphereGeometry(0.1, 16, 16);
  const statusLightMat = new THREE.MeshBasicMaterial({
    color: STATUS_COLORS[building.status],
    transparent: true,
    opacity: 0.95,
  });
  const statusLight = new THREE.Mesh(statusLightGeom, statusLightMat);
  statusLight.position.set(0.7, 0.5, 0);
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
  glow.position.set(0.7, 0.5, 0);
  glow.name = 'statusGlow';
  group.add(glow);

  // Base platform
  const baseGeom = new THREE.CylinderGeometry(0.8, 0.9, 0.1, 6);
  const baseMat = new THREE.MeshStandardMaterial({
    color: palette.secondary,
    metalness: 0.6,
    roughness: 0.4,
  });
  const base = new THREE.Mesh(baseGeom, baseMat);
  base.position.y = 0.05;
  base.receiveShadow = true;
  group.add(base);

  // Label
  const label = createLabel(building.name);
  label.position.set(0, 3.0, 0);
  label.name = 'buildingLabel';
  group.add(label);

  group.position.set(building.position.x, 0, building.position.z);

  return { group, statusLight, label };
}

/**
 * Update idle animations for crystal.
 */
export function updateCrystalIdle(
  meshData: BuildingMeshData,
  animationTime: number,
  deltaTime: number
): void {
  const buildingBody = meshData.group.getObjectByName('buildingBody') as THREE.Mesh;
  if (buildingBody) {
    buildingBody.rotation.y += deltaTime * 0.2;
    buildingBody.position.y = 1.8 + Math.sin(animationTime * 0.8) * 0.05;
  }

  const idleCrystalInner = meshData.group.getObjectByName('crystalInner') as THREE.Mesh;
  if (idleCrystalInner) {
    idleCrystalInner.rotation.y -= deltaTime * 0.3;
    idleCrystalInner.position.y = 1.8 + Math.sin(animationTime * 0.8) * 0.05;
    if (idleCrystalInner.material instanceof THREE.MeshBasicMaterial) {
      idleCrystalInner.material.opacity = 0.25 + Math.sin(animationTime * 0.6) * 0.15;
    }
  }

  const idleEnergyField = meshData.group.getObjectByName('energyField') as THREE.Mesh;
  if (idleEnergyField) {
    idleEnergyField.rotation.y += deltaTime * 0.1;
    idleEnergyField.position.y = 1.8 + Math.sin(animationTime * 0.8) * 0.05;
    if (idleEnergyField.material instanceof THREE.MeshBasicMaterial) {
      idleEnergyField.material.opacity = 0.15 + Math.sin(animationTime * 0.5) * 0.1;
    }
  }

  // Particles orbit slowly even when idle
  for (let i = 0; i < 6; i++) {
    const particle = meshData.group.getObjectByName(`particle_${i}`) as THREE.Mesh;
    if (particle) {
      const angle = (i / 6) * Math.PI * 2 + animationTime * 0.3;
      particle.position.x = Math.cos(angle) * 1.2;
      particle.position.z = Math.sin(angle) * 1.2;
      particle.position.y = 1.8 + Math.sin(animationTime * 0.8) * 0.05 + Math.sin(angle * 2) * 0.2;
    }
  }

  // Energy beam dim pulse
  const idleEnergyBeam = meshData.group.getObjectByName('energyBeam') as THREE.Mesh;
  if (idleEnergyBeam && idleEnergyBeam.material instanceof THREE.MeshBasicMaterial) {
    idleEnergyBeam.material.opacity = 0.2 + Math.sin(animationTime * 0.7) * 0.15;
  }
}

/**
 * Update running animations for crystal.
 */
export function updateCrystalRunning(
  meshData: BuildingMeshData,
  animationTime: number,
  deltaTime: number
): void {
  const crystal = meshData.group.getObjectByName('buildingBody') as THREE.Mesh;
  const crystalInner = meshData.group.getObjectByName('crystalInner') as THREE.Mesh;
  const energyField = meshData.group.getObjectByName('energyField') as THREE.Mesh;

  if (crystal) {
    crystal.rotation.y += deltaTime * 0.8;
    crystal.position.y = 1.8 + Math.sin(animationTime * 1.5) * 0.1;
  }
  if (crystalInner) {
    crystalInner.rotation.y -= deltaTime * 1.2;
    crystalInner.position.y = 1.8 + Math.sin(animationTime * 1.5) * 0.1;
    if (crystalInner.material instanceof THREE.MeshBasicMaterial) {
      crystalInner.material.opacity = 0.4 + Math.sin(animationTime * 3) * 0.2;
    }
  }
  if (energyField) {
    energyField.rotation.y += deltaTime * 0.3;
    energyField.rotation.x += deltaTime * 0.2;
    energyField.position.y = 1.8 + Math.sin(animationTime * 1.5) * 0.1;
  }

  for (let i = 0; i < 6; i++) {
    const particle = meshData.group.getObjectByName(`particle_${i}`) as THREE.Mesh;
    if (particle) {
      const angle = (i / 6) * Math.PI * 2 + animationTime * 1.5;
      const radius = 1.2 + Math.sin(animationTime * 2 + i) * 0.1;
      particle.position.x = Math.cos(angle) * radius;
      particle.position.z = Math.sin(angle) * radius;
      particle.position.y = 1.8 + Math.sin(animationTime * 1.5) * 0.1 + Math.sin(angle * 2) * 0.3;
    }
  }

  const energyBeam = meshData.group.getObjectByName('energyBeam') as THREE.Mesh;
  if (energyBeam && energyBeam.material instanceof THREE.MeshBasicMaterial) {
    energyBeam.material.opacity = 0.4 + Math.sin(animationTime * 4) * 0.3;
  }
}
