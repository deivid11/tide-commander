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
  const lastKeyboardVisibleRef = useRef<boolean>(false);
  const keyboardRafRef = useRef<number>(0);
  const baselineOverlapRef = useRef<number>(0);
  const baselineInnerHeightRef = useRef<number>(0);

  // Set the CSS custom property for keyboard height on the app element
  const setKeyboardState = useCallback((height: number, visible: boolean) => {
    const app = document.querySelector('.app.mobile-view-terminal') as HTMLElement;
    if (app) {
      app.style.setProperty('--keyboard-height', `${height}px`);
      app.style.setProperty('--keyboard-visible', visible ? '1' : '0');
      app.classList.toggle('keyboard-visible', visible);
    }
    lastKeyboardHeightRef.current = height;
    lastKeyboardVisibleRef.current = visible;
  }, []);

  // Reset keyboard styles by clearing the CSS custom property
  const resetKeyboardStyles = useCallback(() => {
    setKeyboardState(0, false);
    keyboardScrollLockRef.current = false;
  }, [setKeyboardState]);

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
      // Capture "UI chrome" overlap before the keyboard opens (e.g. URL bars).
      // Some browsers report a small overlap even with no keyboard, which would
      // otherwise lift the input a bit above the keyboard.
      baselineOverlapRef.current = Math.max(
        0,
        window.innerHeight - (window.visualViewport.height + window.visualViewport.offsetTop)
      );
      baselineInnerHeightRef.current = window.innerHeight;

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

          /**
           * Compute the *overlap* between the layout viewport (`window.innerHeight`)
           * and the visual viewport (`visualViewport.height + offsetTop`).
           *
           * This avoids double-applying a keyboard offset on browsers/WebViews that
           * already shrink `innerHeight` when the keyboard is shown (common on Android),
           * while still correcting browsers that keep `innerHeight` stable (common on iOS).
           */
          const visualBottom = viewport.height + viewport.offsetTop;
          const overlap = Math.max(0, window.innerHeight - visualBottom);

          // If the browser already shrinks the layout viewport when the keyboard shows,
          // applying an additional fixed-position offset will double-shift the input.
          const layoutShrink = Math.max(0, baselineInnerHeightRef.current - window.innerHeight);

          const keyboardVisible = overlap >= 120 || layoutShrink >= 120;

          // Treat small overlaps as "no keyboard" and keep updating the baseline.
          // This handles address bar expansion/collapse while focused.
          if (!keyboardVisible) {
            baselineOverlapRef.current = overlap;
            baselineInnerHeightRef.current = window.innerHeight;
          }

          // If layout is shrinking, fixed elements already sit above the keyboard.
          // Keep keyboardHeight at 0 so CSS doesn't push the input upward.
          const keyboardHeight = layoutShrink >= 120 ? 0 : Math.max(0, overlap - baselineOverlapRef.current);

          // Update the CSS custom property
          if (keyboardHeight !== lastKeyboardHeightRef.current || keyboardVisible !== lastKeyboardVisibleRef.current) {
            setKeyboardState(keyboardHeight, keyboardVisible);
          }

          // Release scroll lock after keyboard has stabilized
          if (keyboardVisible) {
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
  }, [cleanupKeyboardHandling, resetKeyboardStyles, setKeyboardState]);

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
