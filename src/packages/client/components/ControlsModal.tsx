import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore, store, useMouseControls, useTrackpadConfig } from '../store';
import { ShortcutConfig, formatShortcut } from '../store/shortcuts';
import type { MouseControlConfig, CameraSensitivityConfig, TrackpadConfig } from '../store/mouseControls';
import { formatMouseBinding, findConflictingMouseBindings } from '../store/mouseControls';
import { KeyCaptureInput } from './KeyCaptureInput';
import { useModalClose } from '../hooks';

interface ControlsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

// Group shortcuts by context for display - translation keys
const CONTEXT_LABEL_KEYS: Record<ShortcutConfig['context'], string> = {
  global: 'terminal:controls.contextGlobal',
  commander: 'terminal:controls.contextCommander',
  toolbox: 'terminal:controls.contextToolbox',
};

const CONTEXT_DESCRIPTION_KEYS: Record<ShortcutConfig['context'], string> = {
  global: 'terminal:controls.contextGlobalDesc',
  commander: 'terminal:controls.contextCommanderDesc',
  toolbox: 'terminal:controls.contextToolboxDesc',
};

// Mouse control groups
const MOUSE_GROUPS = {
  camera: ['camera-pan', 'camera-orbit', 'camera-rotate', 'camera-zoom', 'camera-tilt'],
  interaction: ['primary-action', 'selection-box', 'context-menu', 'move-command'],
};

const MOUSE_GROUP_LABEL_KEYS: Record<string, string> = {
  camera: 'terminal:controls.cameraControls',
  interaction: 'terminal:controls.interaction',
};

type ControlTab = 'keyboard' | 'mouse' | 'trackpad';

