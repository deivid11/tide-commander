/**
 * Hook for managing Document Picture-in-Picture window lifecycle
 * Allows extracting UI components to a floating window that stays on top
 */

import { useState, useCallback, useRef, useEffect } from 'react';

export interface DocumentPiPOptions {
  /** Width of the PiP window */
  width?: number;
  /** Height of the PiP window */
  height?: number;
  /** Whether to copy stylesheets to the PiP window */
  copyStyleSheets?: boolean;
}

export interface DocumentPiPState {
  /** Whether the PiP window is currently open */
  isOpen: boolean;
  /** The PiP window object (null when closed) */
  pipWindow: Window | null;
  /** The container element inside the PiP window for rendering */
  pipContainer: HTMLElement | null;
  /** Whether Document PiP is supported in the browser */
  isSupported: boolean;
  /** Open the PiP window */
  open: (options?: DocumentPiPOptions) => Promise<boolean>;
  /** Close the PiP window */
  close: () => void;
  /** Toggle the PiP window */
  toggle: (options?: DocumentPiPOptions) => Promise<void>;
}

const DEFAULT_OPTIONS: DocumentPiPOptions = {
  width: 400,
  height: 300,
  copyStyleSheets: true,
};

/**
 * Check if Document Picture-in-Picture API is supported
 */
export function isDocumentPiPSupported(): boolean {
  return 'documentPictureInPicture' in window;
}

/**
 * Copy stylesheets from the main document to the PiP window
 */
function copyStyles(sourceDoc: Document, targetDoc: Document): void {
  // Copy all stylesheets
  for (const styleSheet of sourceDoc.styleSheets) {
    try {
      if (styleSheet.cssRules) {
        const newStyleEl = targetDoc.createElement('style');
        for (const cssRule of styleSheet.cssRules) {
          newStyleEl.appendChild(targetDoc.createTextNode(cssRule.cssText));
        }
        targetDoc.head.appendChild(newStyleEl);
      }
    } catch (e) {
      // Handle cross-origin stylesheets by linking them
      if (styleSheet.href) {
        const newLinkEl = targetDoc.createElement('link');
        newLinkEl.rel = 'stylesheet';
        newLinkEl.href = styleSheet.href;
        targetDoc.head.appendChild(newLinkEl);
      }
    }
  }

  // Copy CSS custom properties from :root
  const rootStyles = sourceDoc.documentElement.style.cssText;
  if (rootStyles) {
    targetDoc.documentElement.style.cssText = rootStyles;
  }

  // Copy computed CSS variables from :root
  const computedStyles = getComputedStyle(sourceDoc.documentElement);
  const cssVars: string[] = [];
  for (let i = 0; i < computedStyles.length; i++) {
    const prop = computedStyles[i];
    if (prop.startsWith('--')) {
      cssVars.push(`${prop}: ${computedStyles.getPropertyValue(prop)}`);
    }
  }
  if (cssVars.length > 0) {
    const varsStyle = targetDoc.createElement('style');
    varsStyle.textContent = `:root { ${cssVars.join('; ')} }`;
    targetDoc.head.appendChild(varsStyle);
  }
}

/**
 * Hook for managing Document Picture-in-Picture windows
 *
 * @example
 * const pip = useDocumentPiP();
 *
 * if (!pip.isSupported) {
 *   return <p>PiP not supported</p>;
 * }
 *
 * return (
 *   <>
 *     <button onClick={() => pip.open()}>Open PiP</button>
 *     {pip.isOpen && pip.pipContainer && createPortal(
 *       <MyComponent />,
 *       pip.pipContainer
 *     )}
 *   </>
 * );
 */
export function useDocumentPiP(): DocumentPiPState {
  const [isOpen, setIsOpen] = useState(false);
  const [pipWindow, setPipWindow] = useState<Window | null>(null);
  const [pipContainer, setPipContainer] = useState<HTMLElement | null>(null);
  const pipWindowRef = useRef<Window | null>(null);

  const isSupported = isDocumentPiPSupported();

  const close = useCallback(() => {
    if (pipWindowRef.current) {
      // Clean up event listeners
      const cleanupFns = (pipWindowRef.current as any).__cleanupFns;
      if (cleanupFns) {
        cleanupFns.forEach((fn: () => void) => fn());
      }
      pipWindowRef.current.close();
      pipWindowRef.current = null;
    }
    setPipWindow(null);
    setPipContainer(null);
    setIsOpen(false);
  }, []);

  const open = useCallback(async (options?: DocumentPiPOptions): Promise<boolean> => {
    if (!isSupported) {
      console.warn('Document Picture-in-Picture is not supported in this browser');
      return false;
    }

    // Close existing window if open
    if (pipWindowRef.current) {
      close();
    }

    const opts = { ...DEFAULT_OPTIONS, ...options };

    try {
      // Request PiP window from the browser
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const documentPiP = (window as any).documentPictureInPicture;
      const newPipWindow: Window = await documentPiP.requestWindow({
        width: opts.width,
        height: opts.height,
        // Keep PiP window visible when clicking other windows
        disallowReturnToOpener: true,
      });

      pipWindowRef.current = newPipWindow;

      // Copy styles if requested
      if (opts.copyStyleSheets) {
        copyStyles(document, newPipWindow.document);
      }

      // Set up the container for React portal
      const container = newPipWindow.document.createElement('div');
      container.id = 'pip-root';
      container.style.width = '100%';
      container.style.height = '100%';
      newPipWindow.document.body.appendChild(container);

      // Apply base styles to body
      newPipWindow.document.body.style.margin = '0';
      newPipWindow.document.body.style.padding = '0';
      newPipWindow.document.body.style.overflow = 'hidden';

      // Listen for window close
      newPipWindow.addEventListener('pagehide', () => {
        pipWindowRef.current = null;
        setPipWindow(null);
        setPipContainer(null);
        setIsOpen(false);
      });

      // Try to keep PiP window on top when main window gains focus
      // This is a workaround since Document PiP doesn't have true always-on-top
      const handleMainWindowFocus = () => {
        if (pipWindowRef.current && !pipWindowRef.current.closed) {
          // Small delay to let the focus event complete
          setTimeout(() => {
            pipWindowRef.current?.focus();
          }, 50);
        }
      };

      // Also handle visibility change to bring PiP back to front
      const handleVisibilityChange = () => {
        if (document.visibilityState === 'visible' && pipWindowRef.current && !pipWindowRef.current.closed) {
          setTimeout(() => {
            pipWindowRef.current?.focus();
          }, 100);
        }
      };

      window.addEventListener('focus', handleMainWindowFocus);
      document.addEventListener('visibilitychange', handleVisibilityChange);

      // Store cleanup functions
      (newPipWindow as any).__cleanupFns = [
        () => window.removeEventListener('focus', handleMainWindowFocus),
        () => document.removeEventListener('visibilitychange', handleVisibilityChange),
      ];

      setPipWindow(newPipWindow);
      setPipContainer(container);
      setIsOpen(true);

      return true;
    } catch (error) {
      console.error('Failed to open Picture-in-Picture window:', error);
      return false;
    }
  }, [isSupported, close]);

  const toggle = useCallback(async (options?: DocumentPiPOptions): Promise<void> => {
    if (isOpen) {
      close();
    } else {
      await open(options);
    }
  }, [isOpen, open, close]);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      if (pipWindowRef.current) {
        pipWindowRef.current.close();
      }
    };
  }, []);

  return {
    isOpen,
    pipWindow,
    pipContainer,
    isSupported,
    open,
    close,
    toggle,
  };
}

export default useDocumentPiP;
