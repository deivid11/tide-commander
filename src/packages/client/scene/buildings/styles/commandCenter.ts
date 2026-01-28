/**
 * Command Center Building
 *
 * A grand central hub for boss buildings that manage other buildings.
 * Features a raised platform with rotating holographic rings and
 * connection beams showing subordinate relationships.
 */

import * as THREE from 'three';
import type { Building } from '../../../../shared/types';
import type { BuildingMeshData } from '../types';
import { STATUS_COLORS } from '../types';
import { createLabel, getBuildingLabelText } from '../labelUtils';

/**
 * Create a Command Center building.
 * Grand central hub with holographic displays and rotating rings.
 */
export function createCommandCenterBuildingMesh(building: Building): BuildingMeshData {
  const group = new THREE.Group();
  group.userData.buildingId = building.id;
  group.userData.isBuilding = true;

  // Gold/royal theme for boss buildings
  const baseColor = building.color ? new THREE.Color(building.color) : new THREE.Color(0x2a2a3a);
  const accentColor = 0xffd700; // Gold

  // Main platform base (hexagonal)
  const platformGeom = new THREE.CylinderGeometry(1.8, 2.0, 0.3, 6);
  const platformMat = new THREE.MeshStandardMaterial({
    color: baseColor,
    metalness: 0.7,
    roughness: 0.3,
  });
  const platform = new THREE.Mesh(platformGeom, platformMat);
  platform.position.y = 0.15;
  platform.receiveShadow = true;
  group.add(platform);

  // Inner raised platform
  const innerPlatformGeom = new THREE.CylinderGeometry(1.2, 1.4, 0.2, 6);
  const innerPlatformMat = new THREE.MeshStandardMaterial({
    color: 0x3a3a4a,
    metalness: 0.8,
    roughness: 0.2,
  });
  const innerPlatform = new THREE.Mesh(innerPlatformGeom, innerPlatformMat);
  innerPlatform.position.y = 0.4;
  group.add(innerPlatform);

  // Central tower/core
  const towerGeom = new THREE.CylinderGeometry(0.4, 0.6, 2.0, 6);
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

  // Crown on top (boss symbol)
  const crownBaseGeom = new THREE.CylinderGeometry(0.5, 0.4, 0.3, 6);
  const crownMat = new THREE.MeshStandardMaterial({
    color: accentColor,
    metalness: 0.9,
    roughness: 0.1,
    emissive: new THREE.Color(accentColor),
    emissiveIntensity: 0.3,
  });
  const crownBase = new THREE.Mesh(crownBaseGeom, crownMat);
  crownBase.position.y = 2.65;
  crownBase.name = 'crownBase';
  group.add(crownBase);

  // Crown spikes
  for (let i = 0; i < 5; i++) {
    const angle = (i / 5) * Math.PI * 2;
    const spikeGeom = new THREE.ConeGeometry(0.08, 0.4, 4);
    const spike = new THREE.Mesh(spikeGeom, crownMat);
    spike.position.set(
      Math.cos(angle) * 0.35,
      2.95,
      Math.sin(angle) * 0.35
    );
    spike.name = `crownSpike_${i}`;
    group.add(spike);
  }

  // Holographic ring 1 (inner, fast)
  const ring1Geom = new THREE.TorusGeometry(0.8, 0.03, 8, 32);
  const ring1Mat = new THREE.MeshBasicMaterial({
    color: accentColor,
    transparent: true,
    opacity: 0.6,
  });
  const ring1 = new THREE.Mesh(ring1Geom, ring1Mat);
  ring1.position.y = 1.2;
  ring1.rotation.x = Math.PI / 2;
  ring1.name = 'holoRing1';
  group.add(ring1);

  // Holographic ring 2 (middle, medium speed)
  const ring2Geom = new THREE.TorusGeometry(1.1, 0.02, 8, 32);
  const ring2Mat = new THREE.MeshBasicMaterial({
    color: 0x4aff9e,
    transparent: true,
    opacity: 0.5,
  });
  const ring2 = new THREE.Mesh(ring2Geom, ring2Mat);
  ring2.position.y = 1.5;
  ring2.rotation.x = Math.PI / 2;
  ring2.name = 'holoRing2';
  group.add(ring2);

  // Holographic ring 3 (outer, slow)
  const ring3Geom = new THREE.TorusGeometry(1.4, 0.02, 8, 32);
  const ring3Mat = new THREE.MeshBasicMaterial({
    color: 0x4a9eff,
    transparent: true,
    opacity: 0.4,
  });
  const ring3 = new THREE.Mesh(ring3Geom, ring3Mat);
  ring3.position.y = 1.8;
  ring3.rotation.x = Math.PI / 2;
  ring3.name = 'holoRing3';
  group.add(ring3);

  // Control consoles around the platform (6 of them)
  for (let i = 0; i < 6; i++) {
    const angle = (i / 6) * Math.PI * 2;
    const consoleGroup = new THREE.Group();

    // Console base
    const consoleBaseGeom = new THREE.BoxGeometry(0.3, 0.25, 0.2);
    const consoleBaseMat = new THREE.MeshStandardMaterial({
      color: 0x3a3a4a,
      metalness: 0.6,
      roughness: 0.4,
    });
    const consoleBase = new THREE.Mesh(consoleBaseGeom, consoleBaseMat);
    consoleBase.position.y = 0.45;
    consoleGroup.add(consoleBase);

    // Console screen
    const screenGeom = new THREE.PlaneGeometry(0.25, 0.15);
    const screenMat = new THREE.MeshBasicMaterial({
      color: 0x4a9eff,
      transparent: true,
      opacity: 0.8,
    });
    const screen = new THREE.Mesh(screenGeom, screenMat);
    screen.position.y = 0.52;
    screen.position.z = 0.11;
    screen.rotation.x = -0.3;
    screen.name = `consoleScreen_${i}`;
    consoleGroup.add(screen);

    consoleGroup.position.set(
      Math.cos(angle) * 1.5,
      0,
      Math.sin(angle) * 1.5
    );
    consoleGroup.rotation.y = -angle + Math.PI;
    group.add(consoleGroup);
  }

  // Status light orb at the top
  const statusLightGeom = new THREE.SphereGeometry(0.15, 16, 16);
  const statusLightMat = new THREE.MeshBasicMaterial({
    color: STATUS_COLORS[building.status],
    transparent: true,
    opacity: 0.95,
  });
  const statusLight = new THREE.Mesh(statusLightGeom, statusLightMat);
  statusLight.position.set(0, 3.3, 0);
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
  glow.position.set(0, 3.3, 0);
  glow.name = 'statusGlow';
  group.add(glow);

  // Energy pillars at corners of hexagon
  for (let i = 0; i < 6; i++) {
    const angle = (i / 6) * Math.PI * 2 + Math.PI / 6;
    const pillarGeom = new THREE.CylinderGeometry(0.06, 0.08, 1.0, 6);
    const pillarMat = new THREE.MeshStandardMaterial({
      color: accentColor,
      metalness: 0.8,
      roughness: 0.2,
      emissive: new THREE.Color(accentColor),
      emissiveIntensity: 0.2,
    });
    const pillar = new THREE.Mesh(pillarGeom, pillarMat);
    pillar.position.set(
      Math.cos(angle) * 1.85,
      0.8,
      Math.sin(angle) * 1.85
    );
    pillar.name = `energyPillar_${i}`;
    group.add(pillar);

    // Pillar top light
    const pillarLightGeom = new THREE.SphereGeometry(0.08, 8, 8);
    const pillarLightMat = new THREE.MeshBasicMaterial({
      color: accentColor,
      transparent: true,
      opacity: 0.8,
    });
    const pillarLight = new THREE.Mesh(pillarLightGeom, pillarLightMat);
    pillarLight.position.set(
      Math.cos(angle) * 1.85,
      1.35,
      Math.sin(angle) * 1.85
    );
    pillarLight.name = `pillarLight_${i}`;
    group.add(pillarLight);
  }

  // Name label
  const label = createLabel(getBuildingLabelText(building));
  label.position.set(0, 3.8, 0);
  label.name = 'buildingLabel';
  group.add(label);

  group.position.set(building.position.x, 0, building.position.z);

  return { group, statusLight, label };
}

