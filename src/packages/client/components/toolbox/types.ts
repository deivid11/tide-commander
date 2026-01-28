import type { DrawingTool } from '../../../shared/types';

// Time mode options
export type TimeMode = 'auto' | 'day' | 'night' | 'dawn' | 'dusk';

// Floor style options
export type FloorStyle = 'none' | 'concrete' | 'galactic' | 'metal' | 'hex' | 'circuit' | 'pokemon-stadium';

// Terrain options
export interface TerrainConfig {
  showTrees: boolean;
  showBushes: boolean;
  showHouse: boolean;
  showLamps: boolean;
  showGrass: boolean;
  showClouds: boolean;
  fogDensity: number; // 0 = none, 1 = normal, 2 = heavy
  floorStyle: FloorStyle;
  brightness: number; // 0.2 = dark, 1 = normal, 2 = bright
  skyColor: string | null; // null = auto (based on time), or hex color like '#4a90d9'
}

// Color mode type for agent models
export type ColorMode = 'normal' | 'bw' | 'sepia' | 'cool' | 'warm' | 'neon';

// Agent model style config
export interface ModelStyleConfig {
  saturation: number;      // 0 = grayscale, 1 = normal, 2 = vivid
  roughness: number;       // -1 = use original, 0-1 = override
  metalness: number;       // -1 = use original, 0-1 = override
  emissiveBoost: number;   // 0 = normal, positive = add glow
  envMapIntensity: number; // -1 = use original, 0-2 = override
  wireframe: boolean;      // true = wireframe rendering mode
  colorMode: ColorMode;    // color grading preset
}

// Animation type for status
export type AnimationType = 'static' | 'idle' | 'walk' | 'sprint' | 'jump' | 'fall' | 'crouch' | 'sit' | 'die' | 'emote-yes' | 'emote-no';

// Animation config for different agent statuses
export interface AnimationConfig {
  idleAnimation: AnimationType;
  workingAnimation: AnimationType;
}

export interface SceneConfig {
  characterScale: number;
  indicatorScale: number;
  gridVisible: boolean;
  timeMode: TimeMode;
  terrain: TerrainConfig;
  modelStyle: ModelStyleConfig;
  animations: AnimationConfig;
  fpsLimit: number; // 0 = unlimited, otherwise max FPS (e.g., 30, 60)
}

export interface ToolboxProps {
  onConfigChange: (config: SceneConfig) => void;
  onToolChange: (tool: DrawingTool) => void;
  config: SceneConfig;
  isOpen: boolean;
  onClose: () => void;
  onOpenBuildingModal?: (buildingId?: string) => void;
  onOpenAreaExplorer?: (areaId: string) => void;
}
