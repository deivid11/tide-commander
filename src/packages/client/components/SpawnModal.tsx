import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { store, useAgents, useSkillsArray, useCustomAgentClassesArray } from '../store';
import { AGENT_CLASS_CONFIG, DEFAULT_NAMES, CHARACTER_MODELS } from '../scene/config';
import type { AgentClass, PermissionMode, Skill, CustomAgentClass, BuiltInAgentClass, ClaudeModel } from '../../shared/types';
import { PERMISSION_MODES, BUILT_IN_AGENT_CLASSES, CLAUDE_MODELS } from '../../shared/types';
import { intToHex } from '../utils/formatting';
import { ModelPreview } from './ModelPreview';

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
}

/**
 * Get a random unused LOTR name.
 */
function getRandomLotrName(usedNames: Set<string>): string {
  const availableNames = DEFAULT_NAMES.filter((n) => !usedNames.has(n));
  if (availableNames.length === 0) {
    // All names used, add a number suffix
    const baseName = DEFAULT_NAMES[Math.floor(Math.random() * DEFAULT_NAMES.length)];
    return `${baseName}-${Date.now() % 1000}`;
  }
  return availableNames[Math.floor(Math.random() * availableNames.length)];
}

export function SpawnModal({ isOpen, onClose, onSpawnStart, onSpawnEnd }: SpawnModalProps) {
  const agents = useAgents();
  const skills = useSkillsArray();
  const customClasses = useCustomAgentClassesArray();
  const [name, setName] = useState('');
  const [cwd, setCwd] = useState(() => localStorage.getItem('tide-last-cwd') || '');
  const [selectedClass, setSelectedClass] = useState<AgentClass>('scout');
  const [isSpawning, setIsSpawning] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [showCreateDirPrompt, setShowCreateDirPrompt] = useState(false);
  const [missingDirPath, setMissingDirPath] = useState('');
  const [sessions, setSessions] = useState<ClaudeSession[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [sessionSearch, setSessionSearch] = useState('');
  const [useChrome, setUseChrome] = useState(true); // Enabled by default
  const [permissionMode, setPermissionMode] = useState<PermissionMode>('bypass'); // Default to permissionless
  const [selectedSkillIds, setSelectedSkillIds] = useState<Set<string>>(new Set());
  const [selectedModel, setSelectedModel] = useState<ClaudeModel>('sonnet'); // Default to sonnet
  const nameInputRef = useRef<HTMLInputElement>(null);

  // Get available skills (enabled ones)
  const availableSkills = useMemo(() => skills.filter(s => s.enabled), [skills]);

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
  const classMatchingSkills = useMemo(() => {
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
        ? `/api/agents/claude-sessions?cwd=${encodeURIComponent(directory)}`
        : '/api/agents/claude-sessions';
      const res = await fetch(url);
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
      setName(getRandomLotrName(usedNames));
      if (nameInputRef.current) {
        nameInputRef.current.focus();
        nameInputRef.current.select();
      }
    }
  }, [isOpen, agents]);

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
      setName(getRandomLotrName(usedNames));
      return;
    }

    localStorage.setItem('tide-last-cwd', effectiveCwd);
    setIsSpawning(true);
    onSpawnStart();

    const initialSkillIds = Array.from(selectedSkillIds);
    console.log('[SpawnModal] Calling store.spawnAgent with:', {
      name: name.trim(),
      class: selectedClass,
      cwd: effectiveCwd.trim(),
      sessionId: selectedSessionId || undefined,
      useChrome,
      permissionMode,
      initialSkillIds,
      model: selectedModel
    });

    store.spawnAgent(name.trim(), selectedClass, effectiveCwd.trim(), undefined, selectedSessionId || undefined, useChrome, permissionMode, initialSkillIds, selectedModel);
  };

  const handleSuccess = () => {
    console.log('[SpawnModal] Agent creation successful');
    setIsSpawning(false);
    setName('');
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
      onClick={handleBackdropClick}
      onKeyDown={handleKeyDown}
    >
      <div className="modal spawn-modal">
        <div className="modal-header">Deploy New Agent</div>

        <div className="modal-body spawn-modal-body">
          {/* Left: Model Preview */}
          <div className="spawn-preview-section">
            <ModelPreview agentClass={previewAgentClass} modelFile={previewModelFile} width={180} height={220} />
            <div className="spawn-preview-name">
              {selectedCustomClass
                ? `${selectedCustomClass.icon} ${selectedCustomClass.name}`
                : CHARACTER_MODELS.find((c) => c.id === selectedClass)?.name || selectedClass}
            </div>
          </div>

          {/* Right: Form */}
          <div className="spawn-form-section">
            <div className="form-group">
              <label className="form-label">Agent Name</label>
              <input
                ref={nameInputRef}
                type="text"
                className="form-input"
                placeholder="Enter agent name"
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
                Link to Claude Session
                <span className="form-label-hint">(optional)</span>
              </label>
              {sessions.length > 0 && (
                <input
                  type="text"
                  className="form-input session-search-input"
                  placeholder="Search by session ID, path, or message..."
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
                        <div className="session-item-id">
                          {session.sessionId}
                        </div>
                        <div className="session-item-preview">
                          {session.firstMessage || `${session.messageCount} messages`}
                        </div>
                        <div className="session-item-meta">
                          {session.messageCount} messages
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">Agent Class</label>
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
                {/* Built-in classes */}
                {CHARACTER_MODELS.map((char) => {
                  const config = AGENT_CLASS_CONFIG[char.id];
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

            {/* Class Features (instructions and default skills) */}
            {(selectedCustomClass?.instructions || classDefaultSkills.length > 0) && (
              <div className="form-group">
                <label className="form-label">
                  Class Features
                  <span className="form-label-hint">(included with this class)</span>
                </label>
                <div className="class-features-display">
                  {selectedCustomClass?.instructions && (
                    <div className="class-feature-tag instructions" title="This class has custom instructions">
                      <span className="class-feature-icon">📋</span>
                      <span className="class-feature-name">Custom Instructions</span>
                    </div>
                  )}
                  {classDefaultSkills.map((skill) => (
                    <div
                      key={skill.id}
                      className="class-feature-tag skill"
                      title={skill.description}
                    >
                      <span className="class-feature-icon">📜</span>
                      <span className="class-feature-name">{skill.name}</span>
                    </div>
                  ))}
                </div>
                <div className="form-hint">
                  These are automatically applied to all agents of this class
                </div>
              </div>
            )}

            {/* Additional Skills Selection */}
            {availableSkills.length > 0 && (
              <div className="form-group">
                <label className="form-label">
                  Additional Skills
                  <span className="form-label-hint">(optional)</span>
                </label>
                <div className="skills-selector">
                  {availableSkills.map((skill) => {
                    const isSelected = selectedSkillIds.has(skill.id);
                    const isClassMatch = skill.assignedAgentClasses.includes(selectedClass);
                    const isClassDefault = classDefaultSkills.some(s => s.id === skill.id);
                    // Don't show skills that are already class defaults
                    if (isClassDefault) return null;
                    return (
                      <div
                        key={skill.id}
                        className={`skill-option ${isSelected ? 'selected' : ''} ${isClassMatch ? 'class-match' : ''}`}
                        onClick={() => toggleSkill(skill.id)}
                        title={skill.description}
                      >
                        <span className="skill-check">{isSelected ? '✓' : ''}</span>
                        <span className="skill-name">{skill.name}</span>
                        {isClassMatch && <span className="skill-class-badge">auto</span>}
                      </div>
                    );
                  })}
                </div>
                {classMatchingSkills.length > 0 && (
                  <div className="form-hint">
                    Skills marked "auto" will apply to this class automatically
                  </div>
                )}
              </div>
            )}

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
          <button className="btn btn-primary" onClick={handleSpawn} disabled={isSpawning}>
            {isSpawning ? 'Deploying...' : 'Deploy'}
          </button>
        </div>
      </div>
    </div>
  );
}