export function ControlsModal({ isOpen, onClose }: ControlsModalProps) {
  const { t } = useTranslation(['terminal', 'common']);
  const state = useStore();
  const mouseControls = useMouseControls();
  const trackpadConfig = useTrackpadConfig();
  const [activeTab, setActiveTab] = useState<ControlTab>('keyboard');
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedContext, setExpandedContext] = useState<ShortcutConfig['context'] | 'all'>('all');
  const [findByShortcut, setFindByShortcut] = useState(false);
  const [capturedKeys, setCapturedKeys] = useState<{ key: string; modifiers: { ctrl?: boolean; alt?: boolean; shift?: boolean; meta?: boolean } } | null>(null);
  const searchInputRef = React.useRef<HTMLInputElement>(null);

  // Must be called before any early returns to maintain hook order
  const { handleMouseDown: handleBackdropMouseDown, handleClick: handleBackdropClick } = useModalClose(onClose);

  // Close on escape (skip if find-by-shortcut is active - it handles Escape itself)
  useEffect(() => {
    if (!isOpen || findByShortcut) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };

    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, [isOpen, onClose, findByShortcut]);

  // Reset search when closing
  useEffect(() => {
    if (!isOpen) {
      setSearchQuery('');
      setFindByShortcut(false);
      setCapturedKeys(null);
    }
  }, [isOpen]);

  // Capture keystrokes when find-by-shortcut mode is active
  useEffect(() => {
    if (!isOpen || !findByShortcut) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Allow Escape to exit find-by-shortcut mode
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        setFindByShortcut(false);
        setCapturedKeys(null);
        return;
      }

      // Ignore bare modifier keys
      if (['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) return;

      e.preventDefault();
      e.stopPropagation();

      // Normalize key: on Mac, Alt/Option modifies the character (e.g., Option+H = ˙)
      let capturedKey = e.key;
      if (e.code.startsWith('Key') && e.code.length === 4) {
        capturedKey = e.code.charAt(3).toLowerCase();
      } else if (e.code.startsWith('Digit') && e.code.length === 6) {
        capturedKey = e.code.charAt(5);
      } else if (e.code === 'Space') {
        capturedKey = 'Space';
      }

      setCapturedKeys({
        key: capturedKey,
        modifiers: {
          ctrl: e.ctrlKey,
          alt: e.altKey,
          shift: e.shiftKey,
          meta: e.metaKey,
        },
      });
    };

    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, [isOpen, findByShortcut]);

  if (!isOpen) return null;

  // Filter shortcuts by search query or captured keys
  const filteredShortcuts = state.shortcuts.filter((shortcut) => {
    const localizedName = t(`terminal:controls.shortcuts.${shortcut.id}.name`, { defaultValue: shortcut.name });
    const localizedDescription = t(`terminal:controls.shortcuts.${shortcut.id}.description`, { defaultValue: shortcut.description });

    if (findByShortcut && capturedKeys) {
      // Match by key combination (normalize Space: ' ' and 'Space' are equivalent)
      const normalizeKey = (k: string) => (k === ' ' || k === 'Space') ? 'Space' : (k.length === 1 ? k.toLowerCase() : k);
      const sKey = normalizeKey(shortcut.key);
      const cKey = normalizeKey(capturedKeys.key);
      // Also match via event.code for letter keys (Alt can modify characters)
      const codeMatch = cKey.length === 1 && /^[a-zA-Z]$/.test(sKey)
        ? `Key${sKey.toUpperCase()}` === `Key${cKey.toUpperCase()}`
        : sKey === cKey;
      if (!codeMatch) return false;
      const sm = shortcut.modifiers;
      const cm = capturedKeys.modifiers;
      return (
        (sm.ctrl || false) === (cm.ctrl || false) &&
        (sm.alt || false) === (cm.alt || false) &&
        (sm.shift || false) === (cm.shift || false) &&
        (sm.meta || false) === (cm.meta || false)
      );
    }
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return (
      localizedName.toLowerCase().includes(query) ||
      localizedDescription.toLowerCase().includes(query) ||
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
      if (confirm(t('terminal:controls.confirmResetKeyboard'))) {
        store.resetShortcuts();
      }
    } else if (activeTab === 'mouse') {
      if (confirm(t('terminal:controls.confirmResetMouse'))) {
        store.resetMouseControls();
      }
    } else if (activeTab === 'trackpad') {
      if (confirm(t('terminal:controls.confirmResetTrackpad'))) {
        store.resetMouseControls(); // This resets trackpad too
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
    <div className="shortcuts-modal-overlay" onMouseDown={handleBackdropMouseDown} onClick={handleBackdropClick}>
      <div className="shortcuts-modal controls-modal">
        {/* Header */}
        <div className="shortcuts-modal-header">
          <div className="shortcuts-modal-title">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
            <span>{t('terminal:controls.title')}</span>
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
            {t('terminal:controls.keyboard')}
          </button>
          <button
            className={`controls-main-tab ${activeTab === 'mouse' ? 'active' : ''}`}
            onClick={() => setActiveTab('mouse')}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="6" y="3" width="12" height="18" rx="6" />
              <line x1="12" y1="7" x2="12" y2="11" />
            </svg>
            {t('terminal:controls.mouse')}
          </button>
          <button
            className={`controls-main-tab ${activeTab === 'trackpad' ? 'active' : ''}`}
            onClick={() => setActiveTab('trackpad')}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="2" y="4" width="20" height="16" rx="2" />
              <circle cx="12" cy="12" r="3" />
            </svg>
            {t('terminal:controls.trackpad')}
          </button>
        </div>

        {/* Keyboard Tab Content */}
        {activeTab === 'keyboard' && (
          <>
            {/* Search and actions */}
            <div className="shortcuts-modal-toolbar">
              {findByShortcut ? (
                <div className={`shortcuts-search find-by-shortcut-active`}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="2" y="4" width="20" height="16" rx="2" />
                    <path d="M6 8h.01M10 8h.01M14 8h.01M18 8h.01M6 12h.01M18 12h.01M8 16h8" />
                  </svg>
                  {capturedKeys ? (
                    <span className="find-by-shortcut-display">
                      {formatShortcut({ key: capturedKeys.key, modifiers: capturedKeys.modifiers } as ShortcutConfig)}
                      <button className="shortcuts-search-clear" onClick={() => setCapturedKeys(null)}>
                        &times;
                      </button>
                    </span>
                  ) : (
                    <span className="find-by-shortcut-prompt">{t('terminal:controls.pressKeyCombination')}</span>
                  )}
                </div>
              ) : (
                <div className="shortcuts-search">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="11" cy="11" r="8" />
                    <path d="M21 21l-4.35-4.35" />
                  </svg>
                  <input
                    ref={searchInputRef}
                    type="text"
                    placeholder={t('terminal:controls.searchShortcuts')}
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
              )}
              <button
                className={`shortcuts-find-by-key-btn ${findByShortcut ? 'active' : ''}`}
                onClick={() => {
                  setFindByShortcut(!findByShortcut);
                  setCapturedKeys(null);
                  setSearchQuery('');
                }}
                title={findByShortcut ? t('terminal:controls.switchToTextSearch') : t('terminal:controls.findByPressingKeys')}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="2" y="4" width="20" height="16" rx="2" />
                  <path d="M6 8h.01M10 8h.01M14 8h.01M18 8h.01M6 12h.01M18 12h.01M8 16h8" />
                </svg>
              </button>
              <button className="shortcuts-reset-all-btn" onClick={handleResetAll}>
                {t('common:buttons.reset')}
              </button>
            </div>

            {/* Context filter tabs */}
            <div className="shortcuts-context-tabs">
              <button
                className={`shortcuts-context-tab ${expandedContext === 'all' ? 'active' : ''}`}
                onClick={() => setExpandedContext('all')}
              >
                {t('common:labels.all')}
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
                    {t(CONTEXT_LABEL_KEYS[context])}
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
                        <span className="shortcuts-context-label">{t(CONTEXT_LABEL_KEYS[context])}</span>
                        <span className="shortcuts-context-description">{t(CONTEXT_DESCRIPTION_KEYS[context])}</span>
                      </div>
                    )}
                    <div className="shortcuts-grid">
                      {shortcuts.map((shortcut) => (
                        <div key={shortcut.id} className="shortcut-item">
                          <div className="shortcut-item-info">
                            <span className="shortcut-item-name">
                              {t(`terminal:controls.shortcuts.${shortcut.id}.name`, { defaultValue: shortcut.name })}
                            </span>
                            <span className="shortcut-item-description">
                              {t(`terminal:controls.shortcuts.${shortcut.id}.description`, { defaultValue: shortcut.description })}
                            </span>
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
                  {findByShortcut ? (
                    capturedKeys ? (
                      <p>{t('terminal:controls.noShortcutBoundTo', { keys: formatShortcut({ key: capturedKeys.key, modifiers: capturedKeys.modifiers } as ShortcutConfig) })}</p>
                    ) : (
                      <p>{t('terminal:controls.pressKeyCombinationToFind')}</p>
                    )
                  ) : (
                    <p>{t('terminal:controls.noShortcutsFound', { query: searchQuery })}</p>
                  )}
                </div>
              )}
            </div>
          </>
        )}

        {/* Mouse Tab Content */}
        {activeTab === 'mouse' && (
          <>
            <div className="shortcuts-modal-toolbar">
              <span className="mouse-controls-subtitle">{t('terminal:controls.cameraAndInteraction')}</span>
              <button className="shortcuts-reset-all-btn" onClick={handleResetAll}>
                {t('common:buttons.reset')}
              </button>
            </div>

            <div className="shortcuts-modal-content mouse-controls-content">
              {/* Mouse bindings */}
              <div className="mouse-controls-bindings">
                {Object.entries(bindingsByGroup).map(([group, bindings]) => (
                  <div key={group} className="shortcuts-context-group">
                    <div className="shortcuts-context-header">
                      <span className="shortcuts-context-label">{t(MOUSE_GROUP_LABEL_KEYS[group])}</span>
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
                  <span className="shortcuts-context-label">{t('terminal:controls.sensitivity')}</span>
                  <span className="shortcuts-context-description">{t('terminal:controls.adjustCameraSpeed')}</span>
                </div>
                <SensitivitySettings sensitivity={mouseControls.sensitivity} />
              </div>
            </div>
          </>
        )}

        {/* Trackpad Tab Content */}
        {activeTab === 'trackpad' && (
          <>
            <div className="shortcuts-modal-toolbar">
              <span className="mouse-controls-subtitle">{t('terminal:controls.trackpadGestureSettings')}</span>
              <button className="shortcuts-reset-all-btn" onClick={handleResetAll}>
                {t('common:buttons.reset')}
              </button>
            </div>

            <div className="shortcuts-modal-content trackpad-controls-content">
              <TrackpadSettings config={trackpadConfig} />
            </div>
          </>
        )}

        {/* Footer */}
        <div className="shortcuts-modal-footer">
          <span className="shortcuts-modal-hint">
            {activeTab === 'keyboard'
              ? findByShortcut
                ? t('terminal:controls.hintFindByShortcut')
                : t('terminal:controls.hintKeyboard')
              : activeTab === 'mouse'
                ? t('terminal:controls.hintMouse')
                : t('terminal:controls.hintTrackpad')}
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
  const { t } = useTranslation(['terminal']);
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

  const bindingName = t(`terminal:controls.mouseBindings.${binding.id}.name`, { defaultValue: binding.name });
  const bindingDescription = t(`terminal:controls.mouseBindings.${binding.id}.description`, { defaultValue: binding.description });
  const resolveMouseButtonLabel = (button: MouseControlConfig['button']): string =>
    t(`terminal:controls.mouseButtons.${button}`, { defaultValue: button });

  const displayValue = pendingCapture
    ? formatMouseBinding({ ...binding, ...pendingCapture }, resolveMouseButtonLabel)
    : formatMouseBinding(binding, resolveMouseButtonLabel);

  return (
    <div className={`shortcut-item ${!binding.enabled ? 'disabled' : ''}`}>
      <div className="shortcut-item-info">
        <span className="shortcut-item-name">{bindingName}</span>
        <span className="shortcut-item-description">{bindingDescription}</span>
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
              <span style={{ color: '#6272a4', fontStyle: 'italic' }}>{t('terminal:controls.clickToCapture')}</span>
            )
          ) : (
            <span className="key-capture-value">{displayValue}</span>
          )}
        </button>
        {conflicts.length > 0 && (
          <span className="key-capture-conflict">
            {t('terminal:controls.conflicts')}: {conflicts.map((c) => t(`terminal:controls.mouseBindings.${c.id}.name`, { defaultValue: c.name })).join(', ')}
          </span>
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
  const { t } = useTranslation(['terminal']);
  const handleChange = useCallback((key: keyof CameraSensitivityConfig, value: number | boolean) => {
    store.updateCameraSensitivity({ [key]: value });
  }, []);

  return (
    <div className="sensitivity-inline-settings">
      {/* Speed sliders */}
      <div className="sensitivity-sliders">
        <div className="sensitivity-slider-row">
          <label>{t('terminal:controls.panSpeed')}</label>
          <input
            type="range"
            min="0.1"
            max="3"
            step="0.1"
            value={sensitivity.panSpeed}
            onChange={(e) => handleChange('panSpeed', parseFloat(e.target.value))}
          />
          <span className="sensitivity-slider-value">{sensitivity.panSpeed.toFixed(1)}x</span>
        </div>
        <div className="sensitivity-slider-row">
          <label>{t('terminal:controls.orbitSpeed')}</label>
          <input
            type="range"
            min="0.1"
            max="3"
            step="0.1"
            value={sensitivity.orbitSpeed}
            onChange={(e) => handleChange('orbitSpeed', parseFloat(e.target.value))}
          />
          <span className="sensitivity-slider-value">{sensitivity.orbitSpeed.toFixed(1)}x</span>
        </div>
        <div className="sensitivity-slider-row">
          <label>{t('terminal:controls.zoomSpeed')}</label>
          <input
            type="range"
            min="0.1"
            max="3"
            step="0.1"
            value={sensitivity.zoomSpeed}
            onChange={(e) => handleChange('zoomSpeed', parseFloat(e.target.value))}
          />
          <span className="sensitivity-slider-value">{sensitivity.zoomSpeed.toFixed(1)}x</span>
        </div>
        <div className="sensitivity-slider-row">
          <label>{t('terminal:controls.smoothing')}</label>
          <input
            type="range"
            min="0"
            max="1"
            step="0.1"
            value={sensitivity.smoothing}
            onChange={(e) => handleChange('smoothing', parseFloat(e.target.value))}
          />
          <span className="sensitivity-slider-value">{sensitivity.smoothing.toFixed(1)}</span>
        </div>
      </div>

      {/* Invert checkboxes */}
      <div className="sensitivity-checkboxes-inline">
        <label className="sensitivity-checkbox-inline">
          <input
            type="checkbox"
            checked={sensitivity.invertPanX}
            onChange={(e) => handleChange('invertPanX', e.target.checked)}
          />
          <span>{t('terminal:controls.invertPanX')}</span>
        </label>
        <label className="sensitivity-checkbox-inline">
          <input
            type="checkbox"
            checked={sensitivity.invertPanY}
            onChange={(e) => handleChange('invertPanY', e.target.checked)}
          />
          <span>{t('terminal:controls.invertPanY')}</span>
        </label>
        <label className="sensitivity-checkbox-inline">
          <input
            type="checkbox"
            checked={sensitivity.invertOrbitX}
            onChange={(e) => handleChange('invertOrbitX', e.target.checked)}
          />
          <span>{t('terminal:controls.invertOrbitX')}</span>
        </label>
        <label className="sensitivity-checkbox-inline">
          <input
            type="checkbox"
            checked={sensitivity.invertOrbitY}
            onChange={(e) => handleChange('invertOrbitY', e.target.checked)}
          />
          <span>{t('terminal:controls.invertOrbitY')}</span>
        </label>
      </div>
    </div>
  );
}

// ============================================================================
// Trackpad Settings Component
// ============================================================================

interface TrackpadSettingsProps {
  config: TrackpadConfig;
}

function TrackpadSettings({ config }: TrackpadSettingsProps) {
  const { t } = useTranslation(['terminal']);
  const handleToggle = useCallback((key: keyof TrackpadConfig, value: boolean) => {
    store.updateTrackpadConfig({ [key]: value });
  }, []);

  const handleSensitivity = useCallback((key: 'zoom' | 'pan' | 'orbit', value: number) => {
    store.updateTrackpadConfig({
      sensitivity: { [key]: value } as unknown as TrackpadConfig['sensitivity'],
    });
  }, []);

  return (
    <div className="trackpad-settings">
      {/* Master toggle */}
      <div className="shortcuts-context-group">
        <div className="shortcuts-context-header">
          <span className="shortcuts-context-label">{t('terminal:controls.trackpadGestures')}</span>
          <span className="shortcuts-context-description">{t('terminal:controls.enableTrackpadSupport')}</span>
        </div>
        <div className="trackpad-toggle-row">
          <label className="trackpad-toggle">
            <input
              type="checkbox"
              checked={config.enabled}
              onChange={(e) => handleToggle('enabled', e.target.checked)}
            />
            <span className="trackpad-toggle-label">{t('terminal:controls.enableTrackpadGestures')}</span>
          </label>
        </div>
      </div>

      {/* Gesture toggles */}
      <div className="shortcuts-context-group">
        <div className="shortcuts-context-header">
          <span className="shortcuts-context-label">{t('terminal:controls.gestureControls')}</span>
          <span className="shortcuts-context-description">{t('terminal:controls.enableDisableGestures')}</span>
        </div>
        <div className="trackpad-gestures-grid">
          <label className={`trackpad-gesture-item ${!config.enabled ? 'disabled' : ''}`}>
            <input
              type="checkbox"
              checked={config.pinchToZoom}
              onChange={(e) => handleToggle('pinchToZoom', e.target.checked)}
              disabled={!config.enabled}
            />
            <div className="trackpad-gesture-info">
              <span className="trackpad-gesture-name">{t('terminal:controls.pinchToZoom')}</span>
              <span className="trackpad-gesture-desc">{t('terminal:controls.pinchToZoomDesc')}</span>
            </div>
          </label>

          <label className={`trackpad-gesture-item ${!config.enabled ? 'disabled' : ''}`}>
            <input
              type="checkbox"
              checked={config.twoFingerPan}
              onChange={(e) => handleToggle('twoFingerPan', e.target.checked)}
              disabled={!config.enabled}
            />
            <div className="trackpad-gesture-info">
              <span className="trackpad-gesture-name">{t('terminal:controls.twoFingerPan')}</span>
              <span className="trackpad-gesture-desc">{t('terminal:controls.twoFingerPanDesc')}</span>
            </div>
          </label>

          <label className={`trackpad-gesture-item ${!config.enabled ? 'disabled' : ''}`}>
            <input
              type="checkbox"
              checked={config.shiftTwoFingerOrbit}
              onChange={(e) => handleToggle('shiftTwoFingerOrbit', e.target.checked)}
              disabled={!config.enabled}
            />
            <div className="trackpad-gesture-info">
              <span className="trackpad-gesture-name">{t('terminal:controls.shiftTwoFingerOrbit')}</span>
              <span className="trackpad-gesture-desc">{t('terminal:controls.shiftTwoFingerOrbitDesc')}</span>
            </div>
          </label>
        </div>
      </div>

      {/* Sensitivity sliders */}
      <div className="shortcuts-context-group">
        <div className="shortcuts-context-header">
          <span className="shortcuts-context-label">{t('terminal:controls.sensitivity')}</span>
          <span className="shortcuts-context-description">{t('terminal:controls.adjustGestureSensitivity')}</span>
        </div>
        <div className="trackpad-sensitivity-sliders">
          <div className={`trackpad-slider-row ${!config.enabled || !config.pinchToZoom ? 'disabled' : ''}`}>
            <label>{t('terminal:controls.zoom')}</label>
            <input
              type="range"
              min="0.1"
              max="3"
              step="0.1"
              value={config.sensitivity.zoom}
              onChange={(e) => handleSensitivity('zoom', parseFloat(e.target.value))}
              disabled={!config.enabled || !config.pinchToZoom}
            />
            <span className="trackpad-slider-value">{config.sensitivity.zoom.toFixed(1)}x</span>
          </div>

          <div className={`trackpad-slider-row ${!config.enabled || !config.twoFingerPan ? 'disabled' : ''}`}>
            <label>{t('terminal:controls.pan')}</label>
            <input
              type="range"
              min="0.1"
              max="3"
              step="0.1"
              value={config.sensitivity.pan}
              onChange={(e) => handleSensitivity('pan', parseFloat(e.target.value))}
              disabled={!config.enabled || !config.twoFingerPan}
            />
            <span className="trackpad-slider-value">{config.sensitivity.pan.toFixed(1)}x</span>
          </div>

          <div className={`trackpad-slider-row ${!config.enabled || !config.shiftTwoFingerOrbit ? 'disabled' : ''}`}>
            <label>{t('terminal:controls.orbit')}</label>
            <input
              type="range"
              min="0.1"
              max="3"
              step="0.1"
              value={config.sensitivity.orbit}
              onChange={(e) => handleSensitivity('orbit', parseFloat(e.target.value))}
              disabled={!config.enabled || !config.shiftTwoFingerOrbit}
            />
            <span className="trackpad-slider-value">{config.sensitivity.orbit.toFixed(1)}x</span>
          </div>
        </div>
      </div>
    </div>
  );
}
