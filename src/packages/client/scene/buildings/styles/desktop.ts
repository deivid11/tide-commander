/**
 * Desktop PC Building
 *
 * Retro computer with monitor and keyboard.
 */

import * as THREE from 'three';
import type { Building } from '../../../../shared/types';
import type { BuildingMeshData } from '../types';
import { STATUS_COLORS, STYLE_PALETTES } from '../types';
import { createLabel } from '../labelUtils';

/**
 * Create a Desktop PC building.
 * Retro computer with monitor and keyboard.
 */
export function createDesktopBuildingMesh(building: Building): BuildingMeshData {
  const group = new THREE.Group();
  group.userData.buildingId = building.id;
  group.userData.isBuilding = true;

  const palette = STYLE_PALETTES['desktop'];
  const baseColor = building.color ? new THREE.Color(building.color) : new THREE.Color(palette.primary);

  // Monitor body
  const monitorGeom = new THREE.BoxGeometry(1.4, 1.0, 0.15);
  const monitorMat = new THREE.MeshStandardMaterial({
    color: baseColor,
    metalness: 0.4,
    roughness: 0.6,
  });
  const monitor = new THREE.Mesh(monitorGeom, monitorMat);
  monitor.position.set(0, 1.4, 0);
  monitor.castShadow = true;
  monitor.name = 'buildingBody';
  group.add(monitor);

  // Monitor screen (glowing when running)
  const screenGeom = new THREE.BoxGeometry(1.2, 0.8, 0.02);
  const screenMat = new THREE.MeshBasicMaterial({
    color: 0x0a1628,
    transparent: true,
    opacity: 0.95,
  });
  const screen = new THREE.Mesh(screenGeom, screenMat);
  screen.position.set(0, 1.4, 0.09);
  screen.name = 'screen';
  group.add(screen);

  // Screen content lines (code-like)
  for (let i = 0; i < 6; i++) {
    const lineGeom = new THREE.BoxGeometry(0.8 - (i % 3) * 0.2, 0.05, 0.01);
    const lineMat = new THREE.MeshBasicMaterial({
      color: palette.glow,
      transparent: true,
      opacity: 0.9,
    });
    const line = new THREE.Mesh(lineGeom, lineMat);
    line.position.set(-0.1 + (i % 2) * 0.1, 1.65 - i * 0.1, 0.1);
    line.name = `codeLine_${i}`;
    group.add(line);
  }

  // Monitor stand
  const standGeom = new THREE.BoxGeometry(0.15, 0.6, 0.15);
  const standMat = new THREE.MeshStandardMaterial({
    color: palette.secondary,
    metalness: 0.5,
    roughness: 0.5,
  });
  const stand = new THREE.Mesh(standGeom, standMat);
  stand.position.set(0, 0.6, 0);
  group.add(stand);

  // Monitor base
  const monitorBaseGeom = new THREE.BoxGeometry(0.6, 0.08, 0.4);
  const monitorBase = new THREE.Mesh(monitorBaseGeom, standMat);
  monitorBase.position.set(0, 0.25, 0);
  group.add(monitorBase);

  // Keyboard
  const keyboardGeom = new THREE.BoxGeometry(1.0, 0.08, 0.35);
  const keyboardMat = new THREE.MeshStandardMaterial({
    color: palette.secondary,
    metalness: 0.3,
    roughness: 0.7,
  });
  const keyboard = new THREE.Mesh(keyboardGeom, keyboardMat);
  keyboard.position.set(0, 0.2, 0.6);
  keyboard.rotation.x = -0.1;
  group.add(keyboard);

  // Keyboard keys (rows)
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 10; col++) {
      const keyGeom = new THREE.BoxGeometry(0.07, 0.03, 0.07);
      const keyMat = new THREE.MeshStandardMaterial({
        color: palette.accent,
        metalness: 0.2,
        roughness: 0.8,
      });
      const key = new THREE.Mesh(keyGeom, keyMat);
      key.position.set(-0.38 + col * 0.085, 0.25, 0.45 + row * 0.1);
      group.add(key);
    }
  }

  // CPU tower (on side)
  const cpuGeom = new THREE.BoxGeometry(0.4, 0.9, 0.8);
  const cpuMat = new THREE.MeshStandardMaterial({
    color: baseColor,
    metalness: 0.4,
    roughness: 0.6,
  });
  const cpu = new THREE.Mesh(cpuGeom, cpuMat);
  cpu.position.set(-1.1, 0.55, 0);
  cpu.castShadow = true;
  group.add(cpu);

  // CPU LED
  const cpuLedGeom = new THREE.BoxGeometry(0.05, 0.05, 0.02);
  const cpuLedMat = new THREE.MeshBasicMaterial({
    color: 0x4aff9e,
    transparent: true,
    opacity: 0.9,
  });
  const cpuLed = new THREE.Mesh(cpuLedGeom, cpuLedMat);
  cpuLed.position.set(-0.88, 0.7, 0.3);
  cpuLed.name = 'cpuLed';
  group.add(cpuLed);

  // Status light
  const statusLightGeom = new THREE.SphereGeometry(0.1, 16, 16);
  const statusLightMat = new THREE.MeshBasicMaterial({
    color: STATUS_COLORS[building.status],
    transparent: true,
    opacity: 0.95,
  });
  const statusLight = new THREE.Mesh(statusLightGeom, statusLightMat);
  statusLight.position.set(0.6, 1.85, 0.1);
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
  glow.position.set(0.6, 1.85, 0.1);
  glow.name = 'statusGlow';
  group.add(glow);

  // Base
  const baseGeom = new THREE.BoxGeometry(2.6, 0.1, 1.4);
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
  label.position.set(0, 2.3, 0);
  label.name = 'buildingLabel';
  group.add(label);

  group.position.set(building.position.x, 0, building.position.z);

  return { group, statusLight, label };
}

/**
 * Update idle animations for desktop.
 */
export function updateDesktopIdle(meshData: BuildingMeshData, animationTime: number): void {
  const buildingBody = meshData.group.getObjectByName('buildingBody') as THREE.Mesh;
  if (buildingBody) {
    buildingBody.rotation.y = Math.sin(animationTime * 0.3) * 0.01;
  }
  for (let i = 0; i < 6; i++) {
    const codeLine = meshData.group.getObjectByName(`codeLine_${i}`) as THREE.Mesh;
    if (codeLine && codeLine.material instanceof THREE.MeshBasicMaterial) {
      codeLine.material.opacity = 0.3 + Math.sin(animationTime * 0.4 + i * 0.2) * 0.1;
    }
  }
}

/**
 * Update running animations for desktop.
 */
export function updateDesktopRunning(meshData: BuildingMeshData, animationTime: number): void {
  for (let i = 0; i < 6; i++) {
    const codeLine = meshData.group.getObjectByName(`codeLine_${i}`) as THREE.Mesh;
    if (codeLine && codeLine.material instanceof THREE.MeshBasicMaterial) {
      const flicker = Math.random() > 0.98 ? 0.4 : 0.8;
      codeLine.material.opacity = flicker;
    }
  }

  const cpuLed = meshData.group.getObjectByName('cpuLed') as THREE.Mesh;
  if (cpuLed && cpuLed.material instanceof THREE.MeshBasicMaterial) {
    const ledBlink = Math.sin(animationTime * 6) > 0 ? 0.9 : 0.3;
    cpuLed.material.opacity = ledBlink;
  }
}
