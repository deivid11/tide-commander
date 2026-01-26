/**
 * Reusable React hooks for the application
 */

import type { ModalState, ModalStateWithId } from './useModalState';
import type { ContextMenuState } from './useContextMenu';

export { useModalState, useModalStateWithId, type ModalState, type ModalStateWithId } from './useModalState';
export { useContextMenu, type ContextMenuState, type ContextMenuTarget } from './useContextMenu';

// Re-export types with simpler aliases for common use
export type UseModalState<T = undefined> = ModalState<T>;
export type UseModalStateWithId = ModalStateWithId;
export type UseContextMenu = ContextMenuState;
export {
  useModalStackRegistration,
  useModalStackSize,
  closeTopModal,
  closeAllModalsExcept,
  hasOpenModals,
  registerModal,
} from './useModalStack';
export { useSwipeGesture, type SwipeGestureOptions } from './useSwipeGesture';
export { useDocumentPiP, isDocumentPiPSupported, type DocumentPiPState, type DocumentPiPOptions } from './useDocumentPiP';

// Scene management hooks
export { useSceneSetup } from './useSceneSetup';
export {
  useSelectionSync,
  useAreaSync,
  useBuildingSync,
  useAreaHighlight,
  usePowerSaving,
} from './useSceneSync';
export { useKeyboardShortcuts } from './useKeyboardShortcuts';
export { useBackNavigation } from './useBackNavigation';
export { useAgentOrder } from './useAgentOrder';
