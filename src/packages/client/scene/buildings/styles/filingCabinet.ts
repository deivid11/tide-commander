/**
 * Filing Cabinet Building
 *
 * Office cabinet with sliding drawers.
 */

import * as THREE from 'three';
import type { Building } from '../../../../shared/types';
import type { BuildingMeshData } from '../types';
import { STATUS_COLORS, STYLE_PALETTES } from '../types';
import { createLabel } from '../labelUtils';

/**
 * Create a Filing Cabinet building.
 * Office cabinet with sliding drawers.
 */
export function createFilingCabinetBuildingMesh(building: Building): BuildingMeshData {
  const group = new THREE.Group();
  group.userData.buildingId = building.id;
  group.userData.isBuilding = true;

  const palette = STYLE_PALETTES['filing-cabinet'];
  const baseColor = building.color ? new THREE.Color(building.color) : new THREE.Color(palette.primary);

  // Main cabinet body
  const cabinetGeom = new THREE.BoxGeometry(1.0, 2.4, 0.8);
  const cabinetMat = new THREE.MeshStandardMaterial({
    color: baseColor,
    metalness: 0.5,
    roughness: 0.5,
  });
  const cabinet = new THREE.Mesh(cabinetGeom, cabinetMat);
  cabinet.position.y = 1.2;
  cabinet.castShadow = true;
  cabinet.name = 'buildingBody';
  group.add(cabinet);

  // Drawers (4 of them)
  for (let i = 0; i < 4; i++) {
    const drawerGeom = new THREE.BoxGeometry(0.9, 0.5, 0.05);
    const drawerMat = new THREE.MeshStandardMaterial({
      color: palette.secondary,
      metalness: 0.4,
      roughness: 0.6,
    });
    const drawer = new THREE.Mesh(drawerGeom, drawerMat);
    drawer.position.set(0, 0.35 + i * 0.55, 0.4);
    drawer.name = `drawer_${i}`;
    group.add(drawer);

    // Drawer handle
    const handleGeom = new THREE.BoxGeometry(0.3, 0.06, 0.05);
    const handleMat = new THREE.MeshStandardMaterial({
      color: palette.accent,
      metalness: 0.7,
      roughness: 0.3,
    });
    const handle = new THREE.Mesh(handleGeom, handleMat);
    handle.position.set(0, 0.35 + i * 0.55, 0.47);
    handle.name = `handle_${i}`;
    group.add(handle);

    // Drawer label slot
    const labelSlotGeom = new THREE.BoxGeometry(0.4, 0.15, 0.02);
    const labelSlotMat = new THREE.MeshBasicMaterial({
      color: 0xffffee,
    });
    const labelSlot = new THREE.Mesh(labelSlotGeom, labelSlotMat);
    labelSlot.position.set(0, 0.45 + i * 0.55, 0.44);
    group.add(labelSlot);
  }

  // Filing indicator lights
  for (let i = 0; i < 4; i++) {
    const indicatorGeom = new THREE.BoxGeometry(0.06, 0.06, 0.02);
    const indicatorMat = new THREE.MeshBasicMaterial({
      color: i % 2 === 0 ? palette.glow : palette.accent,
      transparent: true,
      opacity: 0.9,
    });
    const indicator = new THREE.Mesh(indicatorGeom, indicatorMat);
    indicator.position.set(-0.38, 0.35 + i * 0.55, 0.42);
    indicator.name = `indicator_${i}`;
    group.add(indicator);
  }

  // Status light on top
  const statusLightGeom = new THREE.SphereGeometry(0.12, 16, 16);
  const statusLightMat = new THREE.MeshBasicMaterial({
    color: STATUS_COLORS[building.status],
    transparent: true,
    opacity: 0.95,
  });
  const statusLight = new THREE.Mesh(statusLightGeom, statusLightMat);
  statusLight.position.set(0, 2.55, 0);
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
  glow.position.set(0, 2.55, 0);
  glow.name = 'statusGlow';
  group.add(glow);

  // Base
  const baseGeom = new THREE.BoxGeometry(1.3, 0.1, 1.1);
  const baseMat = new THREE.MeshStandardMaterial({
    color: 0x3a3a4a,
    metalness: 0.5,
    roughness: 0.5,
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
 * Update idle animations for filing cabinet.
 */
export function updateFilingCabinetIdle(meshData: BuildingMeshData, animationTime: number): void {
  meshData.group.rotation.y = Math.sin(animationTime * 0.5) * 0.005;
  for (let i = 0; i < 4; i++) {
    const indicator = meshData.group.getObjectByName(`indicator_${i}`) as THREE.Mesh;
    if (indicator && indicator.material instanceof THREE.MeshBasicMaterial) {
      indicator.material.opacity = 0.3 + Math.sin(animationTime * 0.6 + i * 0.4) * 0.15;
    }
  }
}

/**
 * Update running animations for filing cabinet.
 */
export function updateFilingCabinetRunning(meshData: BuildingMeshData, animationTime: number): void {
  for (let i = 0; i < 4; i++) {
    const indicator = meshData.group.getObjectByName(`indicator_${i}`) as THREE.Mesh;
    if (indicator && indicator.material instanceof THREE.MeshBasicMaterial) {
      const indicatorPulse = Math.sin(animationTime * 3 + i * 0.8) * 0.3 + 0.7;
      indicator.material.opacity = indicatorPulse;
    }
  }

  for (let i = 0; i < 4; i++) {
    const handle = meshData.group.getObjectByName(`handle_${i}`) as THREE.Mesh;
    if (handle) {
      handle.position.z = 0.47 + Math.sin(animationTime * 8 + i) * 0.005;
    }
  }
}
