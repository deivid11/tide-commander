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
  defaultOpen = true,
  children,
  headerExtra,
}: {
  title: string;
  storageKey?: string;
  defaultOpen?: boolean;
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

  return (
    <div className={`collapsible-section ${isOpen ? 'open' : 'collapsed'}`}>
      <button className="collapsible-header" onClick={handleToggle}>
        <span className="collapsible-title">{title}</span>
        <span className="collapsible-header-right">
          {headerExtra}
          <span className="collapsible-arrow">{isOpen ? '▼' : '▶'}</span>
        </span>
      </button>
      {isOpen && <div className="collapsible-content">{children}</div>}
    </div>
  );
}
