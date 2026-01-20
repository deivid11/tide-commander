/**
 * Reusable hook for modal state management
 * Provides consistent open/close/toggle behavior and optional data passing
 */

import { useState, useCallback } from 'react';

export interface ModalState<T = undefined> {
  /** Whether the modal is currently open */
  isOpen: boolean;
  /** Data associated with the modal (e.g., item being edited) */
  data: T | undefined;
  /** Open the modal, optionally with data */
  open: (data?: T) => void;
  /** Close the modal and clear data */
  close: () => void;
  /** Toggle the modal open/closed */
  toggle: () => void;
  /** Update the data without changing open state */
  setData: (data: T | undefined) => void;
}

/**
 * Hook for managing modal state with optional associated data
 *
 * @example
 * // Simple modal without data
 * const confirmModal = useModalState();
 * // <Modal isOpen={confirmModal.isOpen} onClose={confirmModal.close} />
 * // <button onClick={confirmModal.open}>Open</button>
 *
 * @example
 * // Modal with data (e.g., editing an item)
 * const editModal = useModalState<Agent>();
 * // <EditModal isOpen={editModal.isOpen} agent={editModal.data} onClose={editModal.close} />
 * // <button onClick={() => editModal.open(agent)}>Edit</button>
 */
export function useModalState<T = undefined>(
  initialOpen: boolean = false,
  initialData?: T
): ModalState<T> {
  const [isOpen, setIsOpen] = useState(initialOpen);
  const [data, setData] = useState<T | undefined>(initialData);

  const open = useCallback((newData?: T) => {
    if (newData !== undefined) {
      setData(newData);
    }
    setIsOpen(true);
  }, []);

  const close = useCallback(() => {
    setIsOpen(false);
    // Optionally clear data after a short delay to allow for exit animations
    // setData(undefined);
  }, []);

  const toggle = useCallback(() => {
    setIsOpen(prev => !prev);
  }, []);

  return {
    isOpen,
    data,
    open,
    close,
    toggle,
    setData,
  };
}

/**
 * Hook for managing modal state with an ID-based pattern
 * Useful for edit modals where you track which item is being edited
 *
 * @example
 * const editModal = useModalStateWithId<string>();
 * // <EditModal isOpen={editModal.isOpen} itemId={editModal.id} onClose={editModal.close} />
 * // <button onClick={() => editModal.open(item.id)}>Edit</button>
 */
export interface ModalStateWithId {
  /** Whether the modal is currently open */
  isOpen: boolean;
  /** ID of the item being edited (null when closed) */
  id: string | null;
  /** Open the modal for a specific item */
  open: (id: string) => void;
  /** Close the modal and clear the ID */
  close: () => void;
}

export function useModalStateWithId(): ModalStateWithId {
  const [id, setId] = useState<string | null>(null);

  const open = useCallback((newId: string) => {
    setId(newId);
  }, []);

  const close = useCallback(() => {
    setId(null);
  }, []);

  return {
    isOpen: id !== null,
    id,
    open,
    close,
  };
}

export default useModalState;
