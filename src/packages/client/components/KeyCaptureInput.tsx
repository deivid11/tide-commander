import React, { useState, useEffect, useRef, useMemo } from 'react';
import { ShortcutConfig, ShortcutModifiers, formatShortcut, findConflictingShortcuts } from '../store/shortcuts';
import { useShortcuts } from '../store';

interface KeyCaptureInputProps {
  shortcut: ShortcutConfig;
  onUpdate: (updates: { key: string; modifiers: ShortcutModifiers }) => void;
}

export function KeyCaptureInput({ shortcut, onUpdate }: KeyCaptureInputProps) {
  const shortcuts = useShortcuts();
  const [isCapturing, setIsCapturing] = useState(false);
  const [pendingKey, setPendingKey] = useState<{ key: string; modifiers: ShortcutModifiers } | null>(null);
  const inputRef = useRef<HTMLButtonElement>(null);

  // Check for conflicts with the current or pending shortcut
  const conflicts = useMemo(() =>
    pendingKey
      ? findConflictingShortcuts(shortcuts, pendingKey, shortcut.id, shortcut.context)
      : [],
    [pendingKey, shortcuts, shortcut.id, shortcut.context]
  );

  // Handle key capture
  useEffect(() => {
    if (!isCapturing) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();

      // Escape to cancel
      if (e.key === 'Escape' && !e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey) {
        setIsCapturing(false);
        setPendingKey(null);
        return;
      }

      // Ignore modifier-only presses
      if (['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) {
        return;
      }

      // Capture the key combination
      const newKey = {
        key: e.key,
        modifiers: {
          ctrl: e.ctrlKey,
          alt: e.altKey,
          shift: e.shiftKey,
          meta: e.metaKey,
        },
      };

      setPendingKey(newKey);
    };

    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, [isCapturing]);

  // Handle clicking outside to confirm/cancel
  useEffect(() => {
    if (!isCapturing) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (inputRef.current && !inputRef.current.contains(e.target as Node)) {
        if (pendingKey && conflicts.length === 0) {
          onUpdate(pendingKey);
        }
        setIsCapturing(false);
        setPendingKey(null);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isCapturing, pendingKey, conflicts, onUpdate]);

  const handleClick = () => {
    if (isCapturing) {
      // Confirm the pending key if no conflicts
      if (pendingKey && conflicts.length === 0) {
        onUpdate(pendingKey);
      }
      setIsCapturing(false);
      setPendingKey(null);
    } else {
      setIsCapturing(true);
      setPendingKey(null);
    }
  };

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    // Disable the shortcut by clearing the key
    onUpdate({ key: '', modifiers: {} });
  };

  // Display value
  let displayValue: string;
  if (isCapturing) {
    if (pendingKey) {
      displayValue = formatShortcut({ ...shortcut, ...pendingKey });
    } else {
      displayValue = 'Press keys...';
    }
  } else if (!shortcut.key) {
    displayValue = 'Not set';
  } else {
    displayValue = formatShortcut(shortcut);
  }

  return (
    <div className="key-capture-container">
      <button
        ref={inputRef}
        className={`key-capture-input ${isCapturing ? 'capturing' : ''} ${conflicts.length > 0 ? 'conflict' : ''} ${!shortcut.enabled ? 'disabled' : ''}`}
        onClick={handleClick}
        title={isCapturing ? 'Press keys or click to confirm' : 'Click to change shortcut'}
      >
        <span className="key-capture-value">{displayValue}</span>
      </button>
      {shortcut.key && !isCapturing && (
        <button
          className="key-capture-clear"
          onClick={handleClear}
          title="Clear shortcut"
        >
          &times;
        </button>
      )}
      {conflicts.length > 0 && (
        <div className="key-capture-conflict">
          Conflicts with: {conflicts.map(c => c.name).join(', ')}
        </div>
      )}
    </div>
  );
}
