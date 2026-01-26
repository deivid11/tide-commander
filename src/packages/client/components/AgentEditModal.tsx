/**
 * Agent Edit Modal
 * Modal for editing agent properties: class, permission mode, and skills
 */

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { store, useSkillsArray, useCustomAgentClassesArray } from '../store';
import { ModelPreview } from './ModelPreview';
import { ALL_CHARACTER_MODELS, CHARACTER_MODELS } from '../scene/config';
import type { Agent, AgentClass, PermissionMode, Skill, BuiltInAgentClass, ClaudeModel } from '../../shared/types';
import { BUILT_IN_AGENT_CLASSES, PERMISSION_MODES, CLAUDE_MODELS } from '../../shared/types';
import { apiUrl } from '../utils/storage';

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
  const [selectedModel, setSelectedModel] = useState<ClaudeModel>(agent.model || 'sonnet');
  const [useChrome, setUseChrome] = useState<boolean>(agent.useChrome || false);
  const [workdir, setWorkdir] = useState<string>(agent.cwd);
  const [selectedSkillIds, setSelectedSkillIds] = useState<Set<string>>(new Set());

  // Get skills currently assigned to this agent
  const currentAgentSkills = useMemo(() => {
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
      setSelectedModel(agent.model || 'sonnet');
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
    if (selectedModel !== (agent.model || 'sonnet')) return true;
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
  }, [selectedClass, permissionMode, selectedModel, useChrome, workdir, selectedSkillIds, agent, allSkills]);

  // Handle save
  const handleSave = () => {
    const updates: {
      class?: AgentClass;
      permissionMode?: PermissionMode;
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

    if (selectedModel !== (agent.model || 'sonnet')) {
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

  if (!isOpen) return null;

  return (
    <div className="modal-overlay visible" onClick={onClose}>
      <div className="modal agent-edit-modal" onClick={(e) => e.stopPropagation()}>
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
            {/* Row 1: Model + Permission */}
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

            {/* Model change notice */}
            {selectedModel !== (agent.model || 'sonnet') && (
              <div className="model-change-notice">
                Context preserved - will resume with new model
              </div>
            )}

            {/* Row 2: Chrome toggle */}
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

            {/* Row 3: Working Directory */}
            <div className="spawn-form-row">
              <div className="spawn-field">
                <label className="spawn-label">Working Directory</label>
                <input
                  type="text"
                  className="spawn-input"
                  value={workdir}
                  onChange={(e) => setWorkdir(e.target.value)}
                  placeholder="/path/to/directory"
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
              <div className="skills-chips-compact">
                {availableSkills.length === 0 ? (
                  <div className="skills-empty">No enabled skills available</div>
                ) : (
                  availableSkills.map(skill => {
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
