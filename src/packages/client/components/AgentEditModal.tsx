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
import { OpencodeModelSelect } from './OpencodeModelSelect';
import { PiModelSelect } from './PiModelSelect';
import type { Agent, AgentClass, PermissionMode, BuiltInAgentClass, ClaudeModel, ClaudeEffort, CodexModel, AgentProvider, CodexConfig, CodexReasoningEffort } from '../../shared/types';
import { CODEX_REASONING_EFFORTS } from '../../shared/types';
import { BUILT_IN_AGENT_CLASSES, PERMISSION_MODES, CLAUDE_MODELS, CLAUDE_EFFORTS, CODEX_MODELS, GROK_MODELS, DEFAULT_GROK_MODEL, grokSupportsEffort } from '../../shared/types';
import { ShortcutConfig, formatShortcutString, parseShortcutString, shortcutValueToString } from '../store/shortcuts';
import { apiUrl } from '../utils/storage';
import { useModalClose } from '../hooks';
import { AgentIcon } from './AgentIcon';
import { Icon } from './Icon';

interface AgentEditModalProps {
  agent: Agent;
  isOpen: boolean;
  onClose: () => void;
}

type AgentWithShortcut = Agent & { shortcut?: string };

const DEFAULT_CODEX_MODEL: CodexModel = 'gpt-5.6-luna';

