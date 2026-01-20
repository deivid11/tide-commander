import React, { useState, useEffect, useRef, useMemo } from 'react';
import { store, useStore, useCustomAgentClassesArray } from '../store';
import { AGENT_CLASS_CONFIG, DEFAULT_NAMES, CHARACTER_MODELS } from '../scene/config';
import type { Agent, AgentClass, PermissionMode, BuiltInAgentClass, ClaudeModel } from '../../shared/types';
import { PERMISSION_MODES, AGENT_CLASSES, CLAUDE_MODELS } from '../../shared/types';
import { intToHex } from '../utils/formatting';
import { STORAGE_KEYS, getStorageString, setStorageString } from '../utils/storage';
import { ModelPreview } from './ModelPreview';

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
  const customClasses = useCustomAgentClassesArray();
  const [name, setName] = useState('');
  const [cwd, setCwd] = useState(() => getStorageString(STORAGE_KEYS.LAST_CWD));
  const [selectedClass, setSelectedClass] = useState<AgentClass>('boss');
  const [isSpawning, setIsSpawning] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [useChrome, setUseChrome] = useState(true);
  const [permissionMode, setPermissionMode] = useState<PermissionMode>('bypass');
  const [selectedModel, setSelectedModel] = useState<ClaudeModel>('haiku');
  const [selectedSubordinates, setSelectedSubordinates] = useState<Set<string>>(new Set());
  const nameInputRef = useRef<HTMLInputElement>(null);
  const hasInitializedRef = useRef(false);

  // Get custom class config if selected class is custom
  const selectedCustomClass = useMemo(() => {
    return customClasses.find(c => c.id === selectedClass);
  }, [customClasses, selectedClass]);

  // Get the visual model file for preview
  const previewModelFile = useMemo((): string | undefined => {
    if (selectedCustomClass?.model) {
      return selectedCustomClass.model;
    }
    return undefined;
  }, [selectedCustomClass]);

  // Agent class for ModelPreview (only used when no custom model file)
  const previewAgentClass = useMemo((): BuiltInAgentClass => {
    if (selectedCustomClass) {
      return 'scout';
    }
    // Default built-in classes
    if (selectedClass === 'boss') return 'architect'; // Boss uses architect model
    return selectedClass as BuiltInAgentClass;
  }, [selectedClass, selectedCustomClass]);

  // Get available subordinates (non-boss agents without a boss)
  const availableSubordinates = Array.from(agents.values()).filter(
    (agent) => !agent.isBoss && agent.class !== 'boss' && !agent.bossId
  );

  // Generate a new name when modal opens (only once per open)
  useEffect(() => {
    if (isOpen && !hasInitializedRef.current) {
      hasInitializedRef.current = true;
      const usedNames = new Set(Array.from(agents.values()).map((a) => a.name));
      setName(getRandomBossName(usedNames));
      setSelectedSubordinates(new Set());
      if (nameInputRef.current) {
        nameInputRef.current.focus();
        nameInputRef.current.select();
      }
    } else if (!isOpen) {
      // Reset the flag when modal closes so it reinitializes next time
      hasInitializedRef.current = false;
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

    setStorageString(STORAGE_KEYS.LAST_CWD, cwd);
    setIsSpawning(true);
    onSpawnStart();

    store.spawnBossAgent(
      name.trim(),
      selectedClass,
      cwd.trim(),
      undefined,
      Array.from(selectedSubordinates),
      useChrome,
      permissionMode,
      selectedModel
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
          {/* Model Preview */}
          <div className="spawn-preview-section">
            <ModelPreview agentClass={previewAgentClass} modelFile={previewModelFile} width={180} height={220} />
            <div className="spawn-preview-name">
              {selectedCustomClass
                ? `${selectedCustomClass.icon} ${selectedCustomClass.name}`
                : selectedClass === 'boss'
                  ? `${bossConfig.icon} Boss`
                  : CHARACTER_MODELS.find((c) => c.id === selectedClass)?.name || selectedClass}
            </div>
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
              <label className="form-label">Boss Class</label>
              <div className="class-selector compact">
                {/* Custom classes first */}
                {customClasses.length > 0 && (
                  <>
                    {customClasses.map((customClass) => (
                      <div
                        key={customClass.id}
                        className={`class-option ${selectedClass === customClass.id ? 'selected' : ''}`}
                        onClick={() => setSelectedClass(customClass.id)}
                      >
                        <div
                          className="class-icon"
                          style={{ background: `${customClass.color}20` }}
                        >
                          {customClass.icon}
                        </div>
                        <div className="class-name">{customClass.name}</div>
                      </div>
                    ))}
                    <div className="class-selector-divider">
                      <span>Built-in</span>
                    </div>
                  </>
                )}
                {/* Boss class option */}
                <div
                  className={`class-option ${selectedClass === 'boss' ? 'selected' : ''}`}
                  onClick={() => setSelectedClass('boss')}
                >
                  <div
                    className="class-icon"
                    style={{ background: `${bossConfig.color}20` }}
                  >
                    {bossConfig.icon}
                  </div>
                  <div className="class-name">Boss</div>
                </div>
                {/* Built-in classes */}
                {CHARACTER_MODELS.map((char) => {
                  const config = AGENT_CLASS_CONFIG[char.id];
                  if (!config) return null;
                  return (
                    <div
                      key={char.id}
                      className={`class-option ${selectedClass === char.id ? 'selected' : ''}`}
                      onClick={() => setSelectedClass(char.id)}
                    >
                      <div
                        className="class-icon"
                        style={{ background: `${intToHex(config.color)}20` }}
                      >
                        {config.icon}
                      </div>
                      <div className="class-name">{char.name}</div>
                    </div>
                  );
                })}
              </div>
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
                    const builtInConfig = AGENT_CLASSES[agent.class as keyof typeof AGENT_CLASSES];
                    const customConfig = customClasses.find(c => c.id === agent.class);
                    const classConfig = builtInConfig || customConfig || { icon: '🤖', color: '#888888' };
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
              <label className="form-label">Claude Model</label>
              <div className="model-selector">
                {(Object.keys(CLAUDE_MODELS) as ClaudeModel[]).map((model) => (
                  <div
                    key={model}
                    className={`model-option ${selectedModel === model ? 'selected' : ''}`}
                    onClick={() => setSelectedModel(model)}
                  >
                    <div className="model-icon">{CLAUDE_MODELS[model].icon}</div>
                    <div className="model-info">
                      <div className="model-label">{CLAUDE_MODELS[model].label}</div>
                      <div className="model-desc">{CLAUDE_MODELS[model].description}</div>
                    </div>
                  </div>
                ))}
              </div>
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
