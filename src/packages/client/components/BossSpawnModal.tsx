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
  /** Optional spawn position - if provided, agent spawns at this location */
  spawnPosition?: { x: number; z: number } | null;
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

export function BossSpawnModal({ isOpen, onClose, onSpawnStart, onSpawnEnd, spawnPosition }: BossSpawnModalProps) {
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

  // Get custom model URL if the class has an uploaded model
  const previewCustomModelUrl = useMemo((): string | undefined => {
    if (selectedCustomClass?.customModelPath) {
      return `/api/custom-models/${selectedCustomClass.id}`;
    }
    return undefined;
  }, [selectedCustomClass]);

  // Get model scale for custom classes
  const previewModelScale = selectedCustomClass?.modelScale;

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
    onSpawnStart();

    store.spawnBossAgent(
      name.trim(),
      selectedClass,
      cwd.trim(),
      spawnPosition || undefined,
      Array.from(selectedSubordinates),
      useChrome,
      permissionMode,
      selectedModel
    );

    // Close modal immediately after initiating spawn
    setName('');
    setSelectedSubordinates(new Set());
    onSpawnEnd();
    onClose();
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

        <div className="modal-body spawn-modal-body">
          {/* Top: Preview + Class Selection */}
          <div className="spawn-top-section">
            <div className="spawn-preview-compact">
              <ModelPreview
                agentClass={previewAgentClass}
                modelFile={previewModelFile}
                customModelUrl={previewCustomModelUrl}
                modelScale={previewModelScale}
                width={100}
                height={120}
              />
            </div>
            <div className="spawn-class-section">
              <div className="spawn-class-label">Boss Class</div>
              <div className="class-selector-inline">
                {customClasses.map((customClass) => (
                  <button
                    key={customClass.id}
                    className={`class-chip ${selectedClass === customClass.id ? 'selected' : ''}`}
                    onClick={() => setSelectedClass(customClass.id)}
                    title={customClass.description}
                  >
                    <span className="class-chip-icon">{customClass.icon}</span>
                    <span className="class-chip-name">{customClass.name}</span>
                  </button>
                ))}
                <button
                  className={`class-chip ${selectedClass === 'boss' ? 'selected' : ''}`}
                  onClick={() => setSelectedClass('boss')}
                  title={bossConfig.description}
                >
                  <span className="class-chip-icon">{bossConfig.icon}</span>
                  <span className="class-chip-name">Boss</span>
                </button>
                {CHARACTER_MODELS.map((char) => {
                  const config = AGENT_CLASS_CONFIG[char.id];
                  if (!config) return null;
                  return (
                    <button
                      key={char.id}
                      className={`class-chip ${selectedClass === char.id ? 'selected' : ''}`}
                      onClick={() => setSelectedClass(char.id)}
                      title={config.description}
                    >
                      <span className="class-chip-icon">{config.icon}</span>
                      <span className="class-chip-name">{char.name}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Form Fields */}
          <div className="spawn-form-section">
            {/* Row 1: Name + CWD */}
            <div className="spawn-form-row">
              <div className="spawn-field">
                <label className="spawn-label">Name</label>
                <input
                  ref={nameInputRef}
                  type="text"
                  className="spawn-input"
                  placeholder="Boss name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
              <div className="spawn-field spawn-field-wide">
                <label className="spawn-label">Working Directory</label>
                <input
                  type="text"
                  className={`spawn-input ${hasError ? 'error' : ''}`}
                  placeholder="/path/to/project"
                  value={cwd}
                  onChange={(e) => {
                    setCwd(e.target.value);
                    setHasError(false);
                  }}
                />
              </div>
            </div>

            {/* Row 2: Model + Permission */}
            <div className="spawn-form-row">
              <div className="spawn-field">
                <label className="spawn-label">Model</label>
                <div className="spawn-select-row">
                  {(Object.keys(CLAUDE_MODELS) as ClaudeModel[]).map((model) => (
                    <button
                      key={model}
                      className={`spawn-select-btn ${selectedModel === model ? 'selected' : ''}`}
                      onClick={() => setSelectedModel(model)}
                      title={CLAUDE_MODELS[model].description}
                    >
                      <span>{CLAUDE_MODELS[model].icon}</span>
                      <span>{CLAUDE_MODELS[model].label}</span>
                    </button>
                  ))}
                </div>
              </div>
              <div className="spawn-field">
                <label className="spawn-label">Permissions</label>
                <div className="spawn-select-row">
                  {(Object.keys(PERMISSION_MODES) as PermissionMode[]).map((mode) => (
                    <button
                      key={mode}
                      className={`spawn-select-btn ${permissionMode === mode ? 'selected' : ''}`}
                      onClick={() => setPermissionMode(mode)}
                      title={PERMISSION_MODES[mode].description}
                    >
                      <span>{mode === 'bypass' ? '⚡' : '🔐'}</span>
                      <span>{PERMISSION_MODES[mode].label}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Row 3: Chrome toggle */}
            <div className="spawn-form-row spawn-options-row">
              <label className="spawn-checkbox">
                <input
                  type="checkbox"
                  checked={useChrome}
                  onChange={(e) => setUseChrome(e.target.checked)}
                />
                <span>🌐 Chrome Browser</span>
              </label>
            </div>

            {/* Subordinates section */}
            <div className="spawn-subordinates-section">
              <label className="spawn-label">
                Initial Subordinates <span className="spawn-label-hint">(optional)</span>
              </label>
              <div className="subordinates-selector-compact">
                {availableSubordinates.length === 0 ? (
                  <div className="subordinates-empty">No available agents</div>
                ) : (
                  availableSubordinates.map((agent) => {
                    const isSelected = selectedSubordinates.has(agent.id);
                    const builtInConfig = AGENT_CLASSES[agent.class as keyof typeof AGENT_CLASSES];
                    const customConfig = customClasses.find(c => c.id === agent.class);
                    const classConfig = builtInConfig || customConfig || { icon: '🤖', color: '#888888' };
                    return (
                      <button
                        key={agent.id}
                        className={`subordinate-chip ${isSelected ? 'selected' : ''}`}
                        onClick={() => toggleSubordinate(agent.id)}
                      >
                        {isSelected && <span className="subordinate-check">✓</span>}
                        <span className="subordinate-chip-icon" style={{ color: classConfig.color }}>
                          {classConfig.icon}
                        </span>
                        <span className="subordinate-chip-name">{agent.name}</span>
                      </button>
                    );
                  })
                )}
              </div>
              {selectedSubordinates.size > 0 && (
                <div className="subordinates-count">
                  {selectedSubordinates.size} selected
                </div>
              )}
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
