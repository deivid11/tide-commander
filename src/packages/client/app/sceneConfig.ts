import { type SceneConfig, type TimeMode } from '../components/Toolbox';
import { STORAGE_KEYS, getStorage, setStorage } from '../utils/storage';

// Default terrain config
export const DEFAULT_TERRAIN = {
  showTrees: true,
  showBushes: true,
  showHouse: true,
  showLamps: true,
  showGrass: true,
  showClouds: true,
  fogDensity: 1,
  floorStyle: 'concrete' as const,
};

// Default animation config
export const DEFAULT_ANIMATIONS = {
  idleAnimation: 'sit' as const,
  workingAnimation: 'sprint' as const,
};

// Default FPS limit (0 = unlimited)
export const DEFAULT_FPS_LIMIT = 0;

/**
 * Load scene configuration from localStorage
 */
export function loadConfig(): SceneConfig {
  const defaultConfig: SceneConfig = {
    characterScale: 2.0,
    indicatorScale: 2.0,
    gridVisible: true,
    timeMode: 'day',
    terrain: DEFAULT_TERRAIN,
    animations: DEFAULT_ANIMATIONS,
    fpsLimit: DEFAULT_FPS_LIMIT,
  };

  const stored = getStorage<Partial<SceneConfig> | null>(STORAGE_KEYS.CONFIG, null);
  if (stored) {
    return {
      characterScale: stored.characterScale ?? defaultConfig.characterScale,
      indicatorScale: stored.indicatorScale ?? defaultConfig.indicatorScale,
      gridVisible: stored.gridVisible ?? defaultConfig.gridVisible,
      timeMode: stored.timeMode ?? defaultConfig.timeMode,
      terrain: { ...DEFAULT_TERRAIN, ...stored.terrain },
      animations: { ...DEFAULT_ANIMATIONS, ...stored.animations },
      fpsLimit: stored.fpsLimit ?? defaultConfig.fpsLimit,
    };
  }
  return defaultConfig;
}

/**
 * Save scene configuration to localStorage
 */
export function saveConfig(config: SceneConfig): void {
  setStorage(STORAGE_KEYS.CONFIG, config);
}
