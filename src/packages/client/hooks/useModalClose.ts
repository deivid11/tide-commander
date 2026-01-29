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
    // Stop propagation for backdrop mousedowns to prevent terminal's click-outside handler
    // from tracking this as a potential close trigger
    if (e.target === e.currentTarget) {
      e.stopPropagation();
    }
  }, []);

  const handleClick = useCallback((e: React.MouseEvent) => {
    // Only close if:
    // 1. The click target is the backdrop itself (not a child)
    // 2. The mousedown also started on the backdrop
    if (e.target === e.currentTarget && mouseDownTargetRef.current === e.currentTarget) {
      // Stop propagation to prevent parent click handlers (like terminal's click-outside)
      // from also triggering when closing a modal inside the terminal
      e.stopPropagation();
      onClose();
    }
    mouseDownTargetRef.current = null;
  }, [onClose]);

  return {
    handleMouseDown,
    handleClick,
  };
}
