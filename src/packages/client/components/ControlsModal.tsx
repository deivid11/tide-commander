import React, { useState, useEffect, useCallback } from 'react';
import { useStore, store, useMouseControls } from '../store';
import { ShortcutConfig, formatShortcut } from '../store/shortcuts';
import type { MouseControlConfig, CameraSensitivityConfig } from '../store/mouseControls';
import { formatMouseBinding, findConflictingMouseBindings } from '../store/mouseControls';
import { KeyCaptureInput } from './KeyCaptureInput';

interface ControlsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

// Group shortcuts by context for display
const CONTEXT_LABELS: Record<ShortcutConfig['context'], string> = {
  global: 'Global',
  commander: 'Commander View',
  toolbox: 'Toolbox',
};

const CONTEXT_DESCRIPTIONS: Record<ShortcutConfig['context'], string> = {
  global: 'Available everywhere in the application',
  commander: 'Only active when Commander View is open',
  toolbox: 'Only active when Settings panel is open',
};

// Mouse control groups
const MOUSE_GROUPS = {
  camera: ['camera-pan', 'camera-orbit', 'camera-rotate', 'camera-zoom', 'camera-tilt'],
  interaction: ['primary-action', 'selection-box', 'context-menu', 'move-command'],
};

const MOUSE_GROUP_LABELS: Record<string, string> = {
  camera: 'Camera Controls',
  interaction: 'Interaction',
};

type ControlTab = 'keyboard' | 'mouse';

