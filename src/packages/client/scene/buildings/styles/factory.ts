/**
 * Mini Factory Building
 *
 * Industrial building with smoking chimney.
 */

import * as THREE from 'three';
import type { Building } from '../../../../shared/types';
import type { BuildingMeshData } from '../types';
import { STATUS_COLORS, STYLE_PALETTES } from '../types';
import { createLabel } from '../labelUtils';

/**
 * Create a Mini Factory building.
 * Industrial building with smoking chimney.
 */
export function createFactoryBuildingMesh(building: Building): BuildingMeshData {
  const group = new THREE.Group();
  group.userData.buildingId = building.id;
  group.userData.isBuilding = true;

  const palette = STYLE_PALETTES['factory'];
  const baseColor = building.color ? new THREE.Color(building.color) : new THREE.Color(palette.primary);

  // Main building body
  const bodyGeom = new THREE.BoxGeometry(1.8, 1.2, 1.2);
  const bodyMat = new THREE.MeshStandardMaterial({
    color: baseColor,
    metalness: 0.4,
    roughness: 0.6,
  });
  const body = new THREE.Mesh(bodyGeom, bodyMat);
  body.position.set(0, 0.6, 0);
  body.castShadow = true;
  body.name = 'buildingBody';
  group.add(body);

  // Roof (slanted)
  const roofGeom = new THREE.BoxGeometry(2.0, 0.15, 1.4);
  const roofMat = new THREE.MeshStandardMaterial({
    color: palette.secondary,
    metalness: 0.5,
    roughness: 0.5,
  });
  const roof = new THREE.Mesh(roofGeom, roofMat);
  roof.position.set(0, 1.25, 0);
  roof.rotation.z = 0.05;
  group.add(roof);

  // Chimney
  const chimneyGeom = new THREE.CylinderGeometry(0.15, 0.18, 1.2, 8);
  const chimneyMat = new THREE.MeshStandardMaterial({
    color: palette.secondary,
    metalness: 0.5,
    roughness: 0.5,
  });
  const chimney = new THREE.Mesh(chimneyGeom, chimneyMat);
  chimney.position.set(0.5, 1.8, 0.3);
  group.add(chimney);

  // Chimney top ring
  const ringGeom = new THREE.TorusGeometry(0.17, 0.03, 8, 16);
  const ring = new THREE.Mesh(ringGeom, chimneyMat);
  ring.position.set(0.5, 2.4, 0.3);
  ring.rotation.x = Math.PI / 2;
  group.add(ring);

  // Smoke particles (spheres that will animate)
  for (let i = 0; i < 4; i++) {
    const smokeGeom = new THREE.SphereGeometry(0.08 + i * 0.03, 8, 8);
    const smokeMat = new THREE.MeshBasicMaterial({
      color: 0xaaaaaa,
      transparent: true,
      opacity: 0.7 - i * 0.12,
    });
    const smoke = new THREE.Mesh(smokeGeom, smokeMat);
    smoke.position.set(0.5, 2.5 + i * 0.25, 0.3);
    smoke.name = `smoke_${i}`;
    group.add(smoke);
  }

  // Windows
  for (let i = 0; i < 3; i++) {
    const windowGeom = new THREE.BoxGeometry(0.25, 0.35, 0.05);
    const windowMat = new THREE.MeshBasicMaterial({
      color: palette.glow,
      transparent: true,
      opacity: 0.9,
    });
    const window = new THREE.Mesh(windowGeom, windowMat);
    window.position.set(-0.6 + i * 0.5, 0.7, 0.63);
    window.name = `window_${i}`;
    group.add(window);
  }

  // Door
  const doorGeom = new THREE.BoxGeometry(0.4, 0.6, 0.05);
  const doorMat = new THREE.MeshStandardMaterial({
    color: palette.secondary,
    metalness: 0.4,
    roughness: 0.6,
  });
  const door = new THREE.Mesh(doorGeom, doorMat);
  door.position.set(0.6, 0.35, 0.63);
  group.add(door);

  // Conveyor belt (side)
  const conveyorGeom = new THREE.BoxGeometry(0.3, 0.1, 1.6);
  const conveyorMat = new THREE.MeshStandardMaterial({
    color: palette.secondary,
    metalness: 0.6,
    roughness: 0.4,
  });
  const conveyor = new THREE.Mesh(conveyorGeom, conveyorMat);
  conveyor.position.set(-1.0, 0.25, 0);
  group.add(conveyor);

  // Conveyor items (small boxes)
  for (let i = 0; i < 3; i++) {
    const itemGeom = new THREE.BoxGeometry(0.15, 0.15, 0.15);
    const itemMat = new THREE.MeshBasicMaterial({
      color: i % 2 === 0 ? palette.accent : palette.glow,
    });
    const item = new THREE.Mesh(itemGeom, itemMat);
    item.position.set(-1.0, 0.38, -0.5 + i * 0.4);
    item.name = `conveyorItem_${i}`;
    group.add(item);
  }

  // Gears (decorative)
  const gearGeom = new THREE.TorusGeometry(0.2, 0.05, 6, 8);
  const gearMat = new THREE.MeshStandardMaterial({
    color: palette.accent,
    metalness: 0.6,
    roughness: 0.4,
  });
  const gear1 = new THREE.Mesh(gearGeom, gearMat);
  gear1.position.set(-0.8, 0.9, 0.63);
  gear1.name = 'gear1';
  group.add(gear1);

  const gear2 = new THREE.Mesh(gearGeom.clone(), gearMat.clone());
  gear2.position.set(-0.5, 1.05, 0.63);
  gear2.name = 'gear2';
  group.add(gear2);

  // Status light
  const statusLightGeom = new THREE.SphereGeometry(0.12, 16, 16);
  const statusLightMat = new THREE.MeshBasicMaterial({
    color: STATUS_COLORS[building.status],
    transparent: true,
    opacity: 0.95,
  });
  const statusLight = new THREE.Mesh(statusLightGeom, statusLightMat);
  statusLight.position.set(0.85, 1.0, 0.65);
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
  glow.position.set(0.85, 1.0, 0.65);
  glow.name = 'statusGlow';
  group.add(glow);

  // Base
  const baseGeom = new THREE.BoxGeometry(2.4, 0.1, 1.8);
  const baseMat = new THREE.MeshStandardMaterial({
    color: 0x4a4a4a,
    metalness: 0.4,
    roughness: 0.6,
  });
  const base = new THREE.Mesh(baseGeom, baseMat);
  base.position.y = 0.05;
  base.receiveShadow = true;
  group.add(base);

  // Label
  const label = createLabel(building.name);
  label.position.set(0, 2.9, 0);
  label.name = 'buildingLabel';
  group.add(label);

  group.position.set(building.position.x, 0, building.position.z);

  return { group, statusLight, label };
}

