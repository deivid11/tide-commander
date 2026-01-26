import React, { useEffect, useRef, useCallback } from 'react';
import './ContextMenu.css';

export interface ContextMenuAction {
  id: string;
  label: string;
  icon?: string;
  shortcut?: string;
  disabled?: boolean;
  danger?: boolean;
  divider?: boolean;
  onClick: () => void;
}

export interface ContextMenuProps {
  isOpen: boolean;
  position: { x: number; y: number };
  worldPosition: { x: number; z: number };
  actions: ContextMenuAction[];
  onClose: () => void;
}

export function ContextMenu({ isOpen, position, actions, onClose }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const cleanupRef = useRef<(() => void) | null>(null);

  // Close on click/touch outside
  useEffect(() => {
    if (!isOpen) return;

    // Small delay to prevent immediate close from the touch event that opened the menu
    const timeoutId = setTimeout(() => {
      const handleClickOutside = (e: MouseEvent | TouchEvent) => {
        if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
          onClose();
        }
      };

      const handleEscape = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
          onClose();
        }
      };

      // Close on scroll
      const handleScroll = () => {
        onClose();
      };

      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('touchstart', handleClickOutside, { passive: true });
      document.addEventListener('keydown', handleEscape);
      window.addEventListener('scroll', handleScroll, true);

      // Store cleanup function
      cleanupRef.current = () => {
        document.removeEventListener('mousedown', handleClickOutside);
        document.removeEventListener('touchstart', handleClickOutside);
        document.removeEventListener('keydown', handleEscape);
        window.removeEventListener('scroll', handleScroll, true);
      };
    }, 100); // 100ms delay to let the menu render first

    return () => {
      clearTimeout(timeoutId);
      cleanupRef.current?.();
      cleanupRef.current = null;
    };
  }, [isOpen, onClose]);

  // Adjust position to keep menu in viewport
  useEffect(() => {
    if (!isOpen || !menuRef.current) return;

    const menu = menuRef.current;
    const rect = menu.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    let adjustedX = position.x;
    let adjustedY = position.y;

    // Adjust horizontal position
    if (position.x + rect.width > viewportWidth - 10) {
      adjustedX = viewportWidth - rect.width - 10;
    }

    // Adjust vertical position
    if (position.y + rect.height > viewportHeight - 10) {
      adjustedY = viewportHeight - rect.height - 10;
    }

    // Apply adjusted position
    menu.style.left = `${Math.max(10, adjustedX)}px`;
    menu.style.top = `${Math.max(10, adjustedY)}px`;
  }, [isOpen, position]);

  const handleActionClick = useCallback((action: ContextMenuAction) => {
    if (action.disabled) return;
    action.onClick();
    onClose();
  }, [onClose]);

  if (!isOpen) return null;

  return (
    <div
      ref={menuRef}
      className="context-menu"
      style={{ left: position.x, top: position.y }}
      onClick={(e) => e.stopPropagation()}
    >
      {actions.map((action, index) => {
        if (action.divider) {
          return <div key={`divider-${index}`} className="context-menu-divider" />;
        }

        return (
          <button
            key={action.id}
            className={`context-menu-item ${action.disabled ? 'disabled' : ''} ${action.danger ? 'danger' : ''}`}
            onClick={() => handleActionClick(action)}
            onTouchEnd={(e) => {
              e.preventDefault();
              e.stopPropagation();
              handleActionClick(action);
            }}
            disabled={action.disabled}
          >
            {action.icon && <span className="context-menu-icon">{action.icon}</span>}
            <span className="context-menu-label">{action.label}</span>
            {action.shortcut && <span className="context-menu-shortcut">{action.shortcut}</span>}
          </button>
        );
      })}
    </div>
  );
}