export function ControlsModal({ isOpen, onClose }: ControlsModalProps) {
  const state = useStore();
  const mouseControls = useMouseControls();
  const [activeTab, setActiveTab] = useState<ControlTab>('keyboard');
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedContext, setExpandedContext] = useState<ShortcutConfig['context'] | 'all'>('all');

  // Close on escape
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };

    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, [isOpen, onClose]);

  // Reset search when closing
  useEffect(() => {
    if (!isOpen) {
      setSearchQuery('');
    }
  }, [isOpen]);

  if (!isOpen) return null;

  // Filter shortcuts by search query
  const filteredShortcuts = state.shortcuts.filter((shortcut) => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return (
      shortcut.name.toLowerCase().includes(query) ||
      shortcut.description.toLowerCase().includes(query) ||
      formatShortcut(shortcut).toLowerCase().includes(query)
    );
  });

  // Group shortcuts by context
  const shortcutsByContext = filteredShortcuts.reduce(
    (acc, shortcut) => {
      if (!acc[shortcut.context]) {
        acc[shortcut.context] = [];
      }
      acc[shortcut.context].push(shortcut);
      return acc;
    },
    {} as Record<ShortcutConfig['context'], ShortcutConfig[]>
  );

  const handleUpdateShortcut = (
    id: string,
    updates: { key: string; modifiers: { ctrl?: boolean; alt?: boolean; shift?: boolean; meta?: boolean } }
  ) => {
    store.updateShortcut(id, updates);
  };

  const handleResetAll = () => {
    if (activeTab === 'keyboard') {
      if (confirm('Reset all keyboard shortcuts to defaults?')) {
        store.resetShortcuts();
      }
    } else {
      if (confirm('Reset all mouse controls to defaults?')) {
        store.resetMouseControls();
      }
    }
  };

  const contexts: ShortcutConfig['context'][] = ['global', 'commander', 'toolbox'];

  // Group mouse bindings by action category
  const bindingsByGroup = mouseControls.bindings.reduce(
    (acc, binding) => {
      if (MOUSE_GROUPS.camera.includes(binding.action)) {
        acc.camera.push(binding);
      } else if (MOUSE_GROUPS.interaction.includes(binding.action)) {
        acc.interaction.push(binding);
      }
      return acc;
    },
    { camera: [] as MouseControlConfig[], interaction: [] as MouseControlConfig[] }
  );

  return (
    <div className="shortcuts-modal-overlay" onClick={onClose}>
      <div className="shortcuts-modal controls-modal" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="shortcuts-modal-header">
          <div className="shortcuts-modal-title">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
            <span>Controls</span>
          </div>
          <button className="shortcuts-modal-close" onClick={onClose}>
            &times;
          </button>
        </div>

        {/* Main tabs - Keyboard / Mouse */}
        <div className="controls-main-tabs">
          <button
            className={`controls-main-tab ${activeTab === 'keyboard' ? 'active' : ''}`}
            onClick={() => setActiveTab('keyboard')}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="2" y="4" width="20" height="16" rx="2" />
              <path d="M6 8h.01M10 8h.01M14 8h.01M18 8h.01M6 12h.01M18 12h.01M8 16h8" />
            </svg>
            Keyboard
          </button>
          <button
            className={`controls-main-tab ${activeTab === 'mouse' ? 'active' : ''}`}
            onClick={() => setActiveTab('mouse')}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="6" y="3" width="12" height="18" rx="6" />
              <line x1="12" y1="7" x2="12" y2="11" />
            </svg>
            Mouse
          </button>
        </div>

        {/* Keyboard Tab Content */}
        {activeTab === 'keyboard' && (
          <>
            {/* Search and actions */}
            <div className="shortcuts-modal-toolbar">
              <div className="shortcuts-search">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="11" cy="11" r="8" />
                  <path d="M21 21l-4.35-4.35" />
                </svg>
                <input
                  type="text"
                  placeholder="Search shortcuts..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  autoFocus
                />
                {searchQuery && (
                  <button className="shortcuts-search-clear" onClick={() => setSearchQuery('')}>
                    &times;
                  </button>
                )}
              </div>
              <button className="shortcuts-reset-all-btn" onClick={handleResetAll}>
                Reset
              </button>
            </div>

            {/* Context filter tabs */}
            <div className="shortcuts-context-tabs">
              <button
                className={`shortcuts-context-tab ${expandedContext === 'all' ? 'active' : ''}`}
                onClick={() => setExpandedContext('all')}
              >
                All
                <span className="shortcuts-context-tab-count">{filteredShortcuts.length}</span>
              </button>
              {contexts.map((context) => {
                const count = shortcutsByContext[context]?.length || 0;
                return (
                  <button
                    key={context}
                    className={`shortcuts-context-tab ${expandedContext === context ? 'active' : ''}`}
                    onClick={() => setExpandedContext(context)}
                  >
                    {CONTEXT_LABELS[context]}
                    <span className="shortcuts-context-tab-count">{count}</span>
                  </button>
                );
              })}
            </div>

            {/* Shortcuts list */}
            <div className="shortcuts-modal-content">
              {contexts.map((context) => {
                const shortcuts = shortcutsByContext[context] || [];
                if (shortcuts.length === 0) return null;
                if (expandedContext !== 'all' && expandedContext !== context) return null;

                return (
                  <div key={context} className="shortcuts-context-group">
                    {expandedContext === 'all' && (
                      <div className="shortcuts-context-header">
                        <span className="shortcuts-context-label">{CONTEXT_LABELS[context]}</span>
                        <span className="shortcuts-context-description">{CONTEXT_DESCRIPTIONS[context]}</span>
                      </div>
                    )}
                    <div className="shortcuts-grid">
                      {shortcuts.map((shortcut) => (
                        <div key={shortcut.id} className="shortcut-item">
                          <div className="shortcut-item-info">
                            <span className="shortcut-item-name">{shortcut.name}</span>
                            <span className="shortcut-item-description">{shortcut.description}</span>
                          </div>
                          <KeyCaptureInput
                            shortcut={shortcut}
                            onUpdate={(updates) => handleUpdateShortcut(shortcut.id, updates)}
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}

              {filteredShortcuts.length === 0 && (
                <div className="shortcuts-empty">
                  <p>No shortcuts found for "{searchQuery}"</p>
                </div>
              )}
            </div>
          </>
        )}

        {/* Mouse Tab Content */}
        {activeTab === 'mouse' && (
          <>
            <div className="shortcuts-modal-toolbar">
              <span className="mouse-controls-subtitle">Camera and interaction bindings</span>
              <button className="shortcuts-reset-all-btn" onClick={handleResetAll}>
                Reset
              </button>
            </div>

            <div className="shortcuts-modal-content mouse-controls-content">
              {/* Mouse bindings */}
              <div className="mouse-controls-bindings">
                {Object.entries(bindingsByGroup).map(([group, bindings]) => (
                  <div key={group} className="shortcuts-context-group">
                    <div className="shortcuts-context-header">
                      <span className="shortcuts-context-label">{MOUSE_GROUP_LABELS[group]}</span>
                    </div>
                    <div className="shortcuts-grid">
                      {bindings.map((binding) => (
                        <MouseBindingItem key={binding.id} binding={binding} />
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              {/* Sensitivity settings */}
              <div className="shortcuts-context-group">
                <div className="shortcuts-context-header">
                  <span className="shortcuts-context-label">Sensitivity</span>
                  <span className="shortcuts-context-description">Adjust camera movement speed</span>
                </div>
                <SensitivitySettings sensitivity={mouseControls.sensitivity} />
              </div>
            </div>
          </>
        )}

        {/* Footer */}
        <div className="shortcuts-modal-footer">
          <span className="shortcuts-modal-hint">
            {activeTab === 'keyboard'
              ? 'Click on a shortcut to change it. Press Escape to cancel.'
              : 'Click binding to change. Hold modifiers (Alt/Shift/Ctrl) while clicking.'}
          </span>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Mouse Binding Item Component
// ============================================================================

interface MouseBindingItemProps {
  binding: MouseControlConfig;
}

function MouseBindingItem({ binding }: MouseBindingItemProps) {
  const mouseControls = useMouseControls();
  const [isCapturing, setIsCapturing] = useState(false);
  const [pendingCapture, setPendingCapture] = useState<{
    button: 'left' | 'right' | 'middle' | 'back' | 'forward';
    modifiers: { ctrl?: boolean; alt?: boolean; shift?: boolean; meta?: boolean };
  } | null>(null);

  // Capture mouse clicks when in capture mode
  useEffect(() => {
    if (!isCapturing) return;

    const handleMouseDown = (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();

      const buttonMap: Record<number, 'left' | 'right' | 'middle' | 'back' | 'forward'> = {
        0: 'left',
        1: 'middle',
        2: 'right',
        3: 'back',
        4: 'forward',
      };

      const button = buttonMap[e.button];
      if (!button) return;

      setPendingCapture({
        button,
        modifiers: {
          ctrl: e.ctrlKey,
          alt: e.altKey,
          shift: e.shiftKey,
          meta: e.metaKey,
        },
      });
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        setIsCapturing(false);
        setPendingCapture(null);
      }
    };

    const handleClickOutside = () => {
      if (pendingCapture) {
        const conflicts = findConflictingMouseBindings(mouseControls.bindings, pendingCapture, binding.id);
        if (conflicts.length === 0) {
          store.updateMouseBinding(binding.id, {
            button: pendingCapture.button,
            modifiers: pendingCapture.modifiers,
          });
        }
      }
      setIsCapturing(false);
      setPendingCapture(null);
    };

    const timeoutId = setTimeout(() => {
      document.addEventListener('mousedown', handleMouseDown, true);
      document.addEventListener('keydown', handleKeyDown, true);
      document.addEventListener('click', handleClickOutside, true);
    }, 100);

    return () => {
      clearTimeout(timeoutId);
      document.removeEventListener('mousedown', handleMouseDown, true);
      document.removeEventListener('keydown', handleKeyDown, true);
      document.removeEventListener('click', handleClickOutside, true);
    };
  }, [isCapturing, pendingCapture, binding.id, mouseControls.bindings]);

  const conflicts = pendingCapture
    ? findConflictingMouseBindings(mouseControls.bindings, pendingCapture, binding.id)
    : [];

  const displayValue = pendingCapture
    ? formatMouseBinding({ ...binding, ...pendingCapture })
    : formatMouseBinding(binding);

  return (
    <div className={`shortcut-item ${!binding.enabled ? 'disabled' : ''}`}>
      <div className="shortcut-item-info">
        <span className="shortcut-item-name">{binding.name}</span>
        <span className="shortcut-item-description">{binding.description}</span>
      </div>
      <div className="key-capture-container">
        <button
          className={`key-capture-input ${isCapturing ? 'capturing' : ''} ${conflicts.length > 0 ? 'conflict' : ''}`}
          onClick={() => setIsCapturing(true)}
        >
          {isCapturing ? (
            pendingCapture ? (
              <span className="key-capture-value" style={{ color: '#f1fa8c' }}>
                {displayValue}
              </span>
            ) : (
              <span style={{ color: '#6272a4', fontStyle: 'italic' }}>Click...</span>
            )
          ) : (
            <span className="key-capture-value">{displayValue}</span>
          )}
        </button>
        {conflicts.length > 0 && (
          <span className="key-capture-conflict">Conflicts: {conflicts.map((c) => c.name).join(', ')}</span>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// Sensitivity Settings Component
// ============================================================================

interface SensitivitySettingsProps {
  sensitivity: CameraSensitivityConfig;
}

function SensitivitySettings({ sensitivity }: SensitivitySettingsProps) {
  const handleChange = useCallback((key: keyof CameraSensitivityConfig, value: number | boolean) => {
    store.updateCameraSensitivity({ [key]: value });
  }, []);

  return (
    <div className="sensitivity-inline-settings">
      <div className="sensitivity-checkboxes-inline">
        <label className="sensitivity-checkbox-inline">
          <input
            type="checkbox"
            checked={sensitivity.invertPanX}
            onChange={(e) => handleChange('invertPanX', e.target.checked)}
          />
          <span>Invert Pan X</span>
        </label>
        <label className="sensitivity-checkbox-inline">
          <input
            type="checkbox"
            checked={sensitivity.invertPanY}
            onChange={(e) => handleChange('invertPanY', e.target.checked)}
          />
          <span>Invert Pan Y</span>
        </label>
        <label className="sensitivity-checkbox-inline">
          <input
            type="checkbox"
            checked={sensitivity.invertOrbitX}
            onChange={(e) => handleChange('invertOrbitX', e.target.checked)}
          />
          <span>Invert Orbit X</span>
        </label>
        <label className="sensitivity-checkbox-inline">
          <input
            type="checkbox"
            checked={sensitivity.invertOrbitY}
            onChange={(e) => handleChange('invertOrbitY', e.target.checked)}
          />
          <span>Invert Orbit Y</span>
        </label>
      </div>
    </div>
  );
}

// Keep the old export for backwards compatibility
export { ControlsModal as KeyboardShortcutsModal };