/**
 * Update idle animations for command center.
 */
export function updateCommandCenterIdle(
  meshData: BuildingMeshData,
  animationTime: number,
  deltaTime: number
): void {
  // Slow rotation of holographic rings
  const ring1 = meshData.group.getObjectByName('holoRing1') as THREE.Mesh;
  const ring2 = meshData.group.getObjectByName('holoRing2') as THREE.Mesh;
  const ring3 = meshData.group.getObjectByName('holoRing3') as THREE.Mesh;

  if (ring1) {
    ring1.rotation.z += deltaTime * 0.3;
    if (ring1.material instanceof THREE.MeshBasicMaterial) {
      ring1.material.opacity = 0.3 + Math.sin(animationTime * 0.5) * 0.1;
    }
  }
  if (ring2) {
    ring2.rotation.z -= deltaTime * 0.2;
    if (ring2.material instanceof THREE.MeshBasicMaterial) {
      ring2.material.opacity = 0.25 + Math.sin(animationTime * 0.7 + 1) * 0.1;
    }
  }
  if (ring3) {
    ring3.rotation.z += deltaTime * 0.1;
    if (ring3.material instanceof THREE.MeshBasicMaterial) {
      ring3.material.opacity = 0.2 + Math.sin(animationTime * 0.4 + 2) * 0.1;
    }
  }

  // Gentle pulse on pillar lights
  for (let i = 0; i < 6; i++) {
    const pillarLight = meshData.group.getObjectByName(`pillarLight_${i}`) as THREE.Mesh;
    if (pillarLight && pillarLight.material instanceof THREE.MeshBasicMaterial) {
      pillarLight.material.opacity = 0.4 + Math.sin(animationTime * 0.5 + i * 0.5) * 0.2;
    }
  }

  // Console screens dim pulse
  for (let i = 0; i < 6; i++) {
    const screen = meshData.group.getObjectByName(`consoleScreen_${i}`) as THREE.Mesh;
    if (screen && screen.material instanceof THREE.MeshBasicMaterial) {
      screen.material.opacity = 0.4 + Math.sin(animationTime * 0.3 + i * 0.3) * 0.1;
    }
  }
}

