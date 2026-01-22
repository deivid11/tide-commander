import React, { useState, useEffect, useCallback } from 'react';
import { store, useMouseControls } from '../store';
import type {
  MouseControlConfig,
  MouseButton,
  MouseModifiers,
  CameraSensitivityConfig,
} from '../store/mouseControls';
import {
  formatMouseBinding,
  findConflictingMouseBindings,
  BUTTON_NAMES,
  ACTION_NAMES,
} from '../store/mouseControls';

interface MouseControlsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

// Group bindings by action type
const ACTION_GROUPS = {
  camera: ['camera-pan', 'camera-orbit', 'camera-rotate', 'camera-zoom', 'camera-tilt'],
  interaction: ['primary-action', 'selection-box', 'context-menu', 'move-command'],
};

const GROUP_LABELS: Record<string, string> = {
  camera: 'Camera Controls',
  interaction: 'Interaction',
};

export function MouseControlsModal({ isOpen, onClose }: MouseControlsModalProps) {
  const mouseControls = useMouseControls();
  const [activeTab, setActiveTab] = useState<'bindings' | 'sensitivity'>('bindings');

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

  if (!isOpen) return null;

  const handleResetAll = () => {
    if (confirm('Reset all mouse controls to defaults?')) {
      store.resetMouseControls();
    }
  };

  // Group bindings by action category
  const bindingsByGroup = mouseControls.bindings.reduce(
    (acc, binding) => {
      if (ACTION_GROUPS.camera.includes(binding.action)) {
        acc.camera.push(binding);
      } else if (ACTION_GROUPS.interaction.includes(binding.action)) {
        acc.interaction.push(binding);
      }
      return acc;
    },
    { camera: [] as MouseControlConfig[], interaction: [] as MouseControlConfig[] }
  );

  return (
    <div className="mouse-controls-modal-overlay" onClick={onClose}>
      <div className="mouse-controls-modal" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="mouse-controls-modal-header">
          <div className="mouse-controls-modal-title">
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <rect x="6" y="3" width="12" height="18" rx="6" />
              <line x1="12" y1="7" x2="12" y2="11" />
            </svg>
            <span>Mouse Controls</span>
          </div>
          <button className="mouse-controls-modal-close" onClick={onClose}>
            &times;
          </button>
        </div>

        {/* Tabs */}
        <div className="mouse-controls-tabs">
          <button
            className={`mouse-controls-tab ${activeTab === 'bindings' ? 'active' : ''}`}
            onClick={() => setActiveTab('bindings')}
          >
            Bindings
          </button>
          <button
            className={`mouse-controls-tab ${activeTab === 'sensitivity' ? 'active' : ''}`}
            onClick={() => setActiveTab('sensitivity')}
          >
            Sensitivity
          </button>
        </div>

        {/* Content */}
        <div className="mouse-controls-modal-content">
          {activeTab === 'bindings' && (
            <div className="mouse-controls-bindings">
              {Object.entries(bindingsByGroup).map(([group, bindings]) => (
                <div key={group} className="mouse-controls-group">
                  <div className="mouse-controls-group-header">
                    {GROUP_LABELS[group]}
                  </div>
                  <div className="mouse-controls-grid">
                    {bindings.map((binding) => (
                      <MouseBindingItem key={binding.id} binding={binding} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {activeTab === 'sensitivity' && (
            <SensitivitySettings sensitivity={mouseControls.sensitivity} />
          )}
        </div>

        {/* Footer */}
        <div className="mouse-controls-modal-footer">
          <button className="mouse-controls-reset-btn" onClick={handleResetAll}>
            Reset All
          </button>
          <span className="mouse-controls-hint">
            {activeTab === 'bindings'
              ? 'Click binding to change. Hold modifiers (Alt/Shift/Ctrl) while clicking.'
              : 'Adjust camera sensitivity and invert axes as needed.'}
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
    button: MouseButton;
    modifiers: MouseModifiers;
  } | null>(null);

  // Capture mouse clicks when in capture mode
  useEffect(() => {
    if (!isCapturing) return;

    const handleMouseDown = (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();

      const buttonMap: Record<number, MouseButton> = {
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

    const handleClickOutside = (e: MouseEvent) => {
      // If we have a pending capture, apply it
      if (pendingCapture) {
        // Check for conflicts
        const conflicts = findConflictingMouseBindings(
          mouseControls.bindings,
          pendingCapture,
          binding.id
        );

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

    // Small delay to prevent immediate capture from the click that started capture mode
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

  // Check for conflicts with pending capture
  const conflicts = pendingCapture
    ? findConflictingMouseBindings(mouseControls.bindings, pendingCapture, binding.id)
    : [];

  const displayValue = pendingCapture
    ? formatMouseBinding({ ...binding, ...pendingCapture })
    : formatMouseBinding(binding);

  return (
    <div className={`mouse-binding-item ${!binding.enabled ? 'disabled' : ''}`}>
      <div className="mouse-binding-info">
        <span className="mouse-binding-name">{binding.name}</span>
        <span className="mouse-binding-description">{binding.description}</span>
      </div>
      <div className="mouse-binding-controls">
        <button
          className={`mouse-binding-capture ${isCapturing ? 'capturing' : ''} ${
            conflicts.length > 0 ? 'conflict' : ''
          }`}
          onClick={() => setIsCapturing(true)}
        >
          {isCapturing ? (
            pendingCapture ? (
              <span className="mouse-binding-pending">{displayValue}</span>
            ) : (
              <span className="mouse-binding-waiting">Click a button...</span>
            )
          ) : (
            <span className="mouse-binding-value">{displayValue}</span>
          )}
        </button>
        {conflicts.length > 0 && (
          <span className="mouse-binding-conflict-warning">
            Conflicts with: {conflicts.map((c) => c.name).join(', ')}
          </span>
        )}
        <label className="mouse-binding-enabled">
          <input
            type="checkbox"
            checked={binding.enabled}
            onChange={(e) =>
              store.updateMouseBinding(binding.id, { enabled: e.target.checked })
            }
          />
          <span className="mouse-binding-enabled-label">Enabled</span>
        </label>
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
  const handleChange = useCallback(
    (key: keyof CameraSensitivityConfig, value: number | boolean) => {
      store.updateCameraSensitivity({ [key]: value });
    },
    []
  );

  return (
    <div className="sensitivity-settings">
      <div className="sensitivity-section">
        <h4 className="sensitivity-section-title">Speed Settings</h4>

        <div className="sensitivity-row">
          <label>Pan Speed</label>
          <input
            type="range"
            min="0.1"
            max="3.0"
            step="0.1"
            value={sensitivity.panSpeed}
            onChange={(e) => handleChange('panSpeed', parseFloat(e.target.value))}
          />
          <span className="sensitivity-value">{sensitivity.panSpeed.toFixed(1)}x</span>
        </div>

        <div className="sensitivity-row">
          <label>Orbit Speed</label>
          <input
            type="range"
            min="0.1"
            max="3.0"
            step="0.1"
            value={sensitivity.orbitSpeed}
            onChange={(e) => handleChange('orbitSpeed', parseFloat(e.target.value))}
          />
          <span className="sensitivity-value">{sensitivity.orbitSpeed.toFixed(1)}x</span>
        </div>

        <div className="sensitivity-row">
          <label>Zoom Speed</label>
          <input
            type="range"
            min="0.1"
            max="3.0"
            step="0.1"
            value={sensitivity.zoomSpeed}
            onChange={(e) => handleChange('zoomSpeed', parseFloat(e.target.value))}
          />
          <span className="sensitivity-value">{sensitivity.zoomSpeed.toFixed(1)}x</span>
        </div>

        <div className="sensitivity-row">
          <label>Smoothing</label>
          <input
            type="range"
            min="0"
            max="1"
            step="0.1"
            value={sensitivity.smoothing}
            onChange={(e) => handleChange('smoothing', parseFloat(e.target.value))}
          />
          <span className="sensitivity-value">
            {sensitivity.smoothing === 0 ? 'Off' : sensitivity.smoothing.toFixed(1)}
          </span>
        </div>
      </div>

      <div className="sensitivity-section">
        <h4 className="sensitivity-section-title">Invert Axes</h4>

        <div className="sensitivity-checkboxes">
          <label className="sensitivity-checkbox">
            <input
              type="checkbox"
              checked={sensitivity.invertPanX}
              onChange={(e) => handleChange('invertPanX', e.target.checked)}
            />
            <span>Invert Pan X</span>
          </label>

          <label className="sensitivity-checkbox">
            <input
              type="checkbox"
              checked={sensitivity.invertPanY}
              onChange={(e) => handleChange('invertPanY', e.target.checked)}
            />
            <span>Invert Pan Y</span>
          </label>

          <label className="sensitivity-checkbox">
            <input
              type="checkbox"
              checked={sensitivity.invertOrbitX}
              onChange={(e) => handleChange('invertOrbitX', e.target.checked)}
            />
            <span>Invert Orbit X</span>
          </label>

          <label className="sensitivity-checkbox">
            <input
              type="checkbox"
              checked={sensitivity.invertOrbitY}
              onChange={(e) => handleChange('invertOrbitY', e.target.checked)}
            />
            <span>Invert Orbit Y</span>
          </label>
        </div>
      </div>
    </div>
  );
}
