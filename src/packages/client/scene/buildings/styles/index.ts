/**
 * Building Styles
 *
 * Aggregates all building style creators and animations.
 */

import * as THREE from 'three';
import type { Building } from '../../../../shared/types';
import type { BuildingMeshData } from '../types';

// Re-export individual building creators and animations
export { createServerBuildingMesh, updateServerRackIdle, updateServerRackRunning } from './serverRack';
export { createTowerBuildingMesh, updateTowerIdle, updateTowerRunning } from './tower';
export { createDomeBuildingMesh, updateDomeIdle, updateDomeRunning } from './dome';
export { createPyramidBuildingMesh, updatePyramidIdle, updatePyramidRunning } from './pyramid';
export { createDesktopBuildingMesh, updateDesktopIdle, updateDesktopRunning } from './desktop';
export {
  createFilingCabinetBuildingMesh,
  updateFilingCabinetIdle,
  updateFilingCabinetRunning,
} from './filingCabinet';
export { createSatelliteBuildingMesh, updateSatelliteIdle, updateSatelliteRunning } from './satellite';
export { createCrystalBuildingMesh, updateCrystalIdle, updateCrystalRunning } from './crystal';
export { createFactoryBuildingMesh, updateFactoryIdle, updateFactoryRunning } from './factory';

// Import for internal use
import { createServerBuildingMesh, updateServerRackIdle, updateServerRackRunning } from './serverRack';
import { createTowerBuildingMesh, updateTowerIdle, updateTowerRunning } from './tower';
import { createDomeBuildingMesh, updateDomeIdle, updateDomeRunning } from './dome';
import { createPyramidBuildingMesh, updatePyramidIdle, updatePyramidRunning } from './pyramid';
import { createDesktopBuildingMesh, updateDesktopIdle, updateDesktopRunning } from './desktop';
import {
  createFilingCabinetBuildingMesh,
  updateFilingCabinetIdle,
  updateFilingCabinetRunning,
} from './filingCabinet';
import { createSatelliteBuildingMesh, updateSatelliteIdle, updateSatelliteRunning } from './satellite';
import { createCrystalBuildingMesh, updateCrystalIdle, updateCrystalRunning } from './crystal';
import { createFactoryBuildingMesh, updateFactoryIdle, updateFactoryRunning } from './factory';

/**
 * Create the appropriate mesh based on building style.
 */
export function createBuildingMesh(building: Building): BuildingMeshData {
  const style = building.style || 'server-rack';

  switch (style) {
    case 'tower':
      return createTowerBuildingMesh(building);
    case 'dome':
      return createDomeBuildingMesh(building);
    case 'pyramid':
      return createPyramidBuildingMesh(building);
    case 'desktop':
      return createDesktopBuildingMesh(building);
    case 'filing-cabinet':
      return createFilingCabinetBuildingMesh(building);
    case 'satellite':
      return createSatelliteBuildingMesh(building);
    case 'crystal':
      return createCrystalBuildingMesh(building);
    case 'factory':
      return createFactoryBuildingMesh(building);
    case 'server-rack':
    default:
      return createServerBuildingMesh(building);
  }
}

/**
 * Update idle animations for a building (always run regardless of status).
 */
export function updateIdleAnimations(
  meshData: BuildingMeshData,
  building: Building,
  animationTime: number,
  deltaTime: number
): void {
  const style = building.style || 'server-rack';

  switch (style) {
    case 'server-rack':
      updateServerRackIdle(meshData, animationTime);
      break;
    case 'desktop':
      updateDesktopIdle(meshData, animationTime);
      break;
    case 'filing-cabinet':
      updateFilingCabinetIdle(meshData, animationTime);
      break;
    case 'satellite':
      updateSatelliteIdle(meshData, animationTime, deltaTime);
      break;
    case 'crystal':
      updateCrystalIdle(meshData, animationTime, deltaTime);
      break;
    case 'factory':
      updateFactoryIdle(meshData, animationTime, deltaTime);
      break;
    case 'tower':
      updateTowerIdle(meshData, animationTime, deltaTime);
      break;
    case 'dome':
      updateDomeIdle(meshData, animationTime, deltaTime);
      break;
    case 'pyramid':
      updatePyramidIdle(meshData, animationTime);
      break;
  }
}

/**
 * Update running animations for a building.
 */
export function updateRunningAnimations(
  meshData: BuildingMeshData,
  building: Building,
  animationTime: number,
  deltaTime: number
): void {
  const style = building.style || 'server-rack';

  // Status glow pulse
  const statusGlow = meshData.group.getObjectByName('statusGlow') as THREE.Mesh;
  const pulse = Math.sin(animationTime * 3) * 0.2 + 0.8;
  if (statusGlow && statusGlow.material instanceof THREE.MeshBasicMaterial) {
    statusGlow.material.opacity = 0.3 * pulse;
  }

  switch (style) {
    case 'server-rack':
      updateServerRackRunning(meshData, animationTime);
      break;
    case 'tower':
      updateTowerRunning(meshData, animationTime, deltaTime);
      break;
    case 'dome':
      updateDomeRunning(meshData, animationTime, deltaTime);
      break;
    case 'pyramid':
      updatePyramidRunning(meshData, animationTime);
      break;
    case 'desktop':
      updateDesktopRunning(meshData, animationTime);
      break;
    case 'filing-cabinet':
      updateFilingCabinetRunning(meshData, animationTime);
      break;
    case 'satellite':
      updateSatelliteRunning(meshData, animationTime, deltaTime);
      break;
    case 'crystal':
      updateCrystalRunning(meshData, animationTime, deltaTime);
      break;
    case 'factory':
      updateFactoryRunning(meshData, animationTime, deltaTime);
      break;
  }
}

/**
 * Update starting/stopping animations (fast pulse).
 */
export function updateTransitionAnimations(
  meshData: BuildingMeshData,
  animationTime: number
): void {
  const statusGlow = meshData.group.getObjectByName('statusGlow') as THREE.Mesh;
  const pulse = Math.sin(animationTime * 8) * 0.5 + 0.5;
  if (statusGlow && statusGlow.material instanceof THREE.MeshBasicMaterial) {
    statusGlow.material.opacity = 0.5 * pulse;
  }
}

/**
 * Update error animations (slow pulse).
 */
export function updateErrorAnimations(
  meshData: BuildingMeshData,
  animationTime: number
): void {
  const statusGlow = meshData.group.getObjectByName('statusGlow') as THREE.Mesh;
  const pulse = Math.sin(animationTime * 2) * 0.5 + 0.5;
  if (statusGlow && statusGlow.material instanceof THREE.MeshBasicMaterial) {
    statusGlow.material.opacity = 0.4 * pulse;
  }
}
