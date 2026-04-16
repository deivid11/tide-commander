/**
 * Agent Edit Modal
 * Modal for editing agent properties: class, permission mode, and skills
 */

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { store, useSkillsArray, useCustomAgentClassesArray } from '../store';
import { KeyCaptureInput } from './KeyCaptureInput';
import { ModelPreview } from './ModelPreview';
import { FolderInput } from './shared/FolderInput';
import type { Agent, AgentClass, PermissionMode, BuiltInAgentClass, ClaudeModel, ClaudeEffort, CodexModel, AgentProvider, CodexConfig } from '../../shared/types';
import { BUILT_IN_AGENT_CLASSES, PERMISSION_MODES, CLAUDE_MODELS, CLAUDE_EFFORTS, CODEX_MODELS } from '../../shared/types';
import { ShortcutConfig, formatShortcutString, parseShortcutString, shortcutValueToString } from '../store/shortcuts';
import { apiUrl } from '../utils/storage';
import { useModalClose } from '../hooks';
import { AgentIcon } from './AgentIcon';

interface AgentEditModalProps {
  agent: Agent;
  isOpen: boolean;
  onClose: () => void;
}

type AgentWithShortcut = Agent & { shortcut?: string };

export function AgentEditModal({ agent, isOpen, onClose }: AgentEditModalProps) {
  const { t } = useTranslation(['terminal', 'common', 'tools']);
  const allSkills = useSkillsArray();
  const customClasses = useCustomAgentClassesArray();

  // Form state
  const [agentName, setAgentName] = useState<string>(agent.name);
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
  const [selectedEffort, setSelectedEffort] = useState<ClaudeEffort | undefined>(agent.effort);
  const [selectedCodexModel, setSelectedCodexModel] = useState<CodexModel>(agent.codexModel || 'gpt-5.3-codex');
  const [opencodeModel, setOpencodeModel] = useState<string>((agent as any).opencodeModel || 'minimax/MiniMax-M1-80k');
  const [useChrome, setUseChrome] = useState<boolean>(agent.useChrome || false);
  const [workdir, setWorkdir] = useState<string>(agent.cwd);
  const [shortcut, setShortcut] = useState<string>(((agent as AgentWithShortcut).shortcut || '').trim());
  const [selectedSkillIds, setSelectedSkillIds] = useState<Set<string>>(new Set());
  const [skillSearch, setSkillSearch] = useState('');
  const [editingInstructions, setEditingInstructions] = useState(false);
  const [instructionsText, setInstructionsText] = useState('');

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
      setAgentName(agent.name);
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
      setSelectedEffort(agent.effort);
      setSelectedCodexModel(agent.codexModel || 'gpt-5.3-codex');
      setOpencodeModel((agent as any).opencodeModel || 'minimax/MiniMax-M1-80k');
      setUseChrome(agent.useChrome || false);
      setWorkdir(agent.cwd);
      setShortcut((((agent as AgentWithShortcut).shortcut) || '').trim());
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

  useEffect(() => {
    if (selectedCustomClass) {
      setInstructionsText(selectedCustomClass.instructions || '');
      setEditingInstructions(false);
    }
  }, [selectedCustomClass?.id]);

  const previewAgentClass = useMemo((): BuiltInAgentClass => {
    const customClass = customClasses.find(c => c.id === selectedClass);
    if (customClass) {
      return 'scout';
    }
    return selectedClass as BuiltInAgentClass;
  }, [customClasses, selectedClass]);

  // Check if there are any changes
  const hasChanges = useMemo(() => {
    const trimmedName = agentName.trim();
    if (trimmedName && trimmedName !== agent.name) return true;
    if (selectedClass !== agent.class) return true;
    if (permissionMode !== agent.permissionMode) return true;
    if (selectedProvider !== (agent.provider || 'claude')) return true;
    if (selectedProvider === 'claude' && selectedModel !== (agent.model || 'sonnet')) return true;
    if (selectedProvider === 'claude' && selectedEffort !== (agent.effort || undefined)) return true;
    if (selectedProvider === 'codex' && selectedCodexModel !== (agent.codexModel || 'gpt-5.3-codex')) return true;
    if (selectedProvider === 'codex' && JSON.stringify(codexConfig || {}) !== JSON.stringify(agent.codexConfig || {})) return true;
    if (selectedProvider === 'opencode' && opencodeModel !== ((agent as any).opencodeModel || 'minimax/MiniMax-M1-80k')) return true;
    if (useChrome !== (agent.useChrome || false)) return true;
    if (workdir !== agent.cwd) return true;
    if (shortcut !== (((agent as AgentWithShortcut).shortcut || '').trim())) return true;

    // Check skill changes
    const currentDirectSkills = allSkills
      .filter(s => s.assignedAgentIds.includes(agent.id))
      .map(s => s.id)
      .sort()
      .join(',');
    const newSkills = Array.from(selectedSkillIds).sort().join(',');
    if (currentDirectSkills !== newSkills) return true;

    return false;
  }, [agentName, selectedClass, permissionMode, selectedProvider, selectedModel, selectedEffort, selectedCodexModel, codexConfig, opencodeModel, useChrome, workdir, shortcut, selectedSkillIds, agent, allSkills]);

  // Handle save
  const handleSave = () => {
    const trimmedName = agentName.trim();
    const updates: {
      class?: AgentClass;
      permissionMode?: PermissionMode;
      provider?: AgentProvider;
      codexConfig?: CodexConfig;
      codexModel?: CodexModel;
      opencodeModel?: string;
      model?: ClaudeModel;
      effort?: ClaudeEffort;
      useChrome?: boolean;
      skillIds?: string[];
      cwd?: string;
      shortcut?: string;
    } = {};

    if (trimmedName && trimmedName !== agent.name) {
      store.renameAgent(agent.id, trimmedName);
    }

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

    if (selectedProvider === 'opencode' && opencodeModel !== ((agent as any).opencodeModel || 'minimax/MiniMax-M1-80k')) {
      updates.opencodeModel = opencodeModel;
    }

    if (selectedProvider === 'claude' && selectedModel !== (agent.model || 'sonnet')) {
      updates.model = selectedModel;
    }

    if (selectedProvider === 'claude' && selectedEffort !== (agent.effort || undefined)) {
      updates.effort = selectedEffort;
    }

    if (useChrome !== (agent.useChrome || false)) {
      updates.useChrome = useChrome;
    }

    if (workdir !== agent.cwd) {
      updates.cwd = workdir;
    }

    if (shortcut !== (((agent as AgentWithShortcut).shortcut || '').trim())) {
      updates.shortcut = shortcut;
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

  const shortcutConfig = useMemo<ShortcutConfig>(() => {
    const parsed = parseShortcutString(shortcut);
    return {
      id: `agent-terminal-shortcut-${agent.id}`,
      name: 'Terminal Shortcut',
      description: 'Open terminal for this agent',
      key: parsed?.key || '',
      modifiers: parsed?.modifiers || {},
      enabled: true,
      context: 'global',
    };
  }, [agent.id, shortcut]);

  if (!isOpen) return null;

  return (
    <div className="modal-overlay visible" onMouseDown={handleBackdropMouseDown} onClick={handleBackdropClick}>
      <div className="modal agent-edit-modal">
        <div className="modal-header">
          {t('terminal:spawn.editAgentTitle')}: {agentName.trim() || agent.name}
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
              <div className="spawn-class-label">{t('terminal:spawn.agentClass')}</div>
              <div className="class-selector-inline">
                {customClasses.map((customClass) => (
                  <button
                    key={customClass.id}
                    className={`class-chip ${selectedClass === customClass.id ? 'selected' : ''}`}
                    onClick={() => setSelectedClass(customClass.id)}
                    title={customClass.description}
                  >
                    <AgentIcon classId={customClass.id} size={18} className="class-chip-icon" />
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
                      <AgentIcon classId={key} size={18} className="class-chip-icon" />
                      <span className="class-chip-name">{key.charAt(0).toUpperCase() + key.slice(1)}</span>
                    </button>
                  ))}
              </div>
            </div>
          </div>

          {/* Custom Class Instructions */}
          {selectedCustomClass && (
            <div className="custom-class-notice">
              <div className="custom-class-notice-header" onClick={() => setEditingInstructions(!editingInstructions)} style={{ cursor: 'pointer' }}>
                <span>📋</span>
                <span>{selectedCustomClass.instructions ? t('terminal:spawn.hasCustomInstructions') : 'Add custom instructions'}</span>
                <span style={{ marginLeft: 'auto', fontSize: 11, opacity: 0.6 }}>{editingInstructions ? '▲' : '▼'}</span>
              </div>
              {!editingInstructions && selectedCustomClass.instructions && (
                <div className="custom-class-notice-info">
                  {t('terminal:spawn.instructionsInjected', { count: selectedCustomClass.instructions.length })}
                </div>
              )}
              {editingInstructions && (
                <div className="custom-class-instructions-editor">
                  <textarea
                    value={instructionsText}
                    onChange={(e) => setInstructionsText(e.target.value)}
                    placeholder="CLAUDE.md instructions for this agent class..."
                    rows={6}
                    style={{ width: '100%', resize: 'vertical', fontFamily: 'monospace', fontSize: 12, background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 4, color: 'var(--text-primary)', padding: '6px 8px', outline: 'none' }}
                  />
                  <div style={{ display: 'flex', gap: 6, marginTop: 4, justifyContent: 'flex-end' }}>
                    <button
                      onClick={() => {
                        store.updateCustomAgentClass(selectedCustomClass.id, { instructions: instructionsText });
                        setEditingInstructions(false);
                      }}
                      style={{ padding: '2px 10px', borderRadius: 4, fontSize: 11, cursor: 'pointer', background: 'rgba(0,200,200,0.2)', color: 'var(--accent-cyan)', border: '1px solid rgba(0,200,200,0.3)' }}
                    >
                      Save
                    </button>
                    <button
                      onClick={() => {
                        setInstructionsText(selectedCustomClass.instructions || '');
                        setEditingInstructions(false);
                      }}
                      style={{ padding: '2px 10px', borderRadius: 4, fontSize: 11, cursor: 'pointer', background: 'transparent', color: 'var(--text-secondary)', border: '1px solid rgba(255,255,255,0.1)' }}
                    >
                      Cancel
                    </button>
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 4 }}>
                    These instructions are injected as system prompt for all agents of this class.
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Form Fields */}
          <div className="spawn-form-section">
            {/* Row 1: Runtime + Permission */}
            <div className="spawn-form-row">
              <div className="spawn-field">
                <label className="spawn-label">{t('common:labels.name')}</label>
                <input
                  type="text"
                  className="spawn-input"
                  value={agentName}
                  onChange={(e) => setAgentName(e.target.value)}
                  placeholder={t('terminal:spawn.agentNamePlaceholder')}
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
                  <button
                    className={`spawn-select-btn spawn-select-btn--opencode ${selectedProvider === 'opencode' ? 'selected' : ''}`}
                    onClick={() => setSelectedProvider('opencode')}
                  >
                    <span>🟢</span>
                    <span>OpenCode</span>
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

            {/* Row 3: Model + Effort */}
            <div className="spawn-form-row">
              <div className="spawn-field">
                <label className="spawn-label">{t('common:labels.model')}</label>
                {selectedProvider === 'claude' ? (
                  <div className="spawn-select-row">
                    {(Object.keys(CLAUDE_MODELS) as ClaudeModel[])
                      // Hide deprecated models in the edit picker unless the
                      // agent is already using one (so users can still see the
                      // current value and optionally migrate to a newer one).
                      .filter((model) => !CLAUDE_MODELS[model].deprecated || selectedModel === model)
                      .map((model) => (
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
                ) : selectedProvider === 'opencode' ? (
                  <input
                    type="text"
                    className="spawn-input"
                    value={opencodeModel}
                    onChange={(e) => setOpencodeModel(e.target.value)}
                    placeholder="provider/model (e.g., minimax/MiniMax-M1-80k)"
                  />
                ) : (
                  <div className="spawn-inline-hint">{t('terminal:spawn.codex.configuration')}</div>
                )}
              </div>
              {selectedProvider === 'claude' && (
                <div className="spawn-field">
                  <label className="spawn-label">Effort</label>
                  <div className="spawn-select-row spawn-select-row--effort">
                    <button
                      className={`spawn-select-btn spawn-select-btn--compact ${selectedEffort === undefined ? 'selected' : ''}`}
                      onClick={() => setSelectedEffort(undefined)}
                      title="Use default effort level"
                    >
                      <span>Default</span>
                    </button>
                    {(Object.keys(CLAUDE_EFFORTS) as ClaudeEffort[]).map((level) => (
                      <button
                        key={level}
                        className={`spawn-select-btn spawn-select-btn--compact ${selectedEffort === level ? 'selected' : ''}`}
                        onClick={() => setSelectedEffort(level)}
                        title={CLAUDE_EFFORTS[level].description}
                      >
                        <span>{CLAUDE_EFFORTS[level].label}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
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

            {/* Model/effort change notice */}
            {selectedProvider === 'claude' && (selectedModel !== (agent.model || 'sonnet') || selectedEffort !== (agent.effort || undefined)) && (
              <div className="model-change-notice">
                {t('terminal:spawn.contextPreserved')}
              </div>
            )}

            {/* Row 4: Chrome toggle */}
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

            {/* Row 5: Working Directory */}
            <div className="spawn-form-row">
              <div className="spawn-field">
                <label className="spawn-label">{t('terminal:spawn.workingDir')}</label>
                <FolderInput
                  value={workdir}
                  onChange={setWorkdir}
                  placeholder={t('terminal:spawn.workingDirPlaceholder')}
                  className="spawn-input"
                  directoriesOnly={true}
                />
              </div>
            </div>

            <div className="spawn-form-row">
              <div className="spawn-field">
                <label className="spawn-label">Terminal Shortcut</label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <KeyCaptureInput
                    shortcut={shortcutConfig}
                    onUpdate={(updates) => setShortcut(shortcutValueToString(updates))}
                  />
                  <div className="spawn-inline-hint">
                    {shortcut ? `Opens this agent terminal with ${formatShortcutString(shortcut)}` : 'Capture a global shortcut for this agent terminal'}
                  </div>
                </div>
              </div>
            </div>

            {/* Workdir change notice */}
            {workdir !== agent.cwd && (
              <div className="model-change-notice warning">
                {t('terminal:spawn.newSessionWarning')}
              </div>
            )}

            {/* Skills section */}
            <div className="spawn-skills-section">
              <label className="spawn-label">
                {t('terminal:spawn.skills')} <span className="spawn-label-hint">({t('terminal:spawn.clickToToggle')})</span>
              </label>
              {availableSkills.length > 6 && (
                <input
                  type="text"
                  className="spawn-input skill-search-input"
                  placeholder={t('terminal:spawn.filterSkills')}
                  value={skillSearch}
                  onChange={(e) => setSkillSearch(e.target.value)}
                />
              )}
              <div className="skills-chips-compact">
                {availableSkills.length === 0 ? (
                  <div className="skills-empty">{t('terminal:spawn.noEnabledSkills')}</div>
                ) : filteredSkills.length === 0 ? (
                  <div className="skills-empty">{t('terminal:spawn.noSkillsMatch', { query: skillSearch })}</div>
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
                        title={isClassBased ? t('terminal:spawn.assignedViaClass') : skill.name}
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
            {t('common:buttons.cancel')}
          </button>
          <button
            className="btn btn-primary"
            onClick={handleSave}
            disabled={!hasChanges}
          >
            {t('common:buttons2.saveChanges')}
          </button>
        </div>
      </div>
    </div>
  );
}