/**
 * Update idle animations for factory.
 */
export function updateFactoryIdle(
  meshData: BuildingMeshData,
  animationTime: number,
  deltaTime: number
): void {
  // Gears always turn slowly
  const idleGear1 = meshData.group.getObjectByName('gear1') as THREE.Mesh;
  const idleGear2 = meshData.group.getObjectByName('gear2') as THREE.Mesh;
  if (idleGear1) idleGear1.rotation.z += deltaTime * 0.3;
  if (idleGear2) idleGear2.rotation.z -= deltaTime * 0.4;

  // Dim windows breathe when idle
  for (let i = 0; i < 3; i++) {
    const win = meshData.group.getObjectByName(`window_${i}`) as THREE.Mesh;
    if (win && win.material instanceof THREE.MeshBasicMaterial) {
      win.material.opacity = 0.3 + Math.sin(animationTime * 0.4 + i * 0.5) * 0.15;
    }
  }

  // Conveyor items slide slowly
  for (let i = 0; i < 3; i++) {
    const item = meshData.group.getObjectByName(`conveyorItem_${i}`) as THREE.Mesh;
    if (item) {
      item.position.z = ((item.position.z + deltaTime * 0.05 + 0.5) % 1.2) - 0.5;
    }
  }

  // Slow smoke rising when idle (less dense)
  for (let i = 0; i < 4; i++) {
    const smoke = meshData.group.getObjectByName(`smoke_${i}`) as THREE.Mesh;
    if (smoke) {
      const baseY = 2.5 + i * 0.25;
      const rise = (animationTime * 0.15 + i * 0.3) % 1.5;
      smoke.position.y = baseY + rise;
      smoke.position.x = 0.5 + Math.sin(animationTime * 0.3 + i) * 0.05;
      if (smoke.material instanceof THREE.MeshBasicMaterial) {
        smoke.material.opacity = Math.max(0, (0.25 - i * 0.05) * (1 - rise / 1.5));
      }
    }
  }
}

/**
 * Update running animations for factory.
 */
export function updateFactoryRunning(
  meshData: BuildingMeshData,
  animationTime: number,
  deltaTime: number
): void {
  // Animate smoke rising
  for (let i = 0; i < 4; i++) {
    const smoke = meshData.group.getObjectByName(`smoke_${i}`) as THREE.Mesh;
    if (smoke) {
      const baseY = 2.5 + i * 0.25;
      const rise = (animationTime * 0.5 + i * 0.3) % 1.5;
      smoke.position.y = baseY + rise;
      smoke.position.x = 0.5 + Math.sin(animationTime + i) * 0.1;
      if (smoke.material instanceof THREE.MeshBasicMaterial) {
        smoke.material.opacity = Math.max(0, (0.6 - i * 0.12) * (1 - rise / 1.5));
      }
      if (rise > 1.4) {
        smoke.position.y = baseY;
      }
    }
  }

  // Rotate gears
  const gear1 = meshData.group.getObjectByName('gear1') as THREE.Mesh;
  const gear2 = meshData.group.getObjectByName('gear2') as THREE.Mesh;
  if (gear1) gear1.rotation.z += deltaTime * 2;
  if (gear2) gear2.rotation.z -= deltaTime * 2.5;

  // Move conveyor items
  for (let i = 0; i < 3; i++) {
    const item = meshData.group.getObjectByName(`conveyorItem_${i}`) as THREE.Mesh;
    if (item) {
      item.position.z = ((item.position.z + deltaTime * 0.3 + 0.5) % 1.2) - 0.5;
    }
  }

  // Flicker windows
  for (let i = 0; i < 3; i++) {
    const win = meshData.group.getObjectByName(`window_${i}`) as THREE.Mesh;
    if (win && win.material instanceof THREE.MeshBasicMaterial) {
      const flicker = Math.random() > 0.99 ? 0.5 : 0.8;
      win.material.opacity = flicker;
    }
  }
}
