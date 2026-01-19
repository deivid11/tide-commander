/**
 * Agent Edit Modal
 * Modal for editing agent properties: class, permission mode, and skills
 */

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { store, useSkillsArray, useCustomAgentClassesArray } from '../store';
import { ModelPreview } from './ModelPreview';
import { ALL_CHARACTER_MODELS, CHARACTER_MODELS } from '../scene/config';
import type { Agent, AgentClass, PermissionMode, Skill, BuiltInAgentClass } from '../../shared/types';
import { BUILT_IN_AGENT_CLASSES, PERMISSION_MODES } from '../../shared/types';

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

    // Check skill changes
    const currentDirectSkills = allSkills
      .filter(s => s.assignedAgentIds.includes(agent.id))
      .map(s => s.id)
      .sort()
      .join(',');
    const newSkills = Array.from(selectedSkillIds).sort().join(',');
    if (currentDirectSkills !== newSkills) return true;

    return false;
  }, [selectedClass, permissionMode, selectedSkillIds, agent, allSkills]);

  // Handle save
  const handleSave = () => {
    const updates: {
      class?: AgentClass;
      permissionMode?: PermissionMode;
      skillIds?: string[];
    } = {};

    if (selectedClass !== agent.class) {
      updates.class = selectedClass;
    }

    if (permissionMode !== agent.permissionMode) {
      updates.permissionMode = permissionMode;
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

        <div className="modal-body" style={{ padding: '16px' }}>
          {/* Class Selection */}
          <div className="form-section" style={{ marginBottom: '16px' }}>
            <label className="form-label">Agent Class</label>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '16px',
            }}>
              <div style={{ flexShrink: 0 }}>
                <ModelPreview
                  agentClass={previewAgentClass}
                  modelFile={previewModelFile}
                  width={80}
                  height={100}
                />
              </div>
              <div style={{ flex: 1 }}>
                <select
                  className="form-input"
                  value={selectedClass}
                  onChange={(e) => setSelectedClass(e.target.value)}
                  style={{ width: '100%', marginBottom: '8px' }}
                >
                  <optgroup label="Built-in Classes">
                    {Object.entries(BUILT_IN_AGENT_CLASSES)
                      .filter(([key]) => key !== 'boss')
                      .map(([key, config]) => (
                        <option key={key} value={key}>
                          {config.icon} {key.charAt(0).toUpperCase() + key.slice(1)}
                        </option>
                      ))}
                  </optgroup>
                  {customClasses.length > 0 && (
                    <optgroup label="Custom Classes">
                      {customClasses.map(cc => (
                        <option key={cc.id} value={cc.id}>
                          {cc.icon} {cc.name}
                        </option>
                      ))}
                    </optgroup>
                  )}
                </select>
                <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                  {BUILT_IN_AGENT_CLASSES[selectedClass as BuiltInAgentClass]?.description ||
                    customClasses.find(c => c.id === selectedClass)?.description ||
                    'Custom agent class'}
                </div>
              </div>
            </div>
          </div>

          {/* Custom Class Instructions Notice */}
          {selectedCustomClass?.instructions && (
            <div style={{
              marginBottom: '16px',
              padding: '10px 12px',
              background: 'rgba(139, 233, 253, 0.1)',
              border: '1px solid rgba(139, 233, 253, 0.3)',
              borderRadius: '6px',
              fontSize: '12px',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--accent-cyan)' }}>
                <span>📋</span>
                <span style={{ fontWeight: 500 }}>This class has custom instructions</span>
              </div>
              <div style={{ marginTop: '6px', color: 'var(--text-secondary)', fontSize: '11px' }}>
                {selectedCustomClass.instructions.length} characters of CLAUDE.md instructions will be injected as system prompt
              </div>
            </div>
          )}

          {/* Permission Mode */}
          <div className="form-section" style={{ marginBottom: '16px' }}>
            <label className="form-label">Permission Mode</label>
            <div style={{ display: 'flex', gap: '8px' }}>
              {(Object.entries(PERMISSION_MODES) as [PermissionMode, { label: string; description: string }][]).map(
                ([mode, config]) => (
                  <button
                    key={mode}
                    type="button"
                    className={`btn ${permissionMode === mode ? 'btn-primary' : 'btn-secondary'}`}
                    onClick={() => setPermissionMode(mode)}
                    style={{ flex: 1, padding: '8px 12px' }}
                    title={config.description}
                  >
                    {mode === 'bypass' ? '⚡' : '🔐'} {config.label}
                  </button>
                )
              )}
            </div>
            <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '4px' }}>
              {PERMISSION_MODES[permissionMode].description}
            </div>
          </div>

          {/* Skills Assignment */}
          <div className="form-section">
            <label className="form-label">Skills</label>
            <p className="form-hint" style={{ fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '8px' }}>
              Select skills to assign directly to this agent
            </p>
            <div style={{
              maxHeight: '200px',
              overflowY: 'auto',
              border: '1px solid var(--border-color)',
              borderRadius: '6px',
              padding: '8px'
            }}>
              {availableSkills.length === 0 ? (
                <div style={{ color: 'var(--text-muted)', fontSize: '12px', textAlign: 'center', padding: '12px' }}>
                  No enabled skills available
                </div>
              ) : (
                availableSkills.map(skill => {
                  const isClassBased = classBasedSkills.includes(skill);
                  const isDirectlyAssigned = selectedSkillIds.has(skill.id);

                  return (
                    <div
                      key={skill.id}
                      onClick={() => !isClassBased && toggleSkill(skill.id)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        padding: '6px 8px',
                        borderRadius: '4px',
                        cursor: isClassBased ? 'default' : 'pointer',
                        background: (isDirectlyAssigned || isClassBased) ? 'rgba(80, 250, 123, 0.15)' : 'transparent',
                        opacity: isClassBased ? 0.7 : 1,
                      }}
                    >
                      <span style={{ width: '16px', color: 'var(--dracula-green)' }}>
                        {(isDirectlyAssigned || isClassBased) ? '✓' : ''}
                      </span>
                      <span style={{ fontSize: '13px', flex: 1 }}>{skill.name}</span>
                      {isClassBased && (
                        <span style={{
                          fontSize: '10px',
                          color: 'var(--text-secondary)',
                          background: 'var(--bg-tertiary)',
                          padding: '2px 6px',
                          borderRadius: '3px'
                        }}>
                          via class
                        </span>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>

        <div className="modal-footer" style={{
          display: 'flex',
          gap: '8px',
          justifyContent: 'flex-end',
          padding: '12px 16px',
          borderTop: '1px solid var(--border-color)'
        }}>
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
