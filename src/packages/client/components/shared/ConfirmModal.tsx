/**
 * ConfirmModal - Reusable confirmation dialog
 *
 * Replaces native window.confirm() with a TC-styled modal dialog. Reuses the
 * existing .modal-overlay / .modal / .confirm-modal styles defined in
 * styles/components/_modal.scss so the look matches every other TC dialog.
 */

import React, { useEffect, useRef } from 'react';
import { ModalPortal } from './ModalPortal';
import { useModalClose } from '../../hooks';

export interface ConfirmModalProps {
  isOpen: boolean;
  title: string;
  message: React.ReactNode;
  note?: React.ReactNode;
  confirmLabel: string;
  cancelLabel: string;
  variant?: 'danger' | 'primary';
  onConfirm: () => void;
  onClose: () => void;
}

export function ConfirmModal({
  isOpen,
  title,
  message,
  note,
  confirmLabel,
  cancelLabel,
  variant = 'danger',
  onConfirm,
  onClose,
}: ConfirmModalProps) {
  const { handleMouseDown: handleBackdropMouseDown, handleClick: handleBackdropClick } = useModalClose(onClose);
  const confirmBtnRef = useRef<HTMLButtonElement>(null);

  // Focus the destructive action so keyboard users can hit Enter immediately —
  // matches TerminalModals.ContextConfirmModal behavior.
  useEffect(() => {
    if (isOpen) {
      confirmBtnRef.current?.focus();
    }
  }, [isOpen]);

  // Escape closes the dialog. Capture-phase so it wins over inner handlers.
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [isOpen, onClose]);

  const handleConfirm = () => {
    onConfirm();
    onClose();
  };

  if (!isOpen) return null;

  return (
    <ModalPortal>
      <div
        className="modal-overlay visible"
        role="presentation"
        onMouseDown={handleBackdropMouseDown}
        onClick={handleBackdropClick}
      >
        <div
          className="modal confirm-modal"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="confirm-modal-title"
          aria-describedby="confirm-modal-body"
        >
          <div className="modal-header" id="confirm-modal-title">{title}</div>
          <div className="modal-body confirm-modal-body" id="confirm-modal-body">
            <p>{message}</p>
            {note && <p className="confirm-modal-note">{note}</p>}
          </div>
          <div className="modal-footer">
            <button className="btn btn-secondary" onClick={onClose}>
              {cancelLabel}
            </button>
            <button
              ref={confirmBtnRef}
              className={`btn ${variant === 'danger' ? 'btn-danger' : 'btn-primary'}`}
              onClick={handleConfirm}
            >
              {confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </ModalPortal>
  );
}
