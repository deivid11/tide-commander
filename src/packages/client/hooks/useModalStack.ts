/**
 * Modal stack management for mobile back gesture handling
 *
 * When a modal opens, it registers itself on the stack.
 * When the back gesture is triggered on mobile, the topmost modal is closed
 * instead of navigating away from the page.
 */

import { useEffect, useCallback, useRef } from 'react';

// Global modal stack - stores close functions in order
const modalStack: Array<{ id: string; close: () => void }> = [];

// Listeners that get notified when stack changes
const stackListeners: Set<() => void> = new Set();

function notifyListeners() {
  stackListeners.forEach(listener => listener());
}

/**
 * Register a modal on the stack when it opens.
 * Returns an unregister function to call when the modal closes.
 */
export function registerModal(id: string, close: () => void): () => void {
  // Remove any existing entry with same ID (shouldn't happen, but be safe)
  const existingIndex = modalStack.findIndex(m => m.id === id);
  if (existingIndex !== -1) {
    modalStack.splice(existingIndex, 1);
  }

  modalStack.push({ id, close });
  notifyListeners();

  return () => {
    const index = modalStack.findIndex(m => m.id === id);
    if (index !== -1) {
      modalStack.splice(index, 1);
      notifyListeners();
    }
  };
}

/**
 * Close the topmost modal on the stack.
 * Returns true if a modal was closed, false if the stack was empty.
 */
export function closeTopModal(): boolean {
  if (modalStack.length === 0) {
    return false;
  }

  const topModal = modalStack.pop()!;
  topModal.close();
  notifyListeners();
  return true;
}

/**
 * Check if there are any modals open
 */
export function hasOpenModals(): boolean {
  return modalStack.length > 0;
}

/**
 * Close all modals on the stack except the terminal.
 * Used when opening the terminal on mobile to ensure a clean view.
 */
export function closeAllModalsExcept(...excludeIds: string[]): void {
  // Close modals from top to bottom, skipping excluded ones
  const excludeSet = new Set(excludeIds);
  while (modalStack.length > 0) {
    const topModal = modalStack[modalStack.length - 1];
    if (excludeSet.has(topModal.id)) {
      break; // Stop if we hit an excluded modal
    }
    modalStack.pop();
    topModal.close();
  }
  notifyListeners();
}

/**
 * Get the current stack size (for debugging)
 */
export function getStackSize(): number {
  return modalStack.length;
}

/**
 * Hook to automatically register a modal on the stack when it's open.
 *
 * @param id - Unique identifier for this modal
 * @param isOpen - Whether the modal is currently open
 * @param onClose - Function to close the modal
 *
 * @example
 * const spawnModal = useModalState();
 * useModalStackRegistration('spawn-modal', spawnModal.isOpen, spawnModal.close);
 */
export function useModalStackRegistration(
  id: string,
  isOpen: boolean,
  onClose: () => void
): void {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!isOpen) return;

    // Register this modal and get unregister function
    const unregister = registerModal(id, () => closeRef.current());

    // Unregister when modal closes or component unmounts
    return unregister;
  }, [id, isOpen]);
}

/**
 * Hook to subscribe to stack changes (for debugging or UI updates)
 */
export function useModalStackSize(): number {
  const [, forceUpdate] = React.useState({});

  useEffect(() => {
    const listener = () => forceUpdate({});
    stackListeners.add(listener);
    return () => {
      stackListeners.delete(listener);
    };
  }, []);

  return modalStack.length;
}

// Need React import for useModalStackSize
import React from 'react';
