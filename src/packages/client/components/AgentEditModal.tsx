/**
 * Agent Edit Modal
 * Modal for editing agent properties: class, permission mode, and skills
 */

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { store, useSkillsArray, useCustomAgentClassesArray } from '../store';
import { ModelPreview } from './ModelPreview';
import { FolderInput } from './shared/FolderInput';
import type { Agent, AgentClass, PermissionMode, BuiltInAgentClass, ClaudeModel, CodexModel, AgentProvider, CodexConfig } from '../../shared/types';
import { BUILT_IN_AGENT_CLASSES, PERMISSION_MODES, CLAUDE_MODELS, CODEX_MODELS } from '../../shared/types';
import { apiUrl } from '../utils/storage';
import { useModalClose } from '../hooks';

interface AgentEditModalProps {
  agent: Agent;
  isOpen: boolean;
  onClose: () => void;
}

export function AgentEditModal({ agent, isOpen, onClose }: AgentEditModalProps) {
  const allSkills = useSkillsArray();
  const customClasses = useCustomAgentClassesArray();

  // Form state
  const [selectedClass, setSelectedClass] = useState<AgentClass>(agent.class);
  const [permissionMode, setPermissionMode] = useState<PermissionMode>(agent.permissionMode);
  const [selectedProvider, setSelectedProvider] = useState<AgentProvider>(agent.provider || 'claude');
  const [codexConfig, setCodexConfig] = useState<CodexConfig>(agent.codexConfig || {
    fullAuto: true,
    sandbox: 'workspace-write',
    approvalMode: 'on-request',
    search: false,
  });
  const [selectedModel, setSelectedModel] = useState<ClaudeModel>(agent.model || 'sonnet');
  const [selectedCodexModel, setSelectedCodexModel] = useState<CodexModel>(agent.codexModel || 'gpt-5.3-codex');
  const [useChrome, setUseChrome] = useState<boolean>(agent.useChrome || false);
  const [workdir, setWorkdir] = useState<string>(agent.cwd);
  const [selectedSkillIds, setSelectedSkillIds] = useState<Set<string>>(new Set());
  const [skillSearch, setSkillSearch] = useState('');

  // Get skills currently assigned to this agent
  const _currentAgentSkills = useMemo(() => {
    return allSkills.filter(s =>
      s.enabled && (
        s.assignedAgentIds.includes(agent.id) ||
        s.assignedAgentClasses.includes(agent.class)
      )
    );
  }, [allSkills, agent.id, agent.class]);

  // Initialize selected skills from current assignments
  useEffect(() => {
    const directlyAssigned = allSkills
      .filter(s => s.assignedAgentIds.includes(agent.id))
      .map(s => s.id);
    setSelectedSkillIds(new Set(directlyAssigned));
  }, [allSkills, agent.id]);

  // Reset form when modal opens
  useEffect(() => {
    if (isOpen) {
      setSelectedClass(agent.class);
      setPermissionMode(agent.permissionMode);
      setSelectedProvider(agent.provider || 'claude');
      setCodexConfig(agent.codexConfig || {
        fullAuto: true,
        sandbox: 'workspace-write',
        approvalMode: 'on-request',
        search: false,
      });
      setSelectedModel(agent.model || 'sonnet');
      setSelectedCodexModel(agent.codexModel || 'gpt-5.3-codex');
      setUseChrome(agent.useChrome || false);
      setWorkdir(agent.cwd);
      const directlyAssigned = allSkills
        .filter(s => s.assignedAgentIds.includes(agent.id))
        .map(s => s.id);
      setSelectedSkillIds(new Set(directlyAssigned));
    }
  }, [isOpen, agent, allSkills]);

  // Get available skills (enabled ones)
  const availableSkills = useMemo(() => allSkills.filter(s => s.enabled), [allSkills]);

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

  // Get skills that come from class assignment
  const classBasedSkills = useMemo(() => {
    return availableSkills.filter(s => s.assignedAgentClasses.includes(selectedClass));
  }, [availableSkills, selectedClass]);

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

  // Get preview model for current class selection
  const previewModelFile = useMemo(() => {
    const customClass = customClasses.find(c => c.id === selectedClass);
    if (customClass?.model) {
      return customClass.model;
    }
    return undefined;
  }, [customClasses, selectedClass]);

  // Get custom model URL if the class has an uploaded model
  const previewCustomModelUrl = useMemo(() => {
    const customClass = customClasses.find(c => c.id === selectedClass);
    if (customClass?.customModelPath) {
      return apiUrl(`/api/custom-models/${customClass.id}`);
    }
    return undefined;
  }, [customClasses, selectedClass]);

  // Get model scale for preview
  const previewModelScale = useMemo(() => {
    const customClass = customClasses.find(c => c.id === selectedClass);
    return customClass?.modelScale;
  }, [customClasses, selectedClass]);

  // Get custom class instructions if selected class has any
  const selectedCustomClass = useMemo(() => {
    return customClasses.find(c => c.id === selectedClass);
  }, [customClasses, selectedClass]);

  const previewAgentClass = useMemo((): BuiltInAgentClass => {
    const customClass = customClasses.find(c => c.id === selectedClass);
    if (customClass) {
      return 'scout';
    }
    return selectedClass as BuiltInAgentClass;
  }, [customClasses, selectedClass]);

  // Check if there are any changes
  const hasChanges = useMemo(() => {
    if (selectedClass !== agent.class) return true;
    if (permissionMode !== agent.permissionMode) return true;
    if (selectedProvider !== (agent.provider || 'claude')) return true;
    if (selectedProvider === 'claude' && selectedModel !== (agent.model || 'sonnet')) return true;
    if (selectedProvider === 'codex' && selectedCodexModel !== (agent.codexModel || 'gpt-5.3-codex')) return true;
    if (selectedProvider === 'codex' && JSON.stringify(codexConfig || {}) !== JSON.stringify(agent.codexConfig || {})) return true;
    if (useChrome !== (agent.useChrome || false)) return true;
    if (workdir !== agent.cwd) return true;

    // Check skill changes
    const currentDirectSkills = allSkills
      .filter(s => s.assignedAgentIds.includes(agent.id))
      .map(s => s.id)
      .sort()
      .join(',');
    const newSkills = Array.from(selectedSkillIds).sort().join(',');
    if (currentDirectSkills !== newSkills) return true;

    return false;
  }, [selectedClass, permissionMode, selectedProvider, selectedModel, selectedCodexModel, codexConfig, useChrome, workdir, selectedSkillIds, agent, allSkills]);

  // Handle save
  const handleSave = () => {
    const updates: {
      class?: AgentClass;
      permissionMode?: PermissionMode;
      provider?: AgentProvider;
      codexConfig?: CodexConfig;
      codexModel?: CodexModel;
      model?: ClaudeModel;
      useChrome?: boolean;
      skillIds?: string[];
      cwd?: string;
    } = {};

    if (selectedClass !== agent.class) {
      updates.class = selectedClass;
    }

    if (permissionMode !== agent.permissionMode) {
      updates.permissionMode = permissionMode;
    }

    if (selectedProvider !== (agent.provider || 'claude')) {
      updates.provider = selectedProvider;
    }

    if (selectedProvider === 'codex' && JSON.stringify(codexConfig || {}) !== JSON.stringify(agent.codexConfig || {})) {
      updates.codexConfig = codexConfig;
    }

    if (selectedProvider === 'codex' && selectedCodexModel !== (agent.codexModel || 'gpt-5.3-codex')) {
      updates.codexModel = selectedCodexModel;
    }

    if (selectedProvider === 'claude' && selectedModel !== (agent.model || 'sonnet')) {
      updates.model = selectedModel;
    }

    if (useChrome !== (agent.useChrome || false)) {
      updates.useChrome = useChrome;
    }

    if (workdir !== agent.cwd) {
      updates.cwd = workdir;
    }

    // Always send skill IDs if changed
    const currentDirectSkills = allSkills
      .filter(s => s.assignedAgentIds.includes(agent.id))
      .map(s => s.id)
      .sort()
      .join(',');
    const newSkills = Array.from(selectedSkillIds).sort().join(',');
    if (currentDirectSkills !== newSkills) {
      updates.skillIds = Array.from(selectedSkillIds);
    }

    if (Object.keys(updates).length > 0) {
      store.updateAgentProperties(agent.id, updates);
    }

    onClose();
  };

  const { handleMouseDown: handleBackdropMouseDown, handleClick: handleBackdropClick } = useModalClose(onClose);

  if (!isOpen) return null;

  return (
    <div className="modal-overlay visible" onMouseDown={handleBackdropMouseDown} onClick={handleBackdropClick}>
      <div className="modal agent-edit-modal">
        <div className="modal-header">
          Edit Agent: {agent.name}
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
              <div className="spawn-class-label">Agent Class</div>
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
                {Object.entries(BUILT_IN_AGENT_CLASSES)
                  .filter(([key]) => key !== 'boss')
                  .map(([key, config]) => (
                    <button
                      key={key}
                      className={`class-chip ${selectedClass === key ? 'selected' : ''}`}
                      onClick={() => setSelectedClass(key as AgentClass)}
                      title={config.description}
                    >
                      <span className="class-chip-icon">{config.icon}</span>
                      <span className="class-chip-name">{key.charAt(0).toUpperCase() + key.slice(1)}</span>
                    </button>
                  ))}
              </div>
            </div>
          </div>

          {/* Custom Class Instructions Notice */}
          {selectedCustomClass?.instructions && (
            <div className="custom-class-notice">
              <div className="custom-class-notice-header">
                <span>📋</span>
                <span>This class has custom instructions</span>
              </div>
              <div className="custom-class-notice-info">
                {selectedCustomClass.instructions.length} characters of CLAUDE.md instructions will be injected as system prompt
              </div>
            </div>
          )}

          {/* Form Fields */}
          <div className="spawn-form-section">
            {/* Row 1: Runtime + Permission */}
            <div className="spawn-form-row">
              <div className="spawn-field">
                <label className="spawn-label">Runtime</label>
                <div className="spawn-select-row">
                  <button
                    className={`spawn-select-btn ${selectedProvider === 'claude' ? 'selected' : ''}`}
                    onClick={() => setSelectedProvider('claude')}
                  >
                    <span>🧠</span>
                    <span>Claude</span>
                  </button>
                  <button
                    className={`spawn-select-btn ${selectedProvider === 'codex' ? 'selected' : ''}`}
                    onClick={() => setSelectedProvider('codex')}
                  >
                    <span>⚙️</span>
                    <span>Codex</span>
                  </button>
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

            {/* Row 2: Model */}
            <div className="spawn-form-row">
              <div className="spawn-field">
                <label className="spawn-label">Model</label>
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
                  <div className="spawn-select-row">
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
            </div>

            {selectedProvider === 'codex' && (
              <div className="spawn-form-row">
                <div className="spawn-field">
                  <label className="spawn-label">Codex Config</label>
                  <div className="spawn-options-row" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <label className="spawn-checkbox">
                      <input
                        type="checkbox"
                        checked={codexConfig.fullAuto !== false}
                        onChange={(e) => setCodexConfig((prev) => ({ ...prev, fullAuto: e.target.checked }))}
                      />
                      <span>Use `--full-auto`</span>
                    </label>
                    <label className="spawn-checkbox">
                      <input
                        type="checkbox"
                        checked={!!codexConfig.search}
                        onChange={(e) => setCodexConfig((prev) => ({ ...prev, search: e.target.checked }))}
                      />
                      <span>Enable live web search (`--search`)</span>
                    </label>
                    {codexConfig.fullAuto === false && (
                      <>
                        <select
                          className="spawn-input"
                          value={codexConfig.sandbox || 'workspace-write'}
                          onChange={(e) => setCodexConfig((prev) => ({ ...prev, sandbox: e.target.value as CodexConfig['sandbox'] }))}
                        >
                          <option value="read-only">Sandbox: read-only</option>
                          <option value="workspace-write">Sandbox: workspace-write</option>
                          <option value="danger-full-access">Sandbox: danger-full-access</option>
                        </select>
                        <select
                          className="spawn-input"
                          value={codexConfig.approvalMode || 'on-request'}
                          onChange={(e) => setCodexConfig((prev) => ({ ...prev, approvalMode: e.target.value as CodexConfig['approvalMode'] }))}
                        >
                          <option value="untrusted">Approvals: untrusted</option>
                          <option value="on-failure">Approvals: on-failure</option>
                          <option value="on-request">Approvals: on-request</option>
                          <option value="never">Approvals: never</option>
                        </select>
                      </>
                    )}
                    <input
                      type="text"
                      className="spawn-input"
                      placeholder="Profile (optional)"
                      value={codexConfig.profile || ''}
                      onChange={(e) => setCodexConfig((prev) => ({ ...prev, profile: e.target.value || undefined }))}
                    />
                  </div>
                </div>
              </div>
            )}

            {/* Model change notice */}
            {selectedProvider === 'claude' && selectedModel !== (agent.model || 'sonnet') && (
              <div className="model-change-notice">
                Context preserved - will resume with new model
              </div>
            )}

            {/* Row 3: Chrome toggle */}
            <div className="spawn-form-row spawn-options-row">
              <label className="spawn-checkbox">
                <input
                  type="checkbox"
                  checked={useChrome}
                  onChange={(e) => setUseChrome(e.target.checked)}
                  disabled={selectedProvider !== 'claude'}
                />
                <span>🌐 Chrome Browser</span>
              </label>
            </div>

            {/* Row 4: Working Directory */}
            <div className="spawn-form-row">
              <div className="spawn-field">
                <label className="spawn-label">Working Directory</label>
                <FolderInput
                  value={workdir}
                  onChange={setWorkdir}
                  placeholder="/path/to/directory"
                  className="spawn-input"
                  directoriesOnly={true}
                />
              </div>
            </div>

            {/* Workdir change notice */}
            {workdir !== agent.cwd && (
              <div className="model-change-notice warning">
                New session will start - context cannot be preserved across directory changes
              </div>
            )}

            {/* Skills section */}
            <div className="spawn-skills-section">
              <label className="spawn-label">
                Skills <span className="spawn-label-hint">(click to toggle)</span>
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
              <div className="skills-chips-compact">
                {availableSkills.length === 0 ? (
                  <div className="skills-empty">No enabled skills available</div>
                ) : filteredSkills.length === 0 ? (
                  <div className="skills-empty">No skills match "{skillSearch}"</div>
                ) : (
                  filteredSkills.map(skill => {
                    const isClassBased = classBasedSkills.includes(skill);
                    const isDirectlyAssigned = selectedSkillIds.has(skill.id);
                    const isActive = isDirectlyAssigned || isClassBased;

                    return (
                      <button
                        key={skill.id}
                        className={`skill-chip ${isActive ? 'selected' : ''} ${isClassBased ? 'class-based' : ''}`}
                        onClick={() => !isClassBased && toggleSkill(skill.id)}
                        title={isClassBased ? 'Assigned via class' : skill.name}
                      >
                        {isActive && <span className="skill-check">✓</span>}
                        <span className="skill-chip-name">{skill.name}</span>
                        {skill.builtin && <span className="skill-chip-badge builtin">TC</span>}
                        {isClassBased && <span className="skill-chip-badge">class</span>}
                      </button>
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
          <button
            className="btn btn-primary"
            onClick={handleSave}
            disabled={!hasChanges}
          >
            Save Changes
          </button>
        </div>
      </div>
    </div>
  );
}
