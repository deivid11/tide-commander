import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { store, useAgents, useSkillsArray, useCustomAgentClassesArray, useCustomAgentNames } from '../store';
import { AGENT_CLASS_CONFIG, BUILTIN_AGENT_NAMES, CHARACTER_MODELS } from '../scene/config';
import type { AgentClass, PermissionMode, BuiltInAgentClass, ClaudeModel, CodexModel, AgentProvider, CodexConfig } from '../../shared/types';
import { PERMISSION_MODES, CLAUDE_MODELS, CODEX_MODELS } from '../../shared/types';
import { STORAGE_KEYS, getStorageString, setStorageString, apiUrl, authFetch } from '../utils/storage';
import { ModelPreview } from './ModelPreview';
import { HelpTooltip } from './shared/Tooltip';
import { FolderInput } from './shared/FolderInput';
import { useModalClose } from '../hooks';

interface ClaudeSession {
  sessionId: string;
  projectPath: string;
  lastModified: string;
  messageCount: number;
  firstMessage?: string;
}

interface SpawnModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSpawnStart: () => void;
  onSpawnEnd: () => void;
  /** Optional spawn position - if provided, agent spawns at this location */
  spawnPosition?: { x: number; z: number } | null;
}

/**
 * Get a random unused agent name from the provided names list.
 */
function getRandomAgentName(usedNames: Set<string>, namesList: string[]): string {
  const availableNames = namesList.filter((n) => !usedNames.has(n));
  if (availableNames.length === 0) {
    // All names used, add a number suffix
    const baseName = namesList[Math.floor(Math.random() * namesList.length)];
    return `${baseName}-${Date.now() % 1000}`;
  }
  return availableNames[Math.floor(Math.random() * availableNames.length)];
}

