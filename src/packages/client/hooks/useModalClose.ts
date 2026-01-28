import { useRef, useCallback } from 'react';

/**
 * Hook to handle modal close on backdrop click while preventing
 * accidental closes during text selection.
 *
 * Problem: When selecting text in a modal, if the mouseup happens
 * on the backdrop (outside the modal content), the click handler
 * triggers and closes the modal unexpectedly.
 *
 * Solution: Track where mousedown started. Only close if both
 * mousedown and click happened on the backdrop element itself.
 */
export function useModalClose(onClose: () => void) {
  const mouseDownTargetRef = useRef<EventTarget | null>(null);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    mouseDownTargetRef.current = e.target;
  }, []);

  const handleClick = useCallback((e: React.MouseEvent) => {
    // Only close if:
    // 1. The click target is the backdrop itself (not a child)
    // 2. The mousedown also started on the backdrop
    if (e.target === e.currentTarget && mouseDownTargetRef.current === e.currentTarget) {
      onClose();
    }
    mouseDownTargetRef.current = null;
  }, [onClose]);

  return {
    handleMouseDown,
    handleClick,
  };
}