function getSelectableCodexModel(model: Agent['codexModel']): CodexModel {
  return model && Object.prototype.hasOwnProperty.call(CODEX_MODELS, model)
    ? model
    : DEFAULT_CODEX_MODEL;
}

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
  const [selectedCodexModel, setSelectedCodexModel] = useState<CodexModel>(getSelectableCodexModel(agent.codexModel));
  const [opencodeModel, setOpencodeModel] = useState<string>((agent as any).opencodeModel || 'minimax/MiniMax-M1-80k');
  const [grokModel, setGrokModel] = useState<string>((agent as any).grokModel || DEFAULT_GROK_MODEL);
  const [piModel, setPiModel] = useState<string>((agent as any).piModel || '');
  const [useChrome, setUseChrome] = useState<boolean>(agent.useChrome || false);
  const [workdir, setWorkdir] = useState<string>(agent.cwd);
  const [shortcut, setShortcut] = useState<string>(((agent as AgentWithShortcut).shortcut || '').trim());
  const [selectedSkillIds, setSelectedSkillIds] = useState<Set<string>>(new Set());
  const [classSearch, setClassSearch] = useState('');
  const [skillSearch, setSkillSearch] = useState('');
  const [customInstructions, setCustomInstructions] = useState<string>(agent.customInstructions || '');
  const [editingInstructions, setEditingInstructions] = useState(false);
  const [instructionsText, setInstructionsText] = useState('');
  const browserTz = useMemo(() => {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; }
  }, []);
  const [soundsMuted, setSoundsMuted] = useState<boolean>(agent.soundsMuted || false);
  const [autoCollapse, setAutoCollapse] = useState<boolean>(agent.autoCollapse || false);
  const [autoCollapseCron, setAutoCollapseCron] = useState<string>(agent.autoCollapseCron || '');
  const [autoCollapseTz, setAutoCollapseTz] = useState<string>(agent.autoCollapseTz || '');
  const [autoCollapsePrompt, setAutoCollapsePrompt] = useState<string>(agent.autoCollapsePrompt || '');

  // Filter classes by search query
  const filteredCustomClasses = useMemo(() => {
    if (!classSearch.trim()) return customClasses;
    const query = classSearch.toLowerCase();
    return customClasses.filter(c =>
      c.name.toLowerCase().includes(query) ||
      c.id.toLowerCase().includes(query)
    );
  }, [customClasses, classSearch]);

  const filteredBuiltInClasses = useMemo(() => {
    const entries = Object.entries(BUILT_IN_AGENT_CLASSES).filter(([key]) => key !== 'boss');
    if (!classSearch.trim()) return entries;
    const query = classSearch.toLowerCase();
    return entries.filter(([key]) => key.toLowerCase().includes(query));
  }, [classSearch]);

  // Get skills currently assigned to this agent (directly, via class, or via '*' wildcard)
  const _currentAgentSkills = useMemo(() => {
    return allSkills.filter(s =>
      s.enabled && (
        s.assignedAgentIds.includes(agent.id) ||
        s.assignedAgentClasses.includes('*') ||
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
      setSelectedCodexModel(getSelectableCodexModel(agent.codexModel));
      setOpencodeModel((agent as any).opencodeModel || 'minimax/MiniMax-M1-80k');
      setGrokModel((agent as any).grokModel || DEFAULT_GROK_MODEL);
      setPiModel((agent as any).piModel || '');
      setUseChrome(agent.useChrome || false);
      setWorkdir(agent.cwd);
      setShortcut((((agent as AgentWithShortcut).shortcut) || '').trim());
      setClassSearch('');
      setCustomInstructions(agent.customInstructions || '');
      setSoundsMuted(agent.soundsMuted || false);
      setAutoCollapse(agent.autoCollapse || false);
      setAutoCollapseCron(agent.autoCollapseCron || '');
      setAutoCollapseTz(agent.autoCollapseTz || '');
      setAutoCollapsePrompt(agent.autoCollapsePrompt || '');
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

  // Get skills that come from class assignment (or the '*' wildcard).
  // Both kinds are framework/class-level and not editable per-agent.
  const classBasedSkills = useMemo(() => {
    return availableSkills.filter(s =>
      s.assignedAgentClasses.includes('*') ||
      s.assignedAgentClasses.includes(selectedClass)
    );
  }, [availableSkills, selectedClass]);

  // Subset of classBasedSkills that are wildcard-assigned (apply to every agent).
  const wildcardSkills = useMemo(() => {
    return availableSkills.filter(s => s.assignedAgentClasses.includes('*'));
  }, [availableSkills]);

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
    if ((selectedProvider === 'claude' || selectedProvider === 'grok') && selectedEffort !== (agent.effort || undefined)) return true;
    if (selectedProvider === 'codex' && selectedCodexModel !== getSelectableCodexModel(agent.codexModel)) return true;
    if (selectedProvider === 'codex' && JSON.stringify(codexConfig || {}) !== JSON.stringify(agent.codexConfig || {})) return true;
    if (selectedProvider === 'opencode' && opencodeModel !== ((agent as any).opencodeModel || 'minimax/MiniMax-M1-80k')) return true;
    if (selectedProvider === 'grok' && grokModel !== ((agent as any).grokModel || DEFAULT_GROK_MODEL)) return true;
    if (selectedProvider === 'pi' && piModel !== ((agent as any).piModel || '')) return true;
    if (useChrome !== (agent.useChrome || false)) return true;
    if (workdir !== agent.cwd) return true;
    if (shortcut !== (((agent as AgentWithShortcut).shortcut || '').trim())) return true;
    if (customInstructions !== (agent.customInstructions || '')) return true;
    if (soundsMuted !== (agent.soundsMuted || false)) return true;
    if (autoCollapse !== (agent.autoCollapse || false)) return true;
    if (autoCollapseCron !== (agent.autoCollapseCron || '')) return true;
    if (autoCollapseTz !== (agent.autoCollapseTz || '')) return true;
    if (autoCollapsePrompt !== (agent.autoCollapsePrompt || '')) return true;

    // Check skill changes
    const currentDirectSkills = allSkills
      .filter(s => s.assignedAgentIds.includes(agent.id))
      .map(s => s.id)
      .sort()
      .join(',');
    const newSkills = Array.from(selectedSkillIds).sort().join(',');
    if (currentDirectSkills !== newSkills) return true;

    return false;
  }, [agentName, selectedClass, permissionMode, selectedProvider, selectedModel, selectedEffort, selectedCodexModel, codexConfig, opencodeModel, grokModel, piModel, useChrome, workdir, shortcut, customInstructions, soundsMuted, autoCollapse, autoCollapseCron, autoCollapseTz, autoCollapsePrompt, selectedSkillIds, agent, allSkills]);

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
      grokModel?: string;
      piModel?: string;
      model?: ClaudeModel;
      effort?: ClaudeEffort;
      useChrome?: boolean;
      skillIds?: string[];
      cwd?: string;
      shortcut?: string;
      customInstructions?: string;
      soundsMuted?: boolean;
      autoCollapse?: boolean;
      autoCollapseCron?: string;
      autoCollapseTz?: string;
      autoCollapsePrompt?: string;
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

    if (selectedProvider === 'codex' && selectedCodexModel !== getSelectableCodexModel(agent.codexModel)) {
      updates.codexModel = selectedCodexModel;
    }

    if (selectedProvider === 'opencode' && opencodeModel !== ((agent as any).opencodeModel || 'minimax/MiniMax-M1-80k')) {
      updates.opencodeModel = opencodeModel;
    }

    if (selectedProvider === 'grok' && grokModel !== ((agent as any).grokModel || DEFAULT_GROK_MODEL)) {
      updates.grokModel = grokModel;
    }
    if (selectedProvider === 'pi' && piModel !== ((agent as any).piModel || '')) {
      updates.piModel = piModel;
    }

    if (selectedProvider === 'claude' && selectedModel !== (agent.model || 'sonnet')) {
      updates.model = selectedModel;
    }

    if ((selectedProvider === 'claude' || selectedProvider === 'grok') && selectedEffort !== (agent.effort || undefined)) {
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

    if (customInstructions !== (agent.customInstructions || '')) {
      updates.customInstructions = customInstructions;
    }

    if (soundsMuted !== (agent.soundsMuted || false)) {
      updates.soundsMuted = soundsMuted;
    }

    if (autoCollapse !== (agent.autoCollapse || false)) {
      updates.autoCollapse = autoCollapse;
    }

    if (autoCollapseCron !== (agent.autoCollapseCron || '')) {
      updates.autoCollapseCron = autoCollapseCron.trim();
    }

    // Persist the timezone (defaulting to the browser's) whenever auto-collapse is on,
    // so the server-side cron resolves against a concrete zone instead of guessing.
    const effectiveTz = autoCollapseTz.trim() || browserTz;
    if (autoCollapse && effectiveTz !== (agent.autoCollapseTz || '')) {
      updates.autoCollapseTz = effectiveTz;
    } else if (autoCollapseTz !== (agent.autoCollapseTz || '')) {
      updates.autoCollapseTz = autoCollapseTz.trim();
    }

    if (autoCollapsePrompt !== (agent.autoCollapsePrompt || '')) {
      updates.autoCollapsePrompt = autoCollapsePrompt.trim();
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
          {/* Identity: Preview + Class + Name */}
          <div className="spawn-section">
            <div className="spawn-section-header">
              <h4 className="spawn-section-title">{t('terminal:spawn.agentClass')}</h4>
              <span className="spawn-section-hint">{selectedCustomClass?.name || selectedClass}</span>
            </div>
            <div className="spawn-top-section">
              <div className="spawn-preview-compact">
                <ModelPreview
                  agentClass={previewAgentClass}
                  modelFile={previewModelFile}
                  customModelUrl={previewCustomModelUrl}
                  modelScale={previewModelScale}
                  width={110}
                  height={130}
                />
                <div className="spawn-preview-label">{selectedCustomClass?.name || selectedClass}</div>
              </div>
              <div className="spawn-class-section">
                <input
                  type="text"
                  className="spawn-input class-search-input"
                  placeholder="Filter classes..."
                  value={classSearch}
                  onChange={(e) => setClassSearch(e.target.value)}
                />
                <div className="class-selector-inline">
                  {filteredCustomClasses.map((customClass) => (
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
                  {filteredBuiltInClasses.map(([key, config]) => (
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
                  {filteredCustomClasses.length === 0 && filteredBuiltInClasses.length === 0 && (
                    <div className="class-search-empty">No classes match "{classSearch}"</div>
                  )}
                </div>
              </div>
            </div>

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
              <div className="spawn-field spawn-field-wide">
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

            {workdir !== agent.cwd && (
              <div className="model-change-notice warning">
                {t('terminal:spawn.newSessionWarning')}
              </div>
            )}

            {selectedCustomClass && (
              <div className="custom-class-notice">
                <div className="custom-class-notice-header" onClick={() => setEditingInstructions(!editingInstructions)} style={{ cursor: 'pointer' }}>
                  <span><Icon name="task" size={14} /></span>
                  <span>{selectedCustomClass.instructions ? t('terminal:spawn.hasCustomInstructions') : 'Add custom instructions'}</span>
                  <span style={{ marginLeft: 'auto', fontSize: 11, opacity: 0.6 }}><Icon name={editingInstructions ? 'caret-up' : 'caret-down'} size={11} /></span>
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
          </div>

          {/* Runtime / Model / Permissions */}
          <div className="spawn-section">
            <div className="spawn-section-header">
              <h4 className="spawn-section-title">{t('common:labels.runtime')}</h4>
            </div>

            <div className="spawn-form-row">
              <div className="spawn-field">
                <label className="spawn-label">{t('common:labels.runtime')}</label>
                <div className="spawn-select-row">
                  <button
                    className={`spawn-select-btn ${selectedProvider === 'claude' ? 'selected' : ''}`}
                    onClick={() => setSelectedProvider('claude')}
                  >
                    <span><Icon name="brain" size={14} /></span>
                    <span>Claude</span>
                  </button>
                  <button
                    className={`spawn-select-btn ${selectedProvider === 'codex' ? 'selected' : ''}`}
                    onClick={() => setSelectedProvider('codex')}
                  >
                    <span><Icon name="gear" size={14} /></span>
                    <span>Codex</span>
                  </button>
                  <button
                    className={`spawn-select-btn spawn-select-btn--opencode ${selectedProvider === 'opencode' ? 'selected' : ''}`}
                    onClick={() => setSelectedProvider('opencode')}
                  >
                    <img src={`${import.meta.env.BASE_URL}assets/opencode.svg`} alt="OpenCode" className="spawn-provider-icon" />
                    <span>OpenCode</span>
                  </button>
                  <button
                    className={`spawn-select-btn spawn-select-btn--grok ${selectedProvider === 'grok' ? 'selected' : ''}`}
                    onClick={() => setSelectedProvider('grok')}
                  >
                    <img src={`${import.meta.env.BASE_URL}assets/grok.png`} alt="Grok" className="spawn-provider-icon" />
                    <span>Grok</span>
                  </button>
                  <button
                    className={`spawn-select-btn spawn-select-btn--pi ${selectedProvider === 'pi' ? 'selected' : ''}`}
                    onClick={() => setSelectedProvider('pi')}
                  >
                    <img src={`${import.meta.env.BASE_URL}assets/pi.svg`} alt="Pi" className="spawn-provider-icon" />
                    <span>Pi</span>
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
                      <span><Icon name={mode === 'bypass' ? 'bolt' : 'lock'} size={14} /></span>
                      <span>{PERMISSION_MODES[mode].label}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="spawn-form-row">
              <div className="spawn-field">
                <label className="spawn-label">{t('common:labels.model')}</label>
                {selectedProvider === 'claude' ? (
                  <div className="spawn-select-row spawn-select-row--wrap">
                    {(Object.keys(CLAUDE_MODELS) as ClaudeModel[])
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
                  <OpencodeModelSelect
                    value={opencodeModel}
                    onChange={setOpencodeModel}
                    inputId="edit-opencode-model"
                  />
                ) : selectedProvider === 'grok' ? (
                  <div className="spawn-select-row spawn-select-row--wrap">
                    {Object.keys(GROK_MODELS).map((model) => (
                      <button
                        key={model}
                        className={`spawn-select-btn ${grokModel === model ? 'selected' : ''}`}
                        onClick={() => setGrokModel(model)}
                        title={GROK_MODELS[model].description}
                      >
                        <span>{GROK_MODELS[model].icon}</span>
                        <span>{GROK_MODELS[model].label}</span>
                      </button>
                    ))}
                  </div>
                ) : selectedProvider === 'pi' ? (
                  <PiModelSelect
                    value={piModel}
                    onChange={setPiModel}
                    inputId="edit-pi-model"
                  />
                ) : (
                  <div className="spawn-inline-hint">{t('terminal:spawn.codex.configuration')}</div>
                )}
              </div>
            </div>

            <div className="spawn-form-row">
              {(selectedProvider === 'claude' || selectedProvider === 'grok' || selectedProvider === 'pi') && (
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
                    {(Object.keys(CLAUDE_EFFORTS) as ClaudeEffort[])
                      // Grok tiers vary per model (4.5 has no xhigh, none have max).
                      // An already-selected level stays visible so it can be changed.
                      .filter((level) => selectedProvider !== 'grok'
                        || grokSupportsEffort(grokModel, level)
                        || selectedEffort === level)
                      .map((level) => (
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
              <div className="spawn-field">
                <label className="spawn-label">{t('terminal:spawn.browser')}</label>
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

            {selectedProvider === 'claude' && (selectedModel !== (agent.model || 'sonnet') || selectedEffort !== (agent.effort || undefined)) && (
              <div className="model-change-notice">
                {t('terminal:spawn.contextPreserved')}
              </div>
            )}

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
                    <select
                      className="spawn-input"
                      value={codexConfig.reasoningEffort || ''}
                      onChange={(e) => setCodexConfig((prev) => ({ ...prev, reasoningEffort: (e.target.value || undefined) as CodexReasoningEffort | undefined }))}
                    >
                      <option value="">{t('terminal:spawn.codex.reasoningEffortDefault')}</option>
                      {(Object.keys(CODEX_REASONING_EFFORTS) as CodexReasoningEffort[]).map((level) => (
                        <option key={level} value={level}>
                          {CODEX_REASONING_EFFORTS[level].icon} {t('terminal:spawn.codex.reasoningEffort')}: {CODEX_REASONING_EFFORTS[level].label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Skills */}
          <div className="spawn-section spawn-skills-section">
            <div className="spawn-section-header">
              <h4 className="spawn-section-title">{t('terminal:spawn.skills')}</h4>
              <span className="spawn-section-hint">{t('terminal:spawn.clickToToggle')}</span>
            </div>
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
                  const isWildcard = wildcardSkills.includes(skill);
                  const isClassBased = classBasedSkills.includes(skill);
                  const isDirectlyAssigned = selectedSkillIds.has(skill.id);
                  const isActive = isDirectlyAssigned || isClassBased;
                  const isReadOnly = isClassBased;

                  return (
                    <button
                      key={skill.id}
                      className={`skill-chip ${isActive ? 'selected' : ''} ${isReadOnly ? 'class-based' : ''}`}
                      onClick={() => !isReadOnly && toggleSkill(skill.id)}
                      title={
                        isWildcard
                          ? 'Applied to all agents (assigned via "*" wildcard — not editable per-agent)'
                          : isClassBased
                          ? t('terminal:spawn.assignedViaClass')
                          : skill.name
                      }
                    >
                      {isActive && <span className="skill-check"><Icon name="check" size={12} /></span>}
                      <span className="skill-chip-name">{skill.name}</span>
                      {skill.builtin && <span className="skill-chip-badge builtin">TC</span>}
                      {isWildcard ? (
                        <span className="skill-chip-badge">all</span>
                      ) : isClassBased ? (
                        <span className="skill-chip-badge">class</span>
                      ) : null}
                    </button>
                  );
                })
              )}
            </div>
          </div>

          {/* Advanced: instructions, shortcut, auto-collapse */}
          <details className="spawn-advanced">
            <summary>Advanced options</summary>
            <div className="spawn-advanced-body">
              <div className="spawn-form-row">
                <div className="spawn-field">
                  <label className="spawn-label">Custom Instructions</label>
                  <textarea
                    className="spawn-input spawn-textarea"
                    value={customInstructions}
                    onChange={(e) => setCustomInstructions(e.target.value)}
                    placeholder="Additional instructions appended to this agent's system prompt..."
                    rows={5}
                    style={{ resize: 'vertical', fontFamily: 'monospace', fontSize: 12 }}
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

              <div className="spawn-form-row spawn-options-row">
                <label className="spawn-checkbox">
                  <input
                    type="checkbox"
                    checked={soundsMuted}
                    onChange={(e) => setSoundsMuted(e.target.checked)}
                  />
                  <span>Mute sounds from this agent</span>
                </label>
              </div>
              <div className="spawn-inline-hint" style={{ marginTop: -4 }}>
                {soundsMuted
                  ? 'Audio only: no chime, completion cue or repeating question alert. Notifications still appear on screen.'
                  : 'Silence a chatty agent without hiding it — its notifications keep showing, just without sound.'}
              </div>

              <div className="spawn-form-row spawn-options-row">
                <label className="spawn-checkbox">
                  <input
                    type="checkbox"
                    checked={autoCollapse}
                    onChange={(e) => setAutoCollapse(e.target.checked)}
                  />
                  <span>Auto-collapse context on a schedule</span>
                </label>
              </div>
              {autoCollapse && (
                <div className="spawn-form-row">
                  <div className="spawn-field">
                    <label className="spawn-label">Collapse schedule (cron)</label>
                    <input
                      type="text"
                      className="spawn-input"
                      value={autoCollapseCron}
                      onChange={(e) => setAutoCollapseCron(e.target.value)}
                      placeholder="0 3 * * *  (every day at 3:00 AM)"
                      style={{ fontFamily: 'monospace' }}
                    />
                    <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
                      {[
                        { label: 'Nightly 3am', cron: '0 3 * * *' },
                        { label: 'Every 6h', cron: '0 */6 * * *' },
                        { label: 'Weekdays 2am', cron: '0 2 * * MON-FRI' },
                      ].map(p => (
                        <button
                          key={p.cron}
                          type="button"
                          className="spawn-preset-chip"
                          onClick={() => setAutoCollapseCron(p.cron)}
                          style={{
                            fontSize: 11, padding: '3px 8px', borderRadius: 4,
                            border: '1px solid var(--border-color, #444)', cursor: 'pointer',
                            background: autoCollapseCron === p.cron ? 'var(--accent-color, #4a9eff)' : 'transparent',
                            color: 'inherit',
                          }}
                        >
                          {p.label}
                        </button>
                      ))}
                    </div>
                    <div className="spawn-inline-hint">
                      5-field cron (minute hour day month weekday). Collapse waits for the agent to be idle before running.
                    </div>
                    <label className="spawn-label" style={{ marginTop: 10 }}>Timezone</label>
                    <input
                      type="text"
                      className="spawn-input"
                      value={autoCollapseTz}
                      onChange={(e) => setAutoCollapseTz(e.target.value)}
                      placeholder={browserTz}
                      style={{ fontFamily: 'monospace' }}
                    />
                    <div className="spawn-inline-hint">
                      IANA timezone. Leave blank to use this browser's zone ({browserTz}).
                    </div>
                    <label className="spawn-label" style={{ marginTop: 10 }}>Post-collapse prompt (optional)</label>
                    <textarea
                      className="spawn-input"
                      value={autoCollapsePrompt}
                      onChange={(e) => setAutoCollapsePrompt(e.target.value)}
                      placeholder="Prompt sent to the agent after each scheduled collapse completes..."
                      rows={3}
                      style={{ resize: 'vertical', fontFamily: 'monospace', fontSize: 12 }}
                    />
                    <div className="spawn-inline-hint">
                      Sent as a new task once the /compact finishes — use it to re-seed instructions after the context is wiped.
                    </div>
                  </div>
                </div>
              )}
            </div>
          </details>
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
