/**
 * useKeyboardHeight - Hook for mobile keyboard height handling
 *
 * Uses the Visual Viewport API to detect keyboard height and adjust layout.
 * Sets CSS custom properties for components to react to keyboard state.
 */

import { useCallback, useRef } from 'react';

export interface UseKeyboardHeightReturn {
  /** Ref to track if an input is currently focused */
  isInputFocusedRef: React.MutableRefObject<boolean>;
  /** Ref to track if scroll should be locked during keyboard adjustment */
  keyboardScrollLockRef: React.MutableRefObject<boolean>;
  /** Handler for input focus events */
  handleInputFocus: () => void;
  /** Handler for input blur events */
  handleInputBlur: () => void;
  /** Cleanup function to remove listeners and reset styles */
  cleanup: () => void;
}

export function useKeyboardHeight(): UseKeyboardHeightReturn {
  const isInputFocusedRef = useRef(false);
  const keyboardScrollLockRef = useRef(false);
  const keyboardHandlerRef = useRef<(() => void) | null>(null);
  const lastKeyboardHeightRef = useRef<number>(0);
  const keyboardRafRef = useRef<number>(0);
  const initialViewportHeightRef = useRef<number>(0);

  // Set the CSS custom property for keyboard height on the app element
  const setKeyboardHeight = useCallback((height: number) => {
    const app = document.querySelector('.app.mobile-view-terminal') as HTMLElement;
    if (app) {
      app.style.setProperty('--keyboard-height', `${height}px`);
      app.style.setProperty('--keyboard-visible', height > 0 ? '1' : '0');
    }
    lastKeyboardHeightRef.current = height;
  }, []);

  // Reset keyboard styles by clearing the CSS custom property
  const resetKeyboardStyles = useCallback(() => {
    setKeyboardHeight(0);
    keyboardScrollLockRef.current = false;
  }, [setKeyboardHeight]);

  // Cleanup keyboard listeners
  const cleanupKeyboardHandling = useCallback(() => {
    // Cancel any pending RAF
    if (keyboardRafRef.current) {
      cancelAnimationFrame(keyboardRafRef.current);
      keyboardRafRef.current = 0;
    }

    // Remove viewport listeners
    if (window.visualViewport && keyboardHandlerRef.current) {
      window.visualViewport.removeEventListener('resize', keyboardHandlerRef.current);
      window.visualViewport.removeEventListener('scroll', keyboardHandlerRef.current);
      keyboardHandlerRef.current = null;
    }
  }, []);

  // On mobile, adjust layout when keyboard opens so input stays visible
  const handleInputFocus = useCallback(() => {
    isInputFocusedRef.current = true;

    const isMobile = window.innerWidth <= 768;
    if (!isMobile) return;

    // Cleanup any existing handlers first
    cleanupKeyboardHandling();

    // Lock scrolling during keyboard animation to prevent auto-scroll from interfering
    keyboardScrollLockRef.current = true;

    // Use Visual Viewport API - the most reliable way to detect keyboard on modern mobile browsers
    if (window.visualViewport) {
      // Capture initial viewport height BEFORE keyboard opens (only once per session)
      if (initialViewportHeightRef.current === 0) {
        initialViewportHeightRef.current = window.visualViewport.height;
      }

      const adjustForKeyboard = () => {
        const viewport = window.visualViewport;
        if (!viewport) return;

        // Cancel previous RAF to debounce rapid calls
        if (keyboardRafRef.current) {
          cancelAnimationFrame(keyboardRafRef.current);
        }

        keyboardRafRef.current = requestAnimationFrame(() => {
          // Only adjust if input is still focused
          if (!isInputFocusedRef.current) {
            resetKeyboardStyles();
            return;
          }

          // Compare current visualViewport.height to initial height
          const currentViewportHeight = viewport.height;
          const initialHeight = initialViewportHeightRef.current;

          // Keyboard height is the difference
          let keyboardHeight = Math.max(0, initialHeight - currentViewportHeight);

          // Apply minimum threshold to avoid false positives from address bar changes
          if (keyboardHeight < 150) {
            keyboardHeight = 0;
          }

          // Update the CSS custom property
          if (keyboardHeight !== lastKeyboardHeightRef.current) {
            setKeyboardHeight(keyboardHeight);
          }

          // Release scroll lock after keyboard has stabilized
          if (keyboardHeight > 0) {
            setTimeout(() => {
              keyboardScrollLockRef.current = false;
            }, 300);
          }
        });
      };

      // Store handler reference for cleanup
      keyboardHandlerRef.current = adjustForKeyboard;

      // Listen for viewport changes
      window.visualViewport.addEventListener('resize', adjustForKeyboard);
      window.visualViewport.addEventListener('scroll', adjustForKeyboard);

      // Initial adjustment
      adjustForKeyboard();
    }
  }, [cleanupKeyboardHandling, resetKeyboardStyles, setKeyboardHeight]);

  const handleInputBlur = useCallback(() => {
    isInputFocusedRef.current = false;

    const isMobile = window.innerWidth <= 768;
    if (!isMobile) return;

    // Small delay to handle blur->refocus scenarios
    setTimeout(() => {
      // Only reset if still not focused
      if (!isInputFocusedRef.current) {
        resetKeyboardStyles();
        cleanupKeyboardHandling();
      }
    }, 100);
  }, [resetKeyboardStyles, cleanupKeyboardHandling]);

  const cleanup = useCallback(() => {
    const isMobile = window.innerWidth <= 768;
    if (isMobile && lastKeyboardHeightRef.current > 0) {
      isInputFocusedRef.current = false;
      resetKeyboardStyles();
      cleanupKeyboardHandling();
    }
  }, [resetKeyboardStyles, cleanupKeyboardHandling]);

  return {
    isInputFocusedRef,
    keyboardScrollLockRef,
    handleInputFocus,
    handleInputBlur,
    cleanup,
  };
}
