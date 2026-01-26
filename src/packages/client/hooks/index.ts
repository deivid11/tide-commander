/**
 * Reusable React hooks for the application
 */

export { useModalState, useModalStateWithId, type ModalState, type ModalStateWithId } from './useModalState';
export { useContextMenu, type ContextMenuState, type ContextMenuTarget } from './useContextMenu';
export {
  useModalStackRegistration,
  useModalStackSize,
  closeTopModal,
  closeAllModalsExcept,
  hasOpenModals,
  registerModal,
} from './useModalStack';
export { useSwipeGesture, type SwipeGestureOptions } from './useSwipeGesture';
