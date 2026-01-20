/**
 * Buildings Module
 *
 * Re-exports all building-related functionality.
 */

// Main manager
export { BuildingManager } from './BuildingManager';

// Types
export type { BuildingMeshData } from './types';
export { STATUS_COLORS, STYLE_PALETTES } from './types';

// Label utilities
export { createLabel, updateLabel } from './labelUtils';

// Style creators and animation functions
export {
  createBuildingMesh,
  createServerBuildingMesh,
  createTowerBuildingMesh,
  createDomeBuildingMesh,
  createPyramidBuildingMesh,
  createDesktopBuildingMesh,
  createFilingCabinetBuildingMesh,
  createSatelliteBuildingMesh,
  createCrystalBuildingMesh,
  createFactoryBuildingMesh,
  updateIdleAnimations,
  updateRunningAnimations,
  updateTransitionAnimations,
  updateErrorAnimations,
} from './styles';
