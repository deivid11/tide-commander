import React, { useState, useEffect, useRef } from 'react';
import { store, useStore } from '../store';
import { AGENT_CLASS_CONFIG, DEFAULT_NAMES } from '../scene/config';
import type { Agent, PermissionMode } from '../../shared/types';
import { PERMISSION_MODES, AGENT_CLASSES } from '../../shared/types';

interface BossSpawnModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSpawnStart: () => void;
  onSpawnEnd: () => void;
}

/**
 * Get a random unused LOTR name with "Boss" prefix.
 */
function getRandomBossName(usedNames: Set<string>): string {
  const availableNames = DEFAULT_NAMES.filter((n) => !usedNames.has(`Boss ${n}`));
  if (availableNames.length === 0) {
    const baseName = DEFAULT_NAMES[Math.floor(Math.random() * DEFAULT_NAMES.length)];
    return `Boss ${baseName}-${Date.now() % 1000}`;
  }
  return `Boss ${availableNames[Math.floor(Math.random() * availableNames.length)]}`;
}

export function BossSpawnModal({ isOpen, onClose, onSpawnStart, onSpawnEnd }: BossSpawnModalProps) {
  const { agents } = useStore();
  const [name, setName] = useState('');
  const [cwd, setCwd] = useState(() => localStorage.getItem('tide-last-cwd') || '');
  const [isSpawning, setIsSpawning] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [useChrome, setUseChrome] = useState(true);
  const [permissionMode, setPermissionMode] = useState<PermissionMode>('bypass');
  const [selectedSubordinates, setSelectedSubordinates] = useState<Set<string>>(new Set());
  const nameInputRef = useRef<HTMLInputElement>(null);

  // Get available subordinates (non-boss agents without a boss)
  const availableSubordinates = Array.from(agents.values()).filter(
    (agent) => agent.class !== 'boss' && !agent.bossId
  );

  // Generate a new name when modal opens
  useEffect(() => {
    if (isOpen) {
      const usedNames = new Set(Array.from(agents.values()).map((a) => a.name));
      setName(getRandomBossName(usedNames));
      setSelectedSubordinates(new Set());
      if (nameInputRef.current) {
        nameInputRef.current.focus();
        nameInputRef.current.select();
      }
    }
  }, [isOpen, agents]);

  const handleSpawn = () => {
    setHasError(false);

    if (!cwd.trim()) {
      setHasError(true);
      return;
    }

    if (!name.trim()) {
      const usedNames = new Set(Array.from(agents.values()).map((a) => a.name));
      setName(getRandomBossName(usedNames));
      return;
    }

    localStorage.setItem('tide-last-cwd', cwd);
    setIsSpawning(true);
    onSpawnStart();

    store.spawnBossAgent(
      name.trim(),
      cwd.trim(),
      undefined,
      Array.from(selectedSubordinates),
      useChrome,
      permissionMode
    );
  };

  const handleSuccess = () => {
    setIsSpawning(false);
    setName('');
    setSelectedSubordinates(new Set());
    onSpawnEnd();
    onClose();
  };

  const handleError = () => {
    setIsSpawning(false);
    setHasError(true);
    onSpawnEnd();
  };

  // Expose handlers for websocket callbacks
  useEffect(() => {
    (window as any).__bossSpawnModalSuccess = handleSuccess;
    (window as any).__bossSpawnModalError = handleError;
    return () => {
      delete (window as any).__bossSpawnModalSuccess;
      delete (window as any).__bossSpawnModalError;
    };
  }, [name]);

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose();
    }
  };

  const toggleSubordinate = (agentId: string) => {
    const newSelected = new Set(selectedSubordinates);
    if (newSelected.has(agentId)) {
      newSelected.delete(agentId);
    } else {
      newSelected.add(agentId);
    }
    setSelectedSubordinates(newSelected);
  };

  if (!isOpen) return null;

  const bossConfig = AGENT_CLASSES.boss;

  return (
    <div
      className={`modal-overlay ${isOpen ? 'visible' : ''}`}
      onClick={handleBackdropClick}
      onKeyDown={handleKeyDown}
    >
      <div className="modal boss-spawn-modal">
        <div className="modal-header">
          <span className="boss-header-icon">{bossConfig.icon}</span>
          Deploy Boss Agent
        </div>

        <div className="modal-body boss-spawn-modal-body">
          {/* Boss Icon Display */}
          <div className="boss-preview-section">
            <div className="boss-preview-icon" style={{ color: bossConfig.color }}>
              {bossConfig.icon}
            </div>
            <div className="boss-preview-desc">{bossConfig.description}</div>
          </div>

          {/* Form */}
          <div className="boss-form-section">
            <div className="form-group">
              <label className="form-label">Boss Name</label>
              <input
                ref={nameInputRef}
                type="text"
                className="form-input"
                placeholder="Enter boss name"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>

            <div className="form-group">
              <label className="form-label">Working Directory</label>
              <input
                type="text"
                className={`form-input ${hasError ? 'error' : ''}`}
                placeholder="/path/to/project"
                value={cwd}
                onChange={(e) => {
                  setCwd(e.target.value);
                  setHasError(false);
                }}
              />
            </div>

            <div className="form-group">
              <label className="form-label">
                Initial Subordinates
                <span className="form-label-hint">(optional, can add later)</span>
              </label>
              <div className="subordinates-selector">
                {availableSubordinates.length === 0 ? (
                  <div className="subordinates-empty">
                    No available agents to assign. Deploy regular agents first.
                  </div>
                ) : (
                  availableSubordinates.map((agent) => {
                    const isSelected = selectedSubordinates.has(agent.id);
                    const classConfig = AGENT_CLASSES[agent.class as keyof typeof AGENT_CLASSES];
                    return (
                      <div
                        key={agent.id}
                        className={`subordinate-item ${isSelected ? 'selected' : ''}`}
                        onClick={() => toggleSubordinate(agent.id)}
                      >
                        <div className="subordinate-checkbox">
                          {isSelected ? '✓' : ''}
                        </div>
                        <div
                          className="subordinate-icon"
                          style={{ color: classConfig.color }}
                        >
                          {classConfig.icon}
                        </div>
                        <div className="subordinate-info">
                          <div className="subordinate-name">{agent.name}</div>
                          <div className="subordinate-class">{agent.class}</div>
                        </div>
                        <div className={`subordinate-status status-${agent.status}`}>
                          {agent.status}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
              {selectedSubordinates.size > 0 && (
                <div className="subordinates-count">
                  {selectedSubordinates.size} agent{selectedSubordinates.size !== 1 ? 's' : ''} selected
                </div>
              )}
            </div>

            <div className="form-group">
              <label className="toggle-switch">
                <input
                  type="checkbox"
                  className="toggle-input"
                  checked={useChrome}
                  onChange={(e) => setUseChrome(e.target.checked)}
                />
                <div className="toggle-track">
                  <div className="toggle-thumb" />
                </div>
                <span className="toggle-label">
                  <span className="toggle-icon">🌐</span>
                  Use Chrome browser
                </span>
              </label>
            </div>

            <div className="form-group">
              <label className="form-label">Permission Mode</label>
              <div className="permission-mode-selector">
                {(Object.keys(PERMISSION_MODES) as PermissionMode[]).map((mode) => (
                  <div
                    key={mode}
                    className={`permission-mode-option ${permissionMode === mode ? 'selected' : ''}`}
                    onClick={() => setPermissionMode(mode)}
                  >
                    <div className="permission-mode-icon">
                      {mode === 'bypass' ? '⚡' : '🔐'}
                    </div>
                    <div className="permission-mode-info">
                      <div className="permission-mode-label">{PERMISSION_MODES[mode].label}</div>
                      <div className="permission-mode-desc">{PERMISSION_MODES[mode].description}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-boss"
            onClick={handleSpawn}
            disabled={isSpawning}
          >
            {isSpawning ? 'Deploying...' : 'Deploy Boss'}
          </button>
        </div>
      </div>
    </div>
  );
}
