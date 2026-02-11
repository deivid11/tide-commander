import type * as THREE from 'three';
import type { AgentMeshData } from '../characters/CharacterFactory';

/**
 * Callbacks for input events.
 */
export interface InputCallbacks {
  onAgentClick: (agentId: string, shiftKey: boolean) => void;
  onAgentDoubleClick: (agentId: string) => void;
  onAgentHover?: (agentId: string | null, screenPos: ScreenPosition | null) => void;
  onGroundClick: () => void;
  onMoveCommand: (position: THREE.Vector3, agentIds: string[]) => void;
  onSelectionBox: (agentIds: string[], buildingIds: string[]) => void;
  // Drawing callbacks
  onDrawStart?: (pos: { x: number; z: number }) => void;
  onDrawMove?: (pos: { x: number; z: number }) => void;
  onDrawEnd?: (pos: { x: number; z: number }) => void;
  onAreaRightClick?: (pos: { x: number; z: number }) => void;
  onAreaClick?: (areaId: string) => void;
  onAreaDoubleClick?: (areaId: string) => void;
  // Resize callbacks
  onResizeStart?: (handle: THREE.Mesh, pos: { x: number; z: number }) => void;
  onResizeMove?: (pos: { x: number; z: number }) => void;
  onResizeEnd?: () => void;
  // Area callbacks
  onGroundClickOutsideArea?: () => void;
  onFolderIconClick?: (areaId: string) => void;
  // Building callbacks
  onBuildingClick?: (buildingId: string, screenPos: ScreenPosition) => void;
  onBuildingDoubleClick?: (buildingId: string) => void;
  onBuildingHover?: (buildingId: string | null, screenPos: ScreenPosition | null) => void;
  onBuildingDragStart?: (buildingId: string, pos: { x: number; z: number }) => void;
  onBuildingDragMove?: (buildingId: string, pos: { x: number; z: number }) => void;
  onBuildingDragEnd?: (buildingId: string, pos: { x: number; z: number }) => void;
  // Context menu callback (right-click on ground, agent, area, or building)
  onContextMenu?: (
    screenPos: { x: number; y: number },
    worldPos: { x: number; z: number },
    target: ContextMenuTarget
  ) => void;
  // Activity callback - called on user interaction to prevent idle throttling
  onActivity?: () => void;
  // Terminal toggle callback - called when Space key is pressed with agent selected
  onToggleTerminal?: () => void;
}

/**
 * Target information for context menu.
 */
export interface ContextMenuTarget {
  type: 'ground' | 'agent' | 'area' | 'building';
  id?: string; // Agent ID, Area ID, or Building ID
}

/**
 * Drawing mode checker function type.
 */
export type DrawingModeChecker = () => boolean;

/**
 * Resize handles getter function type.
 */
export type ResizeHandlesGetter = () => THREE.Mesh[];

/**
 * Folder icon meshes getter function type.
 */
export type FolderIconMeshesGetter = () => THREE.Mesh[];

/**
 * Resize mode checker function type.
 */
export type ResizeModeChecker = () => boolean;

/**
 * UI blocking checker (e.g., terminal resizing) function type.
 */
export type UIBlockingChecker = () => boolean;

/**
 * Area at position getter function type.
 */
export type AreaAtPositionGetter = (pos: { x: number; z: number }) => { id: string } | null;

/**
 * Building at position getter function type.
 */
export type BuildingAtPositionGetter = (pos: { x: number; z: number }) => { id: string } | null;

/**
 * Building positions getter for drag selection.
 */
export type BuildingPositionsGetter = () => Map<string, THREE.Vector3>;

/**
 * 2D screen position.
 */
export interface ScreenPosition {
  x: number;
  y: number;
}

/**
 * Ground position (XZ plane).
 */
export interface GroundPosition {
  x: number;
  z: number;
}

/**
 * Scene references needed for raycasting.
 */
export interface SceneReferences {
  ground: THREE.Object3D | null;
  agentMeshes: Map<string, AgentMeshData>;
}