/**
 * Update running animations for command center.
 */
export function updateCommandCenterRunning(
  meshData: BuildingMeshData,
  animationTime: number,
  deltaTime: number
): void {
  // Fast rotation of holographic rings
  const ring1 = meshData.group.getObjectByName('holoRing1') as THREE.Mesh;
  const ring2 = meshData.group.getObjectByName('holoRing2') as THREE.Mesh;
  const ring3 = meshData.group.getObjectByName('holoRing3') as THREE.Mesh;

  if (ring1) {
    ring1.rotation.z += deltaTime * 1.5;
    // Slight wobble
    ring1.rotation.x = Math.PI / 2 + Math.sin(animationTime * 2) * 0.1;
    if (ring1.material instanceof THREE.MeshBasicMaterial) {
      ring1.material.opacity = 0.5 + Math.sin(animationTime * 3) * 0.2;
    }
  }
  if (ring2) {
    ring2.rotation.z -= deltaTime * 1.0;
    ring2.rotation.x = Math.PI / 2 + Math.sin(animationTime * 1.5 + 1) * 0.15;
    if (ring2.material instanceof THREE.MeshBasicMaterial) {
      ring2.material.opacity = 0.4 + Math.sin(animationTime * 2.5 + 1) * 0.15;
    }
  }
  if (ring3) {
    ring3.rotation.z += deltaTime * 0.5;
    ring3.rotation.x = Math.PI / 2 + Math.sin(animationTime * 1 + 2) * 0.1;
    if (ring3.material instanceof THREE.MeshBasicMaterial) {
      ring3.material.opacity = 0.35 + Math.sin(animationTime * 2 + 2) * 0.15;
    }
  }

  // Active pulse on pillar lights
  for (let i = 0; i < 6; i++) {
    const pillarLight = meshData.group.getObjectByName(`pillarLight_${i}`) as THREE.Mesh;
    if (pillarLight && pillarLight.material instanceof THREE.MeshBasicMaterial) {
      const phase = (animationTime * 2 + i * 0.3) % (Math.PI * 2);
      pillarLight.material.opacity = 0.6 + Math.sin(phase) * 0.3;
    }
  }

  // Console screens active with data streaming effect
  for (let i = 0; i < 6; i++) {
    const screen = meshData.group.getObjectByName(`consoleScreen_${i}`) as THREE.Mesh;
    if (screen && screen.material instanceof THREE.MeshBasicMaterial) {
      screen.material.opacity = 0.7 + Math.sin(animationTime * 4 + i * 0.5) * 0.2;
      // Color shift based on activity
      const hue = (animationTime * 0.1 + i * 0.1) % 1;
      screen.material.color.setHSL(hue * 0.2 + 0.5, 0.8, 0.5);
    }
  }

  // Crown glow intensifies
  const crownBase = meshData.group.getObjectByName('crownBase') as THREE.Mesh;
  if (crownBase && crownBase.material instanceof THREE.MeshStandardMaterial) {
    crownBase.material.emissiveIntensity = 0.4 + Math.sin(animationTime * 2) * 0.2;
  }
}
