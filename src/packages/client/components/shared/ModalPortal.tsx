import React from 'react';
import { createPortal } from 'react-dom';

interface ModalPortalProps {
  children: React.ReactNode;
}

/**
 * Renders modal content at the document root to avoid ancestor stacking
 * contexts (e.g. Commander view containers with filters/overflow).
 */
export function ModalPortal({ children }: ModalPortalProps) {
  if (typeof document === 'undefined') {
    return null;
  }
  return createPortal(children, document.body);
}
