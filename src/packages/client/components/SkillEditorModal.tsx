import React, { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { store, useSkill, useAgentsArray } from '../store';
import type { Skill, AgentClass } from '../../shared/types';
import { useModalClose } from '../hooks';

interface SkillEditorModalProps {
  isOpen: boolean;
  onClose: () => void;
  skillId?: string | null; // If provided, edit mode; otherwise create mode
}

// Available agent classes for assignment (labels resolved via i18n at render time)
const AGENT_CLASSES: { value: AgentClass; labelKey: string; descriptionKey: string }[] = [
  { value: 'scout', labelKey: 'tools:skills.classScout', descriptionKey: 'tools:skills.classScoutDesc' },
  { value: 'builder', labelKey: 'tools:skills.classBuilder', descriptionKey: 'tools:skills.classBuilderDesc' },
  { value: 'debugger', labelKey: 'tools:skills.classDebugger', descriptionKey: 'tools:skills.classDebuggerDesc' },
  { value: 'architect', labelKey: 'tools:skills.classArchitect', descriptionKey: 'tools:skills.classArchitectDesc' },
  { value: 'warrior', labelKey: 'tools:skills.classWarrior', descriptionKey: 'tools:skills.classWarriorDesc' },
  { value: 'support', labelKey: 'tools:skills.classSupport', descriptionKey: 'tools:skills.classSupportDesc' },
  { value: 'boss', labelKey: 'tools:skills.classBoss', descriptionKey: 'tools:skills.classBossDesc' },
];

// Common tool permissions (labels resolved via i18n at render time)
const TOOL_PRESETS = [
  { labelKey: 'tools:skills.toolReadFiles', value: 'Read' },
  { labelKey: 'tools:skills.toolWriteFiles', value: 'Write' },
  { labelKey: 'tools:skills.toolEditFiles', value: 'Edit' },
  { labelKey: 'tools:skills.toolRunBash', value: 'Bash' },
  { labelKey: 'tools:skills.toolGitCommands', value: 'Bash(git:*)' },
  { labelKey: 'tools:skills.toolNpmCommands', value: 'Bash(npm:*)' },
  { labelKey: 'tools:skills.toolDockerCommands', value: 'Bash(docker:*)' },
  { labelKey: 'tools:skills.toolKubectlCommands', value: 'Bash(kubectl:*)' },
  { labelKey: 'tools:skills.toolSearchFiles', value: 'Grep' },
  { labelKey: 'tools:skills.toolGlobFiles', value: 'Glob' },
  { labelKey: 'tools:skills.toolWebFetch', value: 'WebFetch' },
  { labelKey: 'tools:skills.toolWebSearch', value: 'WebSearch' },
];

// Default skill template
const DEFAULT_SKILL_CONTENT = `## Instructions

Describe step-by-step instructions for this skill here.

1. First step
2. Second step
3. Third step

## Examples

Show concrete examples of using this skill.

### Example 1
\`\`\`bash
# Example command
\`\`\`

## Safety Checks

- List important safety considerations
- Warn about destructive operations
`;

export function SkillEditorModal({
  isOpen,
  onClose,
  skillId,
}: SkillEditorModalProps) {
  const { t } = useTranslation(['tools', 'common']);
  const skill = useSkill(skillId ?? null);
  const agents = useAgentsArray();
  const isEditMode = !!skill;
  const isBuiltinSkill = skill?.builtin === true;

  // Form state
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [description, setDescription] = useState('');
  const [content, setContent] = useState('');
  const [allowedTools, setAllowedTools] = useState<string[]>([]);
  const [customTool, setCustomTool] = useState('');
  const [assignedAgentIds, setAssignedAgentIds] = useState<string[]>([]);
  const [assignedAgentClasses, setAssignedAgentClasses] = useState<AgentClass[]>([]);
  const [enabled, setEnabled] = useState(true);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const nameInputRef = useRef<HTMLInputElement>(null);
  const contentRef = useRef<HTMLTextAreaElement>(null);

  // Reset form when modal opens
  useEffect(() => {
    if (isOpen) {
      if (skill) {
        // Edit mode - populate from skill
        setName(skill.name);
        setSlug(skill.slug);
        setDescription(skill.description);
        setContent(skill.content || '');
        setAllowedTools(skill.allowedTools || []);
        setAssignedAgentIds(skill.assignedAgentIds || []);
        setAssignedAgentClasses(skill.assignedAgentClasses || []);
        setEnabled(skill.enabled);
      } else {
        // Create mode - reset
        setName(t('tools:skills.newSkillDefault'));
        setSlug('');
        setDescription('');
        setContent(DEFAULT_SKILL_CONTENT);
        setAllowedTools([]);
        setAssignedAgentIds([]);
        setAssignedAgentClasses([]);
        setEnabled(true);
      }
      setCustomTool('');
      setShowAdvanced(false);

      setTimeout(() => nameInputRef.current?.focus(), 100);
    }
  }, [isOpen, skill]);

  // Auto-generate slug from name
  useEffect(() => {
    if (!isEditMode && name) {
      const generated = name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .substring(0, 64);
      setSlug(generated);
    }
  }, [name, isEditMode]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    // For built-in skills, only allow assignment changes
    if (isBuiltinSkill && skillId) {
      store.updateSkill(skillId, {
        assignedAgentIds,
        assignedAgentClasses,
        enabled,
      });
      onClose();
      return;
    }

    if (!name.trim() || !description.trim()) {
      return;
    }

    const skillData = {
      name: name.trim(),
      slug: slug.trim() || name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      description: description.trim(),
      content: content.trim(),
      allowedTools,
      assignedAgentIds,
      assignedAgentClasses,
      enabled,
    };

    if (isEditMode && skillId) {
      // Check if content actually changed (which triggers agent restarts)
      const contentChanged = skill && (
        skill.name !== skillData.name ||
        skill.description !== skillData.description ||
        skill.content !== skillData.content ||
        skill.enabled !== skillData.enabled ||
        JSON.stringify(skill.allowedTools) !== JSON.stringify(skillData.allowedTools)
      );

      if (contentChanged) {
        const confirmed = confirm(t('tools:skills.updateSkillConfirm'));
        if (!confirmed) return;
      }

      store.updateSkill(skillId, skillData);
    } else {
      store.createSkill(skillData as Omit<Skill, 'id' | 'createdAt' | 'updatedAt'>);
    }

    onClose();
  };

  const handleDelete = () => {
    if (skillId && confirm(t('tools:skills.deleteSkillConfirm'))) {
      store.deleteSkill(skillId);
      onClose();
    }
  };

  const toggleTool = (tool: string) => {
    if (allowedTools.includes(tool)) {
      setAllowedTools(allowedTools.filter(t => t !== tool));
    } else {
      setAllowedTools([...allowedTools, tool]);
    }
  };

  const addCustomTool = () => {
    if (customTool.trim() && !allowedTools.includes(customTool.trim())) {
      setAllowedTools([...allowedTools, customTool.trim()]);
      setCustomTool('');
    }
  };

  const toggleAgentClass = (agentClass: AgentClass) => {
    if (assignedAgentClasses.includes(agentClass)) {
      setAssignedAgentClasses(assignedAgentClasses.filter(c => c !== agentClass));
    } else {
      setAssignedAgentClasses([...assignedAgentClasses, agentClass]);
    }
  };

  const toggleAgent = (agentId: string) => {
    if (assignedAgentIds.includes(agentId)) {
      setAssignedAgentIds(assignedAgentIds.filter(id => id !== agentId));
    } else {
      setAssignedAgentIds([...assignedAgentIds, agentId]);
    }
  };

  // Non-boss agents for individual assignment
  const assignableAgents = agents.filter(a => a.class !== 'boss');

  const { handleMouseDown: handleBackdropMouseDown, handleClick: handleBackdropClick } = useModalClose(onClose);

  if (!isOpen) return null;

  return (
    <div className="modal-overlay visible" onMouseDown={handleBackdropMouseDown} onClick={handleBackdropClick}>
      <div
        className="modal skill-editor-modal"
        style={{ maxWidth: '700px', maxHeight: '90vh' }}
      >
        <div className="modal-header">
          <span>
            {isEditMode ? (isBuiltinSkill ? t('tools:skills.viewBuiltInSkill') : t('tools:skills.editSkill')) : t('tools:skills.createSkill')}
            {isBuiltinSkill && (
              <span
                style={{
                  fontSize: '10px',
                  background: 'var(--accent-cyan)',
                  color: 'var(--bg-primary)',
                  padding: '2px 6px',
                  borderRadius: '3px',
                  fontWeight: 600,
                  marginLeft: '8px',
                }}
              >
                {t('tools:skills.builtIn')}
              </span>
            )}
          </span>
          {isEditMode && !isBuiltinSkill && (
            <button
              type="button"
              className="btn btn-danger btn-sm"
              onClick={handleDelete}
              style={{ marginLeft: 'auto', marginRight: '12px' }}
            >
              {t('common:buttons.delete')}
            </button>
          )}
        </div>

        <form onSubmit={handleSubmit}>
          <div className="modal-body" style={{ maxHeight: '70vh', overflowY: 'auto' }}>
            {/* Built-in skill notice */}
            {isBuiltinSkill && (
              <div
                style={{
                  background: 'rgba(139, 233, 253, 0.1)',
                  border: '1px solid var(--accent-cyan)',
                  borderRadius: '6px',
                  padding: '10px 12px',
                  marginBottom: '16px',
                  fontSize: '12px',
                  color: 'var(--accent-cyan)',
                }}
              >
                {t('tools:skills.builtInNotice')}
              </div>
            )}

            {/* Basic Info */}
            <div className="form-section">
              <label className="form-label">{t('tools:skills.nameRequired')}</label>
              <input
                ref={nameInputRef}
                type="text"
                className="form-input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t('tools:skills.skillNamePlaceholder')}
                required
                disabled={isBuiltinSkill}
                style={isBuiltinSkill ? { opacity: 0.7, cursor: 'not-allowed' } : undefined}
              />
            </div>

            <div className="form-section">
              <label className="form-label">{t('tools:skills.slugLabel')}</label>
              <input
                type="text"
                className="form-input"
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
                placeholder={t('tools:skills.slugPlaceholder')}
                style={{ fontFamily: 'monospace', fontSize: '12px', ...(isBuiltinSkill ? { opacity: 0.7, cursor: 'not-allowed' } : {}) }}
                disabled={isBuiltinSkill}
              />
              <small className="form-hint">{t('tools:skills.slugHint')}</small>
            </div>

            <div className="form-section">
              <label className="form-label">{t('tools:skills.descriptionRequired')}</label>
              <textarea
                className="form-input"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={t('tools:skills.skillDescPlaceholder')}
                rows={3}
                required
                style={{ resize: 'vertical', ...(isBuiltinSkill ? { opacity: 0.7, cursor: 'not-allowed' } : {}) }}
                disabled={isBuiltinSkill}
              />
              <small className="form-hint">
                {t('tools:skills.descriptionHint')}
              </small>
            </div>

            <div className="form-section">
              <label className="form-label">{t('tools:skills.instructionsMarkdown')}</label>
              <textarea
                ref={contentRef}
                className="form-input"
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder={t('tools:skills.skillContentPlaceholder')}
                rows={12}
                style={{
                  fontFamily: 'monospace',
                  fontSize: '12px',
                  resize: 'vertical',
                  minHeight: '200px',
                  ...(isBuiltinSkill ? { opacity: 0.7, cursor: 'not-allowed' } : {}),
                }}
                disabled={isBuiltinSkill}
              />
            </div>

            {/* Tool Permissions */}
            <div className="form-section">
              <label className="form-label">{t('tools:skills.allowedTools')}</label>
              {!isBuiltinSkill ? (
                <>
                  <div className="tool-presets" style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '8px' }}>
                    {TOOL_PRESETS.map((preset) => (
                      <button
                        key={preset.value}
                        type="button"
                        className={`btn btn-sm ${allowedTools.includes(preset.value) ? 'btn-primary' : 'btn-secondary'}`}
                        onClick={() => toggleTool(preset.value)}
                        style={{ fontSize: '11px', padding: '4px 8px' }}
                      >
                        {t(preset.labelKey)}
                      </button>
                    ))}
                  </div>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <input
                      type="text"
                      className="form-input"
                      value={customTool}
                      onChange={(e) => setCustomTool(e.target.value)}
                      placeholder={t('tools:skills.customToolPlaceholder')}
                      style={{ flex: 1, fontSize: '12px' }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          addCustomTool();
                        }
                      }}
                    />
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={addCustomTool}
                    >
                      {t('common:buttons.add')}
                    </button>
                  </div>
                  {allowedTools.length > 0 && (
                    <div style={{ marginTop: '8px', display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                      {allowedTools.map((tool) => (
                        <span
                          key={tool}
                          className="tag"
                          style={{
                            background: 'var(--bg-tertiary)',
                            padding: '2px 8px',
                            borderRadius: '4px',
                            fontSize: '11px',
                            cursor: 'pointer',
                          }}
                          onClick={() => toggleTool(tool)}
                          title={t('tools:skills.clickToRemove')}
                        >
                          {tool} ×
                        </span>
                      ))}
                    </div>
                  )}
                </>
              ) : (
                /* Read-only tool display for built-in skills */
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', opacity: 0.7 }}>
                  {allowedTools.length > 0 ? (
                    allowedTools.map((tool) => (
                      <span
                        key={tool}
                        style={{
                          background: 'var(--bg-tertiary)',
                          padding: '2px 8px',
                          borderRadius: '4px',
                          fontSize: '11px',
                        }}
                      >
                        {tool}
                      </span>
                    ))
                  ) : (
                    <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{t('tools:skills.noSpecificTools')}</span>
                  )}
                </div>
              )}
            </div>

            {/* Agent Class Assignment */}
            <div className="form-section">
              <label className="form-label">{t('tools:skills.assignToClasses')}</label>
              <small className="form-hint" style={{ display: 'block', marginBottom: '8px' }}>
                {t('tools:skills.allAgentsOfClasses')}
              </small>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '6px' }}>
                {AGENT_CLASSES.map((ac) => (
                  <button
                    key={ac.value}
                    type="button"
                    className={`btn btn-sm ${assignedAgentClasses.includes(ac.value) ? 'btn-primary' : 'btn-secondary'}`}
                    onClick={() => toggleAgentClass(ac.value)}
                    style={{ fontSize: '11px', padding: '6px 8px', textAlign: 'left' }}
                  >
                    <strong>{t(ac.labelKey)}</strong>
                    <span style={{ opacity: 0.7, marginLeft: '4px' }}>- {t(ac.descriptionKey)}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Individual Agent Assignment */}
            {assignableAgents.length > 0 && (
              <div className="form-section">
                <label className="form-label">{t('tools:skills.assignToAgents')}</label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                  {assignableAgents.map((agent) => (
                    <button
                      key={agent.id}
                      type="button"
                      className={`btn btn-sm ${assignedAgentIds.includes(agent.id) ? 'btn-primary' : 'btn-secondary'}`}
                      onClick={() => toggleAgent(agent.id)}
                      style={{ fontSize: '11px', padding: '4px 8px' }}
                    >
                      {agent.name}
                      <span style={{ opacity: 0.6, marginLeft: '4px' }}>({agent.class})</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Advanced Options */}
            <div className="form-section">
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => setShowAdvanced(!showAdvanced)}
                style={{ marginBottom: '8px' }}
              >
                {showAdvanced ? t('common:buttons2.hide') : t('common:buttons2.show')} {t('tools:skills.advancedOptions')}
              </button>

              {showAdvanced && (
                <div style={{ marginTop: '8px' }}>
                  <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <input
                      type="checkbox"
                      checked={enabled}
                      onChange={(e) => setEnabled(e.target.checked)}
                    />
                    {t('tools:skills.skillEnabled')}
                  </label>
                  <small className="form-hint">
                    {t('tools:skills.disabledSkillsHint')}
                  </small>
                </div>
              )}
            </div>
          </div>

          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              {isBuiltinSkill ? t('common:buttons.close') : t('common:buttons.cancel')}
            </button>
            {!isBuiltinSkill && (
              <button type="submit" className="btn btn-primary">
                {isEditMode ? t('common:buttons2.saveChanges') : t('tools:skills.createSkill')}
              </button>
            )}
            {isBuiltinSkill && (
              <button type="submit" className="btn btn-primary">
                {t('tools:skills.saveAssignments')}
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
