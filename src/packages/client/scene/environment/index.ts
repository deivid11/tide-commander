/**
 * Environment Module
 *
 * Re-exports all environment-related functionality.
 */

// Main class
export { Battlefield } from './Battlefield';

// Types
export type { FloorStyle, TimePhase, TimeConfig, GalacticState } from './types';

// Time configuration (for custom usage)
export {
  getTimeConfig,
  getDawnConfig,
  getDuskConfig,
  getNightConfig,
  getDayConfig,
  interpolateConfig,
} from './timeConfig';

// Floor textures (for custom usage)
export {
  generateFloorTexture,
  drawConcreteTexture,
  drawGalacticTexture,
  drawMetalTexture,
  drawHexTexture,
  drawCircuitTexture,
} from './floorTextures';

// Galactic floor (for custom usage)
export {
  createGalacticElements,
  removeGalacticElements,
  updateGalacticAnimation,
} from './galacticFloor';

// Celestial bodies (for custom usage)
export { createSun, createMoon, createStars } from './celestial';

// Terrain elements (for custom usage)
export { createTerrainElements, createGrass } from './terrain';
export type { TerrainElements } from './terrain';
