/**
 * Hook for managing context menu state
 * Tracks screen position, world position, and target for the right-click context menu
 */

import { useState, useCallback, useMemo } from 'react';

/** Target information for context menu */
export interface ContextMenuTarget {
  type: 'ground' | 'agent' | 'area' | 'building';
  id?: string; // Agent ID, Area ID, or Building ID
}

export interface ContextMenuState {
  /** Whether the context menu is currently open */
  isOpen: boolean;
  /** Screen position for rendering the menu */
  screenPosition: { x: number; y: number };
  /** World position (3D coordinates on the ground plane) */
  worldPosition: { x: number; z: number };
  /** What was clicked on (ground, agent, area, or building) */
  target: ContextMenuTarget;
  /** Open the context menu at the given positions */
  open: (
    screenPos: { x: number; y: number },
    worldPos: { x: number; z: number },
    target: ContextMenuTarget
  ) => void;
  /** Close the context menu */
  close: () => void;
}

/**
 * Hook for managing context menu state with both screen and world positions
 *
 * @example
 * const contextMenu = useContextMenu();
 * // SceneManager callback: contextMenu.open({ x: clientX, y: clientY }, { x: groundX, z: groundZ }, { type: 'agent', id: 'abc' })
 * // <ContextMenu isOpen={contextMenu.isOpen} position={contextMenu.screenPosition} target={contextMenu.target} ... />
 */
export function useContextMenu(): ContextMenuState {
  const [isOpen, setIsOpen] = useState(false);
  const [screenPosition, setScreenPosition] = useState({ x: 0, y: 0 });
  const [worldPosition, setWorldPosition] = useState({ x: 0, z: 0 });
  const [target, setTarget] = useState<ContextMenuTarget>({ type: 'ground' });

  const open = useCallback(
    (
      screenPos: { x: number; y: number },
      worldPos: { x: number; z: number },
      newTarget: ContextMenuTarget
    ) => {
      setScreenPosition(screenPos);
      setWorldPosition(worldPos);
      setTarget(newTarget);
      setIsOpen(true);
    },
    []
  );

  const close = useCallback(() => {
    setIsOpen(false);
  }, []);

  return useMemo(
    () => ({
      isOpen,
      screenPosition,
      worldPosition,
      target,
      open,
      close,
    }),
    [isOpen, screenPosition, worldPosition, target, open, close]
  );
}

export default useContextMenu;
