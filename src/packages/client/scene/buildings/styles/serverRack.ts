/**
 * Server Rack Building
 *
 * A small server rack/tower with horizontal slots and LEDs.
 */

import * as THREE from 'three';
import type { Building } from '../../../../shared/types';
import type { BuildingMeshData } from '../types';
import { STATUS_COLORS } from '../types';
import { createLabel, getBuildingLabelText } from '../labelUtils';

/**
 * Create a server building mesh using basic geometry.
 * Looks like a small server rack/tower.
 */
export function createServerBuildingMesh(building: Building): BuildingMeshData {
  const group = new THREE.Group();
  group.userData.buildingId = building.id;
  group.userData.isBuilding = true;

  const baseColor = building.color ? new THREE.Color(building.color) : new THREE.Color(0x2a2a3a);

  // Main tower body (server rack)
  const towerGeom = new THREE.BoxGeometry(1.2, 2.5, 0.8);
  const towerMat = new THREE.MeshStandardMaterial({
    color: baseColor,
    metalness: 0.7,
    roughness: 0.3,
  });
  const tower = new THREE.Mesh(towerGeom, towerMat);
  tower.position.y = 1.25;
  tower.castShadow = true;
  tower.receiveShadow = true;
  tower.name = 'buildingBody';
  group.add(tower);

  // Server slots (horizontal lines)
  for (let i = 0; i < 5; i++) {
    const slotGeom = new THREE.BoxGeometry(1.1, 0.02, 0.75);
    const slotMat = new THREE.MeshStandardMaterial({
      color: 0x1a1a2a,
      metalness: 0.5,
      roughness: 0.5,
    });
    const slot = new THREE.Mesh(slotGeom, slotMat);
    slot.position.set(0, 0.5 + i * 0.45, 0.03);
    group.add(slot);
  }

  // Front panel LEDs (small lights per slot)
  for (let i = 0; i < 5; i++) {
    const ledGeom = new THREE.BoxGeometry(0.08, 0.08, 0.05);
    const ledMat = new THREE.MeshBasicMaterial({
      color: 0x4aff9e,
      transparent: true,
      opacity: 0.9,
    });
    const led = new THREE.Mesh(ledGeom, ledMat);
    led.position.set(-0.45, 0.5 + i * 0.45, 0.43);
    led.name = `led_${i}`;
    group.add(led);

    // Activity LED (blinks when running)
    const activityLed = new THREE.Mesh(ledGeom.clone(), ledMat.clone());
    activityLed.position.set(-0.3, 0.5 + i * 0.45, 0.43);
    activityLed.name = `activityLed_${i}`;
    group.add(activityLed);
  }

  // Top vent/grill
  const ventGeom = new THREE.BoxGeometry(1.0, 0.1, 0.6);
  const ventMat = new THREE.MeshStandardMaterial({
    color: 0x1a1a2a,
    metalness: 0.3,
    roughness: 0.7,
  });
  const vent = new THREE.Mesh(ventGeom, ventMat);
  vent.position.set(0, 2.55, 0);
  group.add(vent);

  // Main status light on top
  const statusLightGeom = new THREE.SphereGeometry(0.15, 16, 16);
  const statusLightMat = new THREE.MeshBasicMaterial({
    color: STATUS_COLORS[building.status],
    transparent: true,
    opacity: 0.95,
  });
  const statusLight = new THREE.Mesh(statusLightGeom, statusLightMat);
  statusLight.position.set(0, 2.75, 0);
  statusLight.name = 'statusLight';
  group.add(statusLight);

  // Status light glow (larger transparent sphere)
  const glowGeom = new THREE.SphereGeometry(0.25, 16, 16);
  const glowMat = new THREE.MeshBasicMaterial({
    color: STATUS_COLORS[building.status],
    transparent: true,
    opacity: 0.3,
  });
  const glow = new THREE.Mesh(glowGeom, glowMat);
  glow.position.set(0, 2.75, 0);
  glow.name = 'statusGlow';
  group.add(glow);

  // Base platform
  const baseGeom = new THREE.BoxGeometry(1.5, 0.1, 1.1);
  const baseMat = new THREE.MeshStandardMaterial({
    color: 0x3a3a4a,
    metalness: 0.5,
    roughness: 0.5,
  });
  const base = new THREE.Mesh(baseGeom, baseMat);
  base.position.y = 0.05;
  base.receiveShadow = true;
  group.add(base);

  // Name label (includes port if configured)
  const label = createLabel(getBuildingLabelText(building));
  label.position.set(0, 3.2, 0);
  label.name = 'buildingLabel';
  group.add(label);

  // Set position
  group.position.set(building.position.x, 0, building.position.z);

  return {
    group,
    statusLight,
    label,
  };
}

/**
 * Update idle animations for server rack.
 */
export function updateServerRackIdle(meshData: BuildingMeshData, animationTime: number): void {
  for (let i = 0; i < 5; i++) {
    const led = meshData.group.getObjectByName(`led_${i}`) as THREE.Mesh;
    if (led && led.material instanceof THREE.MeshBasicMaterial) {
      const blinkPhase = Math.sin(animationTime * 0.8 + i * 1.2);
      led.material.opacity = blinkPhase > 0.3 ? 0.6 : 0.15;
    }
    const activityLed = meshData.group.getObjectByName(`activityLed_${i}`) as THREE.Mesh;
    if (activityLed && activityLed.material instanceof THREE.MeshBasicMaterial) {
      activityLed.material.opacity = Math.random() > 0.97 ? 0.5 : 0.1;
    }
  }
}

/**
 * Update running animations for server rack.
 */
export function updateServerRackRunning(meshData: BuildingMeshData, _animationTime: number): void {
  for (let i = 0; i < 5; i++) {
    const activityLed = meshData.group.getObjectByName(`activityLed_${i}`) as THREE.Mesh;
    if (activityLed && activityLed.material instanceof THREE.MeshBasicMaterial) {
      const shouldBlink = Math.random() > 0.95;
      if (shouldBlink) {
        activityLed.material.opacity = activityLed.material.opacity > 0.5 ? 0.2 : 0.9;
      }
    }
  }
}
