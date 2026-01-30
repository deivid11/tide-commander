import React, { useState } from 'react';

const TOOLBOX_COLLAPSE_KEY = 'tide-toolbox-collapse';

// Helper to get/set collapse state from localStorage
function getCollapseState(key: string, defaultValue: boolean): boolean {
  try {
    const stored = localStorage.getItem(`${TOOLBOX_COLLAPSE_KEY}-${key}`);
    if (stored !== null) {
      return stored === 'true';
    }
  } catch {
    // localStorage not available
  }
  return defaultValue;
}

function setCollapseState(key: string, isOpen: boolean): void {
  try {
    localStorage.setItem(`${TOOLBOX_COLLAPSE_KEY}-${key}`, String(isOpen));
  } catch {
    // localStorage not available
  }
}

// Collapsible section component with localStorage persistence
export function CollapsibleSection({
  title,
  storageKey,
  defaultOpen = false,
  forceOpen = false,
  children,
  headerExtra,
}: {
  title: string;
  storageKey?: string;
  defaultOpen?: boolean;
  forceOpen?: boolean;
  children: React.ReactNode;
  headerExtra?: React.ReactNode;
}) {
  const [isOpen, setIsOpen] = useState(() =>
    storageKey ? getCollapseState(storageKey, defaultOpen) : defaultOpen
  );

  const handleToggle = () => {
    const newState = !isOpen;
    setIsOpen(newState);
    if (storageKey) {
      setCollapseState(storageKey, newState);
    }
  };

  // Use forceOpen when searching, otherwise use internal state
  const effectivelyOpen = forceOpen || isOpen;

  return (
    <div className={`collapsible-section ${effectivelyOpen ? 'open' : 'collapsed'}`}>
      <button className="collapsible-header" onClick={handleToggle}>
        <span className="collapsible-title">{title}</span>
        <span className="collapsible-header-right">
          {headerExtra}
          <span className="collapsible-arrow">{effectivelyOpen ? '▼' : '▶'}</span>
        </span>
      </button>
      {effectivelyOpen && <div className="collapsible-content">{children}</div>}
    </div>
  );
}
