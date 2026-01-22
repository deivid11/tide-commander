// Mouse controller configuration types and defaults
// Provides Battlefield-style camera controls with rebindable mouse buttons

// ============================================================================
// TYPES
// ============================================================================

export type MouseButton = 'left' | 'right' | 'middle' | 'back' | 'forward';

export type MouseAction =
  | 'camera-pan'
  | 'camera-orbit'
  | 'camera-rotate'
  | 'camera-zoom'
  | 'camera-tilt'
  | 'selection-box'
  | 'context-menu'
  | 'primary-action'
  | 'move-command'
  | 'none';

export interface MouseModifiers {
  ctrl?: boolean;
  alt?: boolean;
  shift?: boolean;
  meta?: boolean;
}

export interface MouseControlConfig {
  id: string;
  name: string;
  description: string;
  button: MouseButton;
  modifiers: MouseModifiers;
  action: MouseAction;
  enabled: boolean;
  sensitivity?: number; // 0.1-3.0, default 1.0
  inverted?: boolean;
}

export interface CameraSensitivityConfig {
  panSpeed: number; // 0.1-3.0
  orbitSpeed: number; // 0.1-3.0
  zoomSpeed: number; // 0.1-3.0
  smoothing: number; // 0-1, 0=instant, 1=very smooth
  invertPanX: boolean;
  invertPanY: boolean;
  invertOrbitX: boolean;
  invertOrbitY: boolean;
}

export interface TrackpadConfig {
  enabled: boolean;
  pinchToZoom: boolean;
  twoFingerPan: boolean;
  shiftTwoFingerOrbit: boolean;
  sensitivity: {
    zoom: number;
    pan: number;
    orbit: number;
  };
}

export interface MouseControlsState {
  bindings: MouseControlConfig[];
  sensitivity: CameraSensitivityConfig;
  trackpad: TrackpadConfig;
}

// ============================================================================
// DEFAULTS
// ============================================================================

export const DEFAULT_CAMERA_SENSITIVITY: CameraSensitivityConfig = {
  panSpeed: 1.0,
  orbitSpeed: 1.0,
  zoomSpeed: 1.0,
  smoothing: 0.3,
  invertPanX: false,
  invertPanY: false,
  invertOrbitX: false,
  invertOrbitY: false,
};

export const DEFAULT_TRACKPAD_CONFIG: TrackpadConfig = {
  enabled: true,
  pinchToZoom: true,
  twoFingerPan: true,
  shiftTwoFingerOrbit: true,
  sensitivity: {
    zoom: 1.0,
    pan: 1.0,
    orbit: 1.0,
  },
};

// Helper to create mouse control config
function mouseControl(
  id: string,
  name: string,
  description: string,
  button: MouseButton,
  modifiers: MouseModifiers,
  action: MouseAction,
  sensitivity?: number
): MouseControlConfig {
  return {
    id,
    name,
    description,
    button,
    modifiers,
    action,
    enabled: true,
    sensitivity,
  };
}

export const DEFAULT_MOUSE_CONTROLS: MouseControlConfig[] = [
  // Left button actions
  mouseControl(
    'left-click-select',
    'Select/Click',
    'Select agents, click on buildings/areas',
    'left',
    {},
    'primary-action'
  ),
  mouseControl(
    'left-drag-selection',
    'Selection Box',
    'Drag to select multiple agents',
    'left',
    {},
    'selection-box'
  ),

  // Right button actions
  mouseControl(
    'right-click-context',
    'Context Menu / Move',
    'Show context menu or move selected agents',
    'right',
    {},
    'context-menu'
  ),
  mouseControl(
    'alt-right-drag-pan',
    'Camera Pan',
    'Pan camera with Alt+Right-drag',
    'right',
    { alt: true },
    'camera-pan',
    1.0
  ),

  // Middle button actions
  mouseControl(
    'middle-drag-orbit',
    'Camera Orbit',
    'Orbit camera with middle-drag',
    'middle',
    {},
    'camera-orbit',
    1.0
  ),
  mouseControl(
    'shift-middle-drag-pan',
    'Camera Pan (Alt)',
    'Alternative pan with Shift+Middle-drag',
    'middle',
    { shift: true },
    'camera-pan',
    1.0
  ),

  // Wheel zoom (uses middle button slot conceptually)
  mouseControl(
    'wheel-zoom',
    'Zoom',
    'Zoom camera with scroll wheel',
    'middle',
    {},
    'camera-zoom',
    1.0
  ),
];

// ============================================================================
// UTILITIES
// ============================================================================

// Map pointer event button numbers to MouseButton type
export const BUTTON_MAP: Record<number, MouseButton> = {
  0: 'left',
  1: 'middle',
  2: 'right',
  3: 'back',
  4: 'forward',
};

// Reverse map for display
export const BUTTON_NAMES: Record<MouseButton, string> = {
  left: 'Left Click',
  right: 'Right Click',
  middle: 'Middle Click',
  back: 'Back Button',
  forward: 'Forward Button',
};

// Action display names
export const ACTION_NAMES: Record<MouseAction, string> = {
  'camera-pan': 'Pan Camera',
  'camera-orbit': 'Orbit Camera',
  'camera-rotate': 'Rotate Camera',
  'camera-zoom': 'Zoom Camera',
  'camera-tilt': 'Tilt Camera',
  'selection-box': 'Selection Box',
  'context-menu': 'Context Menu',
  'primary-action': 'Primary Action',
  'move-command': 'Move Command',
  none: 'Disabled',
};

// Format mouse binding for display
export function formatMouseBinding(binding: MouseControlConfig): string {
  const parts: string[] = [];

  if (binding.modifiers.ctrl) {
    const isMac = typeof navigator !== 'undefined' && navigator.platform.toUpperCase().includes('MAC');
    parts.push(isMac ? '⌘' : 'Ctrl');
  }
  if (binding.modifiers.alt) {
    const isMac = typeof navigator !== 'undefined' && navigator.platform.toUpperCase().includes('MAC');
    parts.push(isMac ? '⌥' : 'Alt');
  }
  if (binding.modifiers.shift) {
    parts.push('Shift');
  }

  parts.push(BUTTON_NAMES[binding.button]);

  return parts.join('+');
}

// Check if modifiers match
export function modifiersMatch(
  event: { ctrlKey: boolean; altKey: boolean; shiftKey: boolean; metaKey: boolean },
  required: MouseModifiers
): boolean {
  // For 'ctrl', also accept meta on Mac
  const ctrlMatch = required.ctrl ? event.ctrlKey || event.metaKey : !event.ctrlKey && !event.metaKey;
  const altMatch = required.alt ? event.altKey : !event.altKey;
  const shiftMatch = required.shift ? event.shiftKey : !event.shiftKey;

  return ctrlMatch && altMatch && shiftMatch;
}

// Find conflicting mouse bindings
export function findConflictingMouseBindings(
  bindings: MouseControlConfig[],
  newBinding: { button: MouseButton; modifiers: MouseModifiers },
  excludeId?: string
): MouseControlConfig[] {
  return bindings.filter((b) => {
    if (b.id === excludeId) return false;
    if (!b.enabled) return false;
    if (b.button !== newBinding.button) return false;

    // Check if modifiers match
    const bm = b.modifiers;
    const nm = newBinding.modifiers;
    return (
      (bm.ctrl || false) === (nm.ctrl || false) &&
      (bm.alt || false) === (nm.alt || false) &&
      (bm.shift || false) === (nm.shift || false)
    );
  });
}
