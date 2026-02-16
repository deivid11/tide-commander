import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { store, useStore, useCustomAgentClassesArray, useSkillsArray } from '../store';
import { AGENT_CLASS_CONFIG, DEFAULT_NAMES, CHARACTER_MODELS } from '../scene/config';
import type { AgentClass, PermissionMode, BuiltInAgentClass, ClaudeModel, CodexModel, AgentProvider, CodexConfig } from '../../shared/types';
import { PERMISSION_MODES, AGENT_CLASSES, CLAUDE_MODELS, CODEX_MODELS } from '../../shared/types';
import { STORAGE_KEYS, getStorageString, setStorageString, apiUrl } from '../utils/storage';
import { ModelPreview } from './ModelPreview';
import { FolderInput } from './shared/FolderInput';

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
  const { t } = useTranslation(['terminal', 'common']);
  const { agents } = useStore();
  const customClasses = useCustomAgentClassesArray();
  const skills = useSkillsArray();
  const [name, setName] = useState('');
  const [cwd, setCwd] = useState(() => getStorageString(STORAGE_KEYS.LAST_CWD));
  const [selectedClass, setSelectedClass] = useState<AgentClass>('boss');
  const [isSpawning, setIsSpawning] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [useChrome, setUseChrome] = useState(true);
  const [permissionMode, setPermissionMode] = useState<PermissionMode>('bypass');
  const [selectedProvider, setSelectedProvider] = useState<AgentProvider>('claude');
  const [codexConfig, setCodexConfig] = useState<CodexConfig>({
    fullAuto: true,
    sandbox: 'workspace-write',
    approvalMode: 'on-request',
    search: false,
  });
  const [selectedModel, setSelectedModel] = useState<ClaudeModel>('haiku');
  const [selectedCodexModel, setSelectedCodexModel] = useState<CodexModel>('gpt-5.3-codex');
  const [selectedSubordinates, setSelectedSubordinates] = useState<Set<string>>(new Set());
  const [selectedSkillIds, setSelectedSkillIds] = useState<Set<string>>(new Set());
  const [classSearch, setClassSearch] = useState('');
  const [skillSearch, setSkillSearch] = useState('');
  const [customInstructions, setCustomInstructions] = useState('');
  const nameInputRef = useRef<HTMLInputElement>(null);
  const hasInitializedRef = useRef(false);

  // Get available skills (enabled ones)
  const availableSkills = useMemo(() => skills.filter(s => s.enabled), [skills]);

  // Filter skills by search query
  const filteredSkills = useMemo(() => {
    if (!skillSearch.trim()) return availableSkills;
    const query = skillSearch.toLowerCase();
    return availableSkills.filter(s =>
      s.name.toLowerCase().includes(query) ||
      s.description.toLowerCase().includes(query) ||
      s.slug.toLowerCase().includes(query)
    );
  }, [availableSkills, skillSearch]);

  // Get default skills for selected custom class
  const classDefaultSkills = useMemo(() => {
    const customClass = customClasses.find(c => c.id === selectedClass);
    if (!customClass?.defaultSkillIds?.length) return [];
    return skills.filter(s => customClass.defaultSkillIds.includes(s.id));
  }, [customClasses, selectedClass, skills]);

  // Toggle skill selection
  const toggleSkill = useCallback((skillId: string) => {
    setSelectedSkillIds(prev => {
      const next = new Set(prev);
      if (next.has(skillId)) {
        next.delete(skillId);
      } else {
        next.add(skillId);
      }
      return next;
    });
  }, []);

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
      return apiUrl(`/api/custom-models/${selectedCustomClass.id}`);
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

  // Filter classes by search query
  const filteredCustomClasses = useMemo(() => {
    if (!classSearch.trim()) return customClasses;
    const query = classSearch.toLowerCase();
    return customClasses.filter(c =>
      c.name.toLowerCase().includes(query) ||
      c.description.toLowerCase().includes(query) ||
      c.id.toLowerCase().includes(query)
    );
  }, [customClasses, classSearch]);

  // Filter built-in classes by search query
  const filteredBuiltInClasses = useMemo(() => {
    if (!classSearch.trim()) return CHARACTER_MODELS;
    const query = classSearch.toLowerCase();
    return CHARACTER_MODELS.filter(char => {
      const config = AGENT_CLASS_CONFIG[char.id];
      if (!config) return false;
      return (
        char.name.toLowerCase().includes(query) ||
        char.id.toLowerCase().includes(query) ||
        config.description.toLowerCase().includes(query)
      );
    });
  }, [classSearch]);

  // Check if "boss" class matches the search
  const showBossClass = useMemo(() => {
    if (!classSearch.trim()) return true;
    const query = classSearch.toLowerCase();
    const bossConfig = AGENT_CLASSES.boss;
    return (
      'boss'.includes(query) ||
      bossConfig.description.toLowerCase().includes(query)
    );
  }, [classSearch]);

  // Generate a new name when modal opens (only once per open)
  useEffect(() => {
    if (isOpen && !hasInitializedRef.current) {
      hasInitializedRef.current = true;
      const usedNames = new Set(Array.from(agents.values()).map((a) => a.name));
      // If a custom class is selected, prefix with class name instead of "Boss"
      const customClass = customClasses.find(c => c.id === selectedClass);
      if (customClass) {
        const availableNames = DEFAULT_NAMES.filter((n) => !usedNames.has(`${customClass.name} ${n}`));
        if (availableNames.length === 0) {
          const baseName = DEFAULT_NAMES[Math.floor(Math.random() * DEFAULT_NAMES.length)];
          setName(`${customClass.name} ${baseName}-${Date.now() % 1000}`);
        } else {
          setName(`${customClass.name} ${availableNames[Math.floor(Math.random() * availableNames.length)]}`);
        }
      } else {
        setName(getRandomBossName(usedNames));
      }
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

  // Update name prefix when custom class changes
  useEffect(() => {
    if (!isOpen) return;
    const customClass = customClasses.find(c => c.id === selectedClass);

    if (customClass) {
      // Check if current name has "Boss " prefix or another custom class prefix
      if (name.startsWith('Boss ')) {
        const baseName = name.substring(5); // Remove "Boss "
        setName(`${customClass.name} ${baseName}`);
      } else {
        const existingPrefix = customClasses.find(c => name.startsWith(c.name + ' '));
        if (existingPrefix) {
          const baseName = name.substring(existingPrefix.name.length + 1);
          setName(`${customClass.name} ${baseName}`);
        } else {
          setName(`${customClass.name} ${name}`);
        }
      }
    } else {
      // Switching to a built-in class (boss) - use "Boss " prefix
      const existingPrefix = customClasses.find(c => name.startsWith(c.name + ' '));
      if (existingPrefix) {
        const baseName = name.substring(existingPrefix.name.length + 1);
        setName(`Boss ${baseName}`);
      } else if (!name.startsWith('Boss ')) {
        setName(`Boss ${name}`);
      }
    }
  }, [selectedClass]);

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

    const trimmedInstructions = customInstructions.trim() || undefined;
    const initialSkillIds = Array.from(selectedSkillIds);
    store.spawnBossAgent(
      name.trim(),
      selectedClass,
      cwd.trim(),
      spawnPosition || undefined,
      Array.from(selectedSubordinates),
      selectedProvider === 'claude' ? useChrome : false,
      permissionMode,
      selectedProvider,
      selectedProvider === 'codex' ? codexConfig : undefined,
      selectedProvider === 'codex' ? selectedCodexModel : undefined,
      selectedProvider === 'claude' ? selectedModel : undefined,
      trimmedInstructions,
      initialSkillIds
    );

    // Close modal immediately after initiating spawn
    setName('');
    setSelectedSubordinates(new Set());
    setSelectedSkillIds(new Set());
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
          {t('terminal:spawn.deployBossTitle')}
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
              <div className="spawn-class-label">{t('terminal:spawn.bossClass')}</div>
              {(customClasses.length + CHARACTER_MODELS.length + 1) > 6 && (
                <input
                  type="text"
                  className="spawn-input class-search-input"
                  placeholder={t('terminal:spawn.filterClasses')}
                  value={classSearch}
                  onChange={(e) => setClassSearch(e.target.value)}
                />
              )}
              <div className="class-selector-inline">
                {filteredCustomClasses.map((customClass) => (
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
                {showBossClass && (
                  <button
                    className={`class-chip ${selectedClass === 'boss' ? 'selected' : ''}`}
                    onClick={() => setSelectedClass('boss')}
                    title={bossConfig.description}
                  >
                    <span className="class-chip-icon">{bossConfig.icon}</span>
                    <span className="class-chip-name">{t('terminal:spawn.bossClassName')}</span>
                  </button>
                )}
                {filteredBuiltInClasses.map((char) => {
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
                {classSearch && filteredCustomClasses.length === 0 && !showBossClass && filteredBuiltInClasses.length === 0 && (
                  <div className="class-search-empty">{t('terminal:spawn.noClassesMatch', { query: classSearch })}</div>
                )}
              </div>
            </div>
          </div>

          {/* Form Fields */}
          <div className="spawn-form-section">
            {/* Row 1: Name + CWD */}
            <div className="spawn-form-row">
              <div className="spawn-field">
                <label className="spawn-label">{t('common:labels.name')}</label>
                <input
                  ref={nameInputRef}
                  type="text"
                  className="spawn-input"
                  placeholder={t('terminal:spawn.bossNamePlaceholder')}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
              <div className="spawn-field spawn-field-wide">
                <label className="spawn-label">{t('terminal:spawn.workingDir')}</label>
                <FolderInput
                  value={cwd}
                  onChange={(value) => {
                    setCwd(value);
                    setHasError(false);
                  }}
                  placeholder={t('terminal:spawn.workingDirPlaceholder')}
                  className="spawn-input"
                  hasError={hasError}
                  directoriesOnly={true}
                />
              </div>
            </div>

            {/* Row 2: Runtime + Permission */}
            <div className="spawn-form-row">
              <div className="spawn-field">
                <label className="spawn-label">{t('common:labels.runtime')}</label>
                <div className="spawn-select-row">
                  <button
                    className={`spawn-select-btn ${selectedProvider === 'claude' ? 'selected' : ''}`}
                    onClick={() => setSelectedProvider('claude')}
                    title={t('terminal:spawn.useClaudeCli')}
                  >
                    <img src="/assets/claude.ico" alt="Claude" className="spawn-provider-icon" />
                    <span>Claude</span>
                  </button>
                  <button
                    className={`spawn-select-btn ${selectedProvider === 'codex' ? 'selected' : ''}`}
                    onClick={() => setSelectedProvider('codex')}
                    title={t('terminal:spawn.useCodexCli')}
                  >
                    <img src="/assets/codex.ico" alt="Codex" className="spawn-provider-icon" />
                    <span>Codex</span>
                  </button>
                </div>
              </div>
              <div className="spawn-field">
                <label className="spawn-label">{t('common:labels.permissions')}</label>
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

            {/* Row 3: Model + Chrome */}
            <div className="spawn-form-row">
              <div className="spawn-field">
                <label className="spawn-label">{t('common:labels.model')}</label>
                {selectedProvider === 'claude' ? (
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
                ) : selectedProvider === 'codex' ? (
                  <div className="spawn-select-row spawn-select-row--codex-models">
                    {(Object.keys(CODEX_MODELS) as CodexModel[]).map((model) => (
                      <button
                        key={model}
                        className={`spawn-select-btn ${selectedCodexModel === model ? 'selected' : ''}`}
                        onClick={() => setSelectedCodexModel(model)}
                        title={CODEX_MODELS[model].description}
                      >
                        <span>{CODEX_MODELS[model].icon}</span>
                        <span>{CODEX_MODELS[model].label}</span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="spawn-inline-hint">{t('terminal:spawn.codex.configuration')}</div>
                )}
              </div>
              <div className="spawn-field">
                <label className="spawn-label">{t('common:labels.browser')}</label>
                <div className="spawn-form-row spawn-options-row">
                  <label className="spawn-checkbox">
                    <input
                      type="checkbox"
                      checked={useChrome}
                      onChange={(e) => setUseChrome(e.target.checked)}
                      disabled={selectedProvider !== 'claude'}
                    />
                    <span>{t('terminal:spawn.chromeBrowser')}</span>
                  </label>
                </div>
              </div>
            </div>

            {selectedProvider === 'codex' && (
              <div className="spawn-form-row">
                <div className="spawn-field">
                  <label className="spawn-label">{t('terminal:spawn.codex.config')}</label>
                  <div className="spawn-options-row" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <label className="spawn-checkbox">
                      <input
                        type="checkbox"
                        checked={codexConfig.fullAuto !== false}
                        onChange={(e) => setCodexConfig((prev) => ({ ...prev, fullAuto: e.target.checked }))}
                      />
                      <span>{t('terminal:spawn.codex.useFullAuto')}</span>
                    </label>
                    <label className="spawn-checkbox">
                      <input
                        type="checkbox"
                        checked={!!codexConfig.search}
                        onChange={(e) => setCodexConfig((prev) => ({ ...prev, search: e.target.checked }))}
                      />
                      <span>{t('terminal:spawn.codex.enableSearch')}</span>
                    </label>
                    {codexConfig.fullAuto === false && (
                      <>
                        <select
                          className="spawn-input"
                          value={codexConfig.sandbox || 'workspace-write'}
                          onChange={(e) => setCodexConfig((prev) => ({ ...prev, sandbox: e.target.value as CodexConfig['sandbox'] }))}
                        >
                          <option value="read-only">{t('terminal:spawn.codex.sandboxReadOnly')}</option>
                          <option value="workspace-write">{t('terminal:spawn.codex.sandboxWorkspaceWrite')}</option>
                          <option value="danger-full-access">{t('terminal:spawn.codex.sandboxDangerFullAccess')}</option>
                        </select>
                        <select
                          className="spawn-input"
                          value={codexConfig.approvalMode || 'on-request'}
                          onChange={(e) => setCodexConfig((prev) => ({ ...prev, approvalMode: e.target.value as CodexConfig['approvalMode'] }))}
                        >
                          <option value="untrusted">{t('terminal:spawn.codex.approvalsUntrusted')}</option>
                          <option value="on-failure">{t('terminal:spawn.codex.approvalsOnFailure')}</option>
                          <option value="on-request">{t('terminal:spawn.codex.approvalsOnRequest')}</option>
                          <option value="never">{t('terminal:spawn.codex.approvalsNever')}</option>
                        </select>
                      </>
                    )}
                    <input
                      type="text"
                      className="spawn-input"
                      placeholder={t('terminal:spawn.codex.profileOptional')}
                      value={codexConfig.profile || ''}
                      onChange={(e) => setCodexConfig((prev) => ({ ...prev, profile: e.target.value || undefined }))}
                    />
                  </div>
                </div>
              </div>
            )}

            {/* Skills section */}
            {availableSkills.length > 0 && (
              <div className="spawn-skills-section">
                <label className="spawn-label">{t('terminal:spawn.skills')} <span className="spawn-label-hint">({t('common:labels.optional')})</span></label>
                {availableSkills.length > 6 && (
                  <input
                    type="text"
                    className="spawn-input skill-search-input"
                    placeholder={t('terminal:spawn.filterSkills')}
                    value={skillSearch}
                    onChange={(e) => setSkillSearch(e.target.value)}
                  />
                )}
                <div className="spawn-skills-inline">
                  {filteredSkills.map((skill) => {
                    const isSelected = selectedSkillIds.has(skill.id);
                    const isClassDefault = classDefaultSkills.some(s => s.id === skill.id);
                    if (isClassDefault) return null;
                    return (
                      <button
                        key={skill.id}
                        className={`spawn-skill-chip ${isSelected ? 'selected' : ''}`}
                        onClick={() => toggleSkill(skill.id)}
                        title={skill.description}
                      >
                        {isSelected && <span className="spawn-skill-check">✓</span>}
                        <span>{skill.name}</span>
                        {skill.builtin && <span className="spawn-skill-builtin">TC</span>}
                      </button>
                    );
                  })}
                  {skillSearch && filteredSkills.length === 0 && (
                    <div className="skill-search-empty">{t('terminal:spawn.noSkillsMatch', { query: skillSearch })}</div>
                  )}
                </div>
              </div>
            )}

            {/* Custom Instructions */}
            <div className="spawn-custom-instructions-section">
              <label className="spawn-label">
                {t('terminal:spawn.customInstructions')} <span className="spawn-label-hint">({t('common:labels.optional')})</span>
              </label>
              <textarea
                className="spawn-input spawn-textarea"
                placeholder={t('terminal:spawn.customInstructionsBossPlaceholder')}
                value={customInstructions}
                onChange={(e) => setCustomInstructions(e.target.value)}
                rows={3}
              />
            </div>

            {/* Subordinates section */}
            <div className="spawn-subordinates-section">
              <label className="spawn-label">
                {t('terminal:spawn.initialSubordinates')} <span className="spawn-label-hint">({t('common:labels.optional')})</span>
              </label>
              <div className="subordinates-selector-compact">
                {availableSubordinates.length === 0 ? (
                  <div className="subordinates-empty">{t('terminal:spawn.noAvailableAgents')}</div>
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
                  {selectedSubordinates.size} {t('common:labels.selected').toLowerCase()}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose}>
            {t('common:buttons.cancel')}
          </button>
          <button
            className="btn btn-boss"
            onClick={handleSpawn}
            disabled={isSpawning}
          >
            {isSpawning ? t('common:buttons.deploying') : t('common:buttons2.deployBoss')}
          </button>
        </div>
      </div>
    </div>
  );
}