export function SpawnModal({ isOpen, onClose, onSpawnStart, onSpawnEnd, spawnPosition }: SpawnModalProps) {
  const agents = useAgents();
  const skills = useSkillsArray();
  const customClasses = useCustomAgentClassesArray();
  const customAgentNames = useCustomAgentNames();

  // Use custom names if configured, otherwise fall back to built-in names
  const effectiveNamesList = customAgentNames.length > 0 ? customAgentNames : BUILTIN_AGENT_NAMES;
  const [name, setName] = useState('');
  const [cwd, setCwd] = useState(() => getStorageString(STORAGE_KEYS.LAST_CWD));
  const [selectedClass, setSelectedClass] = useState<AgentClass>('scout');
  const [isSpawning, setIsSpawning] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [showCreateDirPrompt, setShowCreateDirPrompt] = useState(false);
  const [missingDirPath, setMissingDirPath] = useState('');
  const [sessions, setSessions] = useState<ClaudeSession[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [sessionSearch, setSessionSearch] = useState('');
  const [classSearch, setClassSearch] = useState('');
  const [useChrome, setUseChrome] = useState(true); // Enabled by default
  const [permissionMode, setPermissionMode] = useState<PermissionMode>('bypass'); // Default to permissionless
  const [selectedProvider, setSelectedProvider] = useState<AgentProvider>('claude');
  const [codexConfig, setCodexConfig] = useState<CodexConfig>({
    fullAuto: true,
    sandbox: 'workspace-write',
    approvalMode: 'on-request',
    search: false,
  });
  const [selectedSkillIds, setSelectedSkillIds] = useState<Set<string>>(new Set());
  const [selectedModel, setSelectedModel] = useState<ClaudeModel>('opus'); // Default to opus
  const [selectedCodexModel, setSelectedCodexModel] = useState<CodexModel>('gpt-5.3-codex');
  const [customInstructions, setCustomInstructions] = useState('');
  const [skillSearch, setSkillSearch] = useState('');
  const nameInputRef = useRef<HTMLInputElement>(null);

  // Get available skills (enabled ones)
  const availableSkills = useMemo(() => skills.filter(s => s.enabled), [skills]);

  // Default skill slugs that should be pre-selected for new agents
  const DEFAULT_SKILL_SLUGS = ['full-notifications', 'streaming-exec'];

  // Initialize default skills when modal opens
  useEffect(() => {
    if (isOpen && availableSkills.length > 0) {
      const defaultSkillIds = availableSkills
        .filter(s => DEFAULT_SKILL_SLUGS.includes(s.slug))
        .map(s => s.id);
      if (defaultSkillIds.length > 0) {
        setSelectedSkillIds(prev => {
          // Only set defaults if no skills are selected yet
          if (prev.size === 0) {
            return new Set(defaultSkillIds);
          }
          return prev;
        });
      }
    }
  }, [isOpen, availableSkills]);

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

  // Get skills that match the selected class (for auto-selection hint)
  const _classMatchingSkills = useMemo(() => {
    return availableSkills.filter(s => s.assignedAgentClasses.includes(selectedClass));
  }, [availableSkills, selectedClass]);

  // Get default skills for selected custom class
  const classDefaultSkills = useMemo(() => {
    const customClass = customClasses.find(c => c.id === selectedClass);
    if (!customClass?.defaultSkillIds?.length) return [];
    return skills.filter(s => customClass.defaultSkillIds.includes(s.id));
  }, [customClasses, selectedClass, skills]);

  // Filter sessions by search query
  const filteredSessions = useMemo(() => {
    if (!sessionSearch.trim()) return sessions;
    const query = sessionSearch.toLowerCase();
    return sessions.filter(s =>
      s.sessionId.toLowerCase().includes(query) ||
      s.projectPath.toLowerCase().includes(query) ||
      (s.firstMessage && s.firstMessage.toLowerCase().includes(query))
    );
  }, [sessions, sessionSearch]);

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
      return (
        char.name.toLowerCase().includes(query) ||
        char.id.toLowerCase().includes(query) ||
        config.description.toLowerCase().includes(query)
      );
    });
  }, [classSearch]);

  // Get custom class config if selected class is custom
  const selectedCustomClass = useMemo(() => {
    return customClasses.find(c => c.id === selectedClass);
  }, [customClasses, selectedClass]);

  // Get the visual model file for preview
  // For custom classes, use the model file directly; for built-in, use agentClass to lookup
  const previewModelFile = useMemo((): string | undefined => {
    if (selectedCustomClass?.model) {
      return selectedCustomClass.model;
    }
    return undefined; // Let ModelPreview look up from agentClass
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
      return 'scout'; // Fallback, but modelFile will take precedence
    }
    return selectedClass as BuiltInAgentClass;
  }, [selectedClass, selectedCustomClass]);

  // Fetch Claude sessions
  const fetchSessions = useCallback(async (directory?: string) => {
    setLoadingSessions(true);
    try {
      const url = directory
        ? apiUrl(`/api/agents/claude-sessions?cwd=${encodeURIComponent(directory)}`)
        : apiUrl('/api/agents/claude-sessions');
      const res = await authFetch(url);
      const data = await res.json();
      setSessions(data.sessions || []);
    } catch (err) {
      console.error('Failed to fetch sessions:', err);
      setSessions([]);
    } finally {
      setLoadingSessions(false);
    }
  }, []);

  // Fetch sessions when modal opens
  useEffect(() => {
    if (isOpen) {
      fetchSessions(cwd || undefined);
    } else {
      setSessions([]);
      setSelectedSessionId(null);
      setSessionSearch('');
    }
  }, [isOpen, fetchSessions]);

  // Refetch sessions when cwd changes (debounced)
  useEffect(() => {
    if (!isOpen) return;
    const timer = setTimeout(() => {
      fetchSessions(cwd || undefined);
      setSelectedSessionId(null);
    }, 300);
    return () => clearTimeout(timer);
  }, [cwd, isOpen, fetchSessions]);

  // Generate a new name when modal opens
  useEffect(() => {
    if (isOpen) {
      const usedNames = new Set(Array.from(agents.values()).map((a) => a.name));
      const baseName = getRandomAgentName(usedNames, effectiveNamesList);
      // If a custom class is selected, prefix the class name
      const customClass = customClasses.find(c => c.id === selectedClass);
      const finalName = customClass ? `${customClass.name} ${baseName}` : baseName;
      setName(finalName);
      if (nameInputRef.current) {
        nameInputRef.current.focus();
        nameInputRef.current.select();
      }
    }
  }, [isOpen, agents, effectiveNamesList]);

  // Update name prefix when custom class changes
  useEffect(() => {
    if (!isOpen) return;
    const _usedNames = new Set(Array.from(agents.values()).map((a) => a.name));
    const customClass = customClasses.find(c => c.id === selectedClass);

    if (customClass) {
      // Check if current name already has a class prefix (any custom class prefix)
      const existingPrefix = customClasses.find(c => name.startsWith(c.name + ' '));
      if (existingPrefix) {
        // Replace the existing prefix with the new one
        const baseName = name.substring(existingPrefix.name.length + 1);
        setName(`${customClass.name} ${baseName}`);
      } else {
        // Add the prefix to the current name
        setName(`${customClass.name} ${name}`);
      }
    } else {
      // Switching to a built-in class - remove any custom class prefix
      const existingPrefix = customClasses.find(c => name.startsWith(c.name + ' '));
      if (existingPrefix) {
        const baseName = name.substring(existingPrefix.name.length + 1);
        setName(baseName);
      }
    }
  }, [selectedClass]);

  const handleSpawn = () => {
    console.log('[SpawnModal] handleSpawn called');
    setHasError(false);

    // If a session is selected, use its project path as cwd
    const effectiveCwd = selectedSessionId
      ? sessions.find(s => s.sessionId === selectedSessionId)?.projectPath || cwd
      : cwd;

    console.log('[SpawnModal] Effective CWD:', effectiveCwd);
    console.log('[SpawnModal] Agent name:', name);
    console.log('[SpawnModal] Agent class:', selectedClass);
    console.log('[SpawnModal] Permission mode:', permissionMode);
    console.log('[SpawnModal] Provider:', selectedProvider);
    console.log('[SpawnModal] Use Chrome:', useChrome);
    console.log('[SpawnModal] Session ID:', selectedSessionId || 'none');

    if (!effectiveCwd.trim()) {
      console.error('[SpawnModal] Empty CWD, showing error');
      setHasError(true);
      return;
    }

    if (!name.trim()) {
      // Name should be prefilled, but regenerate if somehow empty
      console.log('[SpawnModal] Empty name, regenerating');
      const usedNames = new Set(Array.from(agents.values()).map((a) => a.name));
      setName(getRandomAgentName(usedNames, effectiveNamesList));
      return;
    }

    setStorageString(STORAGE_KEYS.LAST_CWD, effectiveCwd);
    setIsSpawning(true);
    onSpawnStart();

    const initialSkillIds = Array.from(selectedSkillIds);
    const trimmedInstructions = customInstructions.trim() || undefined;
    console.log('[SpawnModal] Calling store.spawnAgent with:', {
      name: name.trim(),
      class: selectedClass,
      cwd: effectiveCwd.trim(),
      sessionId: selectedSessionId || undefined,
      useChrome: selectedProvider === 'claude' ? useChrome : false,
      permissionMode,
      provider: selectedProvider,
      codexConfig: selectedProvider === 'codex' ? codexConfig : undefined,
      codexModel: selectedProvider === 'codex' ? selectedCodexModel : undefined,
      initialSkillIds,
      model: selectedProvider === 'claude' ? selectedModel : undefined,
      customInstructions: trimmedInstructions ? `${trimmedInstructions.length} chars` : undefined,
    });

    store.spawnAgent(
      name.trim(),
      selectedClass,
      effectiveCwd.trim(),
      spawnPosition || undefined,
      selectedSessionId || undefined,
      selectedProvider === 'claude' ? useChrome : false,
      permissionMode,
      initialSkillIds,
      selectedProvider,
      selectedProvider === 'codex' ? codexConfig : undefined,
      selectedProvider === 'codex' ? selectedCodexModel : undefined,
      selectedProvider === 'claude' ? selectedModel : undefined,
      trimmedInstructions
    );
  };

  const handleSuccess = () => {
    console.log('[SpawnModal] Agent creation successful');
    setIsSpawning(false);
    setName('');
    setSelectedSkillIds(new Set()); // Reset so defaults re-apply on next open
    onSpawnEnd();
    onClose();
  };

  const handleError = () => {
    console.error('[SpawnModal] Agent creation failed');
    setIsSpawning(false);
    setHasError(true);
    onSpawnEnd();
  };

  const handleDirectoryNotFound = (path: string) => {
    console.log('[SpawnModal] Directory not found:', path);
    setIsSpawning(false);
    setMissingDirPath(path);
    setShowCreateDirPrompt(true);
    onSpawnEnd();
  };

  const handleCreateDirectory = () => {
    setShowCreateDirPrompt(false);
    setIsSpawning(true);
    onSpawnStart();
    store.createDirectoryAndSpawn(missingDirPath, name.trim(), selectedClass);
  };

  const handleCancelCreateDir = () => {
    setShowCreateDirPrompt(false);
    setMissingDirPath('');
  };

  // Expose handlers for websocket callbacks
  useEffect(() => {
    (window as any).__spawnModalSuccess = handleSuccess;
    (window as any).__spawnModalError = handleError;
    (window as any).__spawnModalDirNotFound = handleDirectoryNotFound;
    return () => {
      delete (window as any).__spawnModalSuccess;
      delete (window as any).__spawnModalError;
      delete (window as any).__spawnModalDirNotFound;
    };
  }, [name, selectedClass]);

  const { handleMouseDown: handleBackdropMouseDown, handleClick: handleBackdropClick } = useModalClose(onClose);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose();
    }
  };

  if (!isOpen && !showCreateDirPrompt) return null;

  // Show create directory confirmation dialog
  if (showCreateDirPrompt) {
    return (
      <div
        className="modal-overlay visible"
        onClick={handleCancelCreateDir}
        onKeyDown={(e) => {
          if (e.key === 'Escape') handleCancelCreateDir();
          if (e.key === 'Enter') handleCreateDirectory();
        }}
      >
        <div className="modal confirm-modal" onClick={(e) => e.stopPropagation()}>
          <div className="modal-header">Directory Not Found</div>
          <div className="modal-body confirm-modal-body">
            <p>The directory does not exist:</p>
            <code className="confirm-modal-path">{missingDirPath}</code>
            <p>Would you like to create it?</p>
          </div>
          <div className="modal-footer">
            <button className="btn btn-secondary" onClick={handleCancelCreateDir}>
              Cancel
            </button>
            <button className="btn btn-primary" onClick={handleCreateDirectory} autoFocus>
              Create Directory
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`modal-overlay ${isOpen ? 'visible' : ''}`}
      onMouseDown={handleBackdropMouseDown}
      onClick={handleBackdropClick}
      onKeyDown={handleKeyDown}
    >
      <div className="modal spawn-modal">
        <div className="modal-header">Deploy New Agent</div>

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
              <div className="spawn-class-label">Agent Class</div>
              {(customClasses.length + CHARACTER_MODELS.length) > 6 && (
                <input
                  type="text"
                  className="spawn-input class-search-input"
                  placeholder="Filter classes..."
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
                {filteredBuiltInClasses.map((char) => {
                  const config = AGENT_CLASS_CONFIG[char.id];
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
                {classSearch && filteredCustomClasses.length === 0 && filteredBuiltInClasses.length === 0 && (
                  <div className="class-search-empty">No classes match "{classSearch}"</div>
                )}
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
                  placeholder="Agent name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
              <div className="spawn-field spawn-field-wide">
                <label className="spawn-label">
                  Working Directory
                  <HelpTooltip
                    text="The directory where the agent will operate. All file operations and commands run relative to this path."
                    title="Working Directory"
                    position="top"
                    size="sm"
                  />
                </label>
                <FolderInput
                  value={cwd}
                  onChange={(val) => {
                    setCwd(val);
                    setHasError(false);
                  }}
                  placeholder="/path/to/project"
                  className={`spawn-input ${hasError ? 'error' : ''}`}
                  directoriesOnly={true}
                />
              </div>
            </div>

            {/* Row 2: Runtime + Permission */}
            <div className="spawn-form-row">
              <div className="spawn-field">
                <label className="spawn-label">
                  Runtime
                  <HelpTooltip
                    text={<>
                      <strong>Claude:</strong> Uses Claude CLI runtime<br/>
                      <strong>Codex:</strong> Uses Codex CLI runtime with JSON events
                    </>}
                    title="Agent Runtime"
                    position="top"
                    size="sm"
                  />
                </label>
                <div className="spawn-select-row">
                  <button
                    className={`spawn-select-btn ${selectedProvider === 'claude' ? 'selected' : ''}`}
                    onClick={() => setSelectedProvider('claude')}
                    title="Use Claude CLI"
                  >
                    <span>🧠</span>
                    <span>Claude</span>
                  </button>
                  <button
                    className={`spawn-select-btn ${selectedProvider === 'codex' ? 'selected' : ''}`}
                    onClick={() => setSelectedProvider('codex')}
                    title="Use Codex CLI"
                  >
                    <span>⚙️</span>
                    <span>Codex</span>
                  </button>
                </div>
              </div>
              <div className="spawn-field">
                <label className="spawn-label">
                  Permissions
                  <HelpTooltip
                    text={<>
                      <strong>Bypass:</strong> Agent runs without permission prompts. Faster but less controlled.<br/>
                      <strong>Default:</strong> Agent asks for confirmation before risky actions like file writes.
                    </>}
                    title="Permission Mode"
                    position="top"
                    size="sm"
                  />
                </label>
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

            {/* Row 3: Model (Claude only) + Chrome */}
            <div className="spawn-form-row">
              <div className="spawn-field">
                <label className="spawn-label">
                  Model
                  <HelpTooltip
                    text={<>
                      <strong>Opus:</strong> Most capable, best for complex tasks<br/>
                      <strong>Sonnet:</strong> Balanced speed and capability<br/>
                      <strong>Haiku:</strong> Fastest, good for simple tasks
                    </>}
                    title="Claude Model"
                    position="top"
                    size="sm"
                  />
                </label>
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
                  <div className="spawn-inline-hint">Choose the Codex model for this agent.</div>
                )}
              </div>
              <div className="spawn-field">
                <label className="spawn-label">Browser</label>
                <div className="spawn-form-row spawn-options-row">
                  <label className="spawn-checkbox">
                    <input
                      type="checkbox"
                      checked={useChrome}
                      onChange={(e) => setUseChrome(e.target.checked)}
                      disabled={selectedProvider !== 'claude'}
                    />
                    <span>🌐 Chrome Browser</span>
                    <HelpTooltip
                      text={selectedProvider === 'claude'
                        ? 'Enable Chrome browser automation. The agent can navigate web pages, fill forms, and interact with web applications. Requires Claude in Chrome extension.'
                        : 'Chrome automation is currently available only with Claude runtime.'
                      }
                      title="Chrome Browser"
                      position="top"
                      size="sm"
                    />
                  </label>
                </div>
              </div>
            </div>

            {selectedProvider === 'codex' && (
              <div className="codex-config-section">
                <div className="codex-config-title">Configuration</div>
                <div className="codex-config-options">
                  {/* Flags section */}
                  <div className="codex-option-group">
                    <label className="spawn-checkbox">
                      <input
                        type="checkbox"
                        checked={codexConfig.fullAuto !== false}
                        onChange={(e) =>
                          setCodexConfig((prev) => ({
                            ...prev,
                            fullAuto: e.target.checked,
                          }))
                        }
                      />
                      <span>`--full-auto` mode</span>
                      <HelpTooltip
                        text="Enable full autonomous mode. Agent operates without approval gates."
                        title="Full Auto Mode"
                        position="top"
                        size="sm"
                      />
                    </label>
                    <label className="spawn-checkbox">
                      <input
                        type="checkbox"
                        checked={!!codexConfig.search}
                        onChange={(e) =>
                          setCodexConfig((prev) => ({
                            ...prev,
                            search: e.target.checked,
                          }))
                        }
                      />
                      <span>`--search` live web search</span>
                      <HelpTooltip
                        text="Enable real-time internet search for current information."
                        title="Live Web Search"
                        position="top"
                        size="sm"
                      />
                    </label>
                  </div>

                  {/* Conditional options when not full-auto */}
                  {codexConfig.fullAuto === false && (
                    <div className="codex-option-group">
                      <div className="codex-option-header">Restrictions</div>
                      <select
                        className="spawn-input codex-select"
                        value={codexConfig.sandbox || 'workspace-write'}
                        onChange={(e) =>
                          setCodexConfig((prev) => ({
                            ...prev,
                            sandbox: e.target.value as CodexConfig['sandbox'],
                          }))
                        }
                      >
                        <option value="read-only">📖 Sandbox: read-only</option>
                        <option value="workspace-write">✏️  Sandbox: workspace-write</option>
                        <option value="danger-full-access">⚡ Sandbox: danger-full-access</option>
                      </select>
                      <select
                        className="spawn-input codex-select"
                        value={codexConfig.approvalMode || 'on-request'}
                        onChange={(e) =>
                          setCodexConfig((prev) => ({
                            ...prev,
                            approvalMode: e.target.value as CodexConfig['approvalMode'],
                          }))
                        }
                      >
                        <option value="untrusted">🔒 Approvals: untrusted</option>
                        <option value="on-failure">⚠️  Approvals: on-failure</option>
                        <option value="on-request">🤔 Approvals: on-request</option>
                        <option value="never">✅ Approvals: never</option>
                      </select>
                    </div>
                  )}

                  {/* Profile option */}
                  <div className="codex-option-group">
                    <div className="codex-option-header">Profile</div>
                    <input
                      type="text"
                      className="spawn-input codex-profile-input"
                      placeholder="Optional profile name"
                      value={codexConfig.profile || ''}
                      onChange={(e) =>
                        setCodexConfig((prev) => ({
                          ...prev,
                          profile: e.target.value || undefined,
                        }))
                      }
                    />
                  </div>
                </div>
              </div>
            )}

            {/* Skills section */}
            {availableSkills.length > 0 && (
              <div className="spawn-skills-section">
                <label className="spawn-label">
                  Skills <span className="spawn-label-hint">(optional)</span>
                  <HelpTooltip
                    text="Skills add specialized capabilities to your agent. Select skills this agent should have access to. Class-default skills are automatically included."
                    title="Agent Skills"
                    position="top"
                    size="sm"
                  />
                </label>
                {availableSkills.length > 6 && (
                  <input
                    type="text"
                    className="spawn-input skill-search-input"
                    placeholder="Filter skills..."
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
                    <div className="skill-search-empty">No skills match "{skillSearch}"</div>
                  )}
                </div>
              </div>
            )}

            {/* Custom Instructions */}
            <div className="spawn-custom-instructions-section">
              <label className="spawn-label">
                Custom Instructions <span className="spawn-label-hint">(optional)</span>
                <HelpTooltip
                  text="Additional instructions appended to this agent's system prompt. Use this to customize behavior, provide context, or set specific guidelines."
                  title="Custom Instructions"
                  position="top"
                  size="sm"
                />
              </label>
              <textarea
                className="spawn-input spawn-textarea"
                placeholder="Add custom instructions that will be appended to this agent's system prompt..."
                value={customInstructions}
                onChange={(e) => setCustomInstructions(e.target.value)}
                rows={3}
              />
            </div>

            {/* Sessions */}
            <div className="spawn-sessions-section">
              <label className="spawn-label">
                Link Session <span className="spawn-label-hint">(optional)</span>
                <HelpTooltip
                  text="Link this agent to an existing Claude Code session. The agent will resume from that session's conversation history, preserving context and previous work."
                  title="Session Linking"
                  position="top"
                  size="sm"
                />
              </label>
              {sessions.length > 0 && (
                <input
                  type="text"
                  className="spawn-input session-search-input"
                  placeholder="Search sessions..."
                  value={sessionSearch}
                  onChange={(e) => setSessionSearch(e.target.value)}
                />
              )}
              <div className="sessions-list">
                {loadingSessions ? (
                  <div className="sessions-loading">Loading sessions...</div>
                ) : sessions.length === 0 ? (
                  <div className="sessions-empty">No Claude sessions found</div>
                ) : filteredSessions.length === 0 ? (
                  <div className="sessions-empty">No sessions match "{sessionSearch}"</div>
                ) : (
                  filteredSessions.map((session) => {
                    const isSelected = selectedSessionId === session.sessionId;
                    const age = Date.now() - new Date(session.lastModified).getTime();
                    const ageStr = age < 60000 ? 'just now'
                      : age < 3600000 ? `${Math.floor(age / 60000)}m ago`
                      : age < 86400000 ? `${Math.floor(age / 3600000)}h ago`
                      : `${Math.floor(age / 86400000)}d ago`;

                    return (
                      <div
                        key={session.sessionId}
                        className={`session-item ${isSelected ? 'selected' : ''}`}
                        onClick={() => {
                          if (isSelected) {
                            setSelectedSessionId(null);
                          } else {
                            setSelectedSessionId(session.sessionId);
                            setCwd(session.projectPath);
                          }
                        }}
                      >
                        <div className="session-item-header">
                          <span className="session-item-path">{session.projectPath}</span>
                          <span className="session-item-age">{ageStr}</span>
                        </div>
                        <div className="session-item-preview">
                          {session.firstMessage || `${session.messageCount} messages`}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={handleSpawn} disabled={isSpawning}>
            {isSpawning ? 'Deploying...' : 'Deploy'}
          </button>
        </div>
      </div>
    </div>
  );
}
