/**
 * PiPWindow Component
 * Renders React content inside a Document Picture-in-Picture window
 */

import React, { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { DocumentPiPState } from '../../hooks/useDocumentPiP';

interface PiPWindowProps {
  /** The PiP state from useDocumentPiP hook */
  pip: DocumentPiPState;
  /** Title for the PiP window */
  title?: string;
  /** Content to render inside the PiP window */
  children: ReactNode;
}

/**
 * Renders children into a Document Picture-in-Picture window using React Portal.
 *
 * @example
 * const pip = useDocumentPiP();
 *
 * return (
 *   <>
 *     <button onClick={() => pip.open()}>Open PiP</button>
 *     <PiPWindow pip={pip} title="Agent Monitor">
 *       <AgentsPiPView />
 *     </PiPWindow>
 *   </>
 * );
 */
export function PiPWindow({ pip, title = 'Tide Commander', children }: PiPWindowProps) {
  // Set the document title when the PiP window opens
  useEffect(() => {
    if (pip.pipWindow && title) {
      pip.pipWindow.document.title = title;
    }
  }, [pip.pipWindow, title]);

  // Don't render anything if PiP is not open or container is not available
  if (!pip.isOpen || !pip.pipContainer) {
    return null;
  }

  // Use React Portal to render content into the PiP window
  return createPortal(children, pip.pipContainer);
}

export default PiPWindow;
