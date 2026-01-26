import React, { useState, useEffect, useRef } from 'react';
import { store, useSkill, useAgentsArray } from '../store';
import type { Skill, AgentClass } from '../../shared/types';

interface SkillEditorModalProps {
  isOpen: boolean;
  onClose: () => void;
  skillId?: string | null; // If provided, edit mode; otherwise create mode
}

// Available agent classes for assignment
const AGENT_CLASSES: { value: AgentClass; label: string; description: string }[] = [
  { value: 'scout', label: 'Scout', description: 'Codebase exploration' },
  { value: 'builder', label: 'Builder', description: 'Feature implementation' },
  { value: 'debugger', label: 'Debugger', description: 'Bug hunting & fixing' },
  { value: 'architect', label: 'Architect', description: 'Planning & design' },
  { value: 'warrior', label: 'Warrior', description: 'Refactoring & migrations' },
  { value: 'support', label: 'Support', description: 'Docs & tests' },
  { value: 'boss', label: 'Boss', description: 'Team coordination' },
];

// Common tool permissions
const TOOL_PRESETS = [
  { label: 'Read Files', value: 'Read' },
  { label: 'Write Files', value: 'Write' },
  { label: 'Edit Files', value: 'Edit' },
  { label: 'Run Bash', value: 'Bash' },
  { label: 'Git Commands', value: 'Bash(git:*)' },
  { label: 'NPM Commands', value: 'Bash(npm:*)' },
  { label: 'Docker Commands', value: 'Bash(docker:*)' },
  { label: 'Kubectl Commands', value: 'Bash(kubectl:*)' },
  { label: 'Search Files', value: 'Grep' },
  { label: 'Glob Files', value: 'Glob' },
  { label: 'Web Fetch', value: 'WebFetch' },
  { label: 'Web Search', value: 'WebSearch' },
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
        setContent(skill.content);
        setAllowedTools(skill.allowedTools || []);
        setAssignedAgentIds(skill.assignedAgentIds || []);
        setAssignedAgentClasses(skill.assignedAgentClasses || []);
        setEnabled(skill.enabled);
      } else {
        // Create mode - reset
        setName('New Skill');
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
        const confirmed = confirm(
          'Updating this skill will restart all agents using it.\n\n' +
          'You will need to manually resume any agents that were working.\n\n' +
          'Continue?'
        );
        if (!confirmed) return;
      }

      store.updateSkill(skillId, skillData);
    } else {
      store.createSkill(skillData as Omit<Skill, 'id' | 'createdAt' | 'updatedAt'>);
    }

    onClose();
  };

  const handleDelete = () => {
    if (skillId && confirm('Delete this skill? This cannot be undone.')) {
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

  if (!isOpen) return null;

  return (
    <div className="modal-overlay visible" onClick={onClose}>
      <div
        className="modal skill-editor-modal"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: '700px', maxHeight: '90vh' }}
      >
        <div className="modal-header">
          <span>
            {isEditMode ? (isBuiltinSkill ? 'View Built-in Skill' : 'Edit Skill') : 'Create Skill'}
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
                Built-in
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
              Delete
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
                This is a built-in Tide Commander skill. Content cannot be modified, but you can change which agents and classes it's assigned to.
              </div>
            )}

            {/* Basic Info */}
            <div className="form-section">
              <label className="form-label">Name *</label>
              <input
                ref={nameInputRef}
                type="text"
                className="form-input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., Git Push, Deploy to Production"
                required
                disabled={isBuiltinSkill}
                style={isBuiltinSkill ? { opacity: 0.7, cursor: 'not-allowed' } : undefined}
              />
            </div>

            <div className="form-section">
              <label className="form-label">Slug</label>
              <input
                type="text"
                className="form-input"
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
                placeholder="auto-generated from name"
                style={{ fontFamily: 'monospace', fontSize: '12px', ...(isBuiltinSkill ? { opacity: 0.7, cursor: 'not-allowed' } : {}) }}
                disabled={isBuiltinSkill}
              />
              <small className="form-hint">URL-safe identifier (auto-generated)</small>
            </div>

            <div className="form-section">
              <label className="form-label">Description *</label>
              <textarea
                className="form-input"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Describe when this skill should be used. Include trigger phrases like 'push code', 'deploy', etc."
                rows={3}
                required
                style={{ resize: 'vertical', ...(isBuiltinSkill ? { opacity: 0.7, cursor: 'not-allowed' } : {}) }}
                disabled={isBuiltinSkill}
              />
              <small className="form-hint">
                Claude uses this to decide when to activate the skill
              </small>
            </div>

            <div className="form-section">
              <label className="form-label">Instructions (Markdown)</label>
              <textarea
                ref={contentRef}
                className="form-input"
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder="Step-by-step instructions for performing this skill..."
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
              <label className="form-label">Allowed Tools</label>
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
                        {preset.label}
                      </button>
                    ))}
                  </div>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <input
                      type="text"
                      className="form-input"
                      value={customTool}
                      onChange={(e) => setCustomTool(e.target.value)}
                      placeholder="Custom tool (e.g., Bash(make:*))"
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
                      Add
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
                          title="Click to remove"
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
                    <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>No specific tools</span>
                  )}
                </div>
              )}
            </div>

            {/* Agent Class Assignment */}
            <div className="form-section">
              <label className="form-label">Assign to Agent Classes</label>
              <small className="form-hint" style={{ display: 'block', marginBottom: '8px' }}>
                All agents of selected classes will have this skill
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
                    <strong>{ac.label}</strong>
                    <span style={{ opacity: 0.7, marginLeft: '4px' }}>- {ac.description}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Individual Agent Assignment */}
            {assignableAgents.length > 0 && (
              <div className="form-section">
                <label className="form-label">Assign to Specific Agents</label>
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
                {showAdvanced ? 'Hide' : 'Show'} Advanced Options
              </button>

              {showAdvanced && (
                <div style={{ marginTop: '8px' }}>
                  <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <input
                      type="checkbox"
                      checked={enabled}
                      onChange={(e) => setEnabled(e.target.checked)}
                    />
                    Skill Enabled
                  </label>
                  <small className="form-hint">
                    Disabled skills won't be available to agents
                  </small>
                </div>
              )}
            </div>
          </div>

          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              {isBuiltinSkill ? 'Close' : 'Cancel'}
            </button>
            {!isBuiltinSkill && (
              <button type="submit" className="btn btn-primary">
                {isEditMode ? 'Save Changes' : 'Create Skill'}
              </button>
            )}
            {isBuiltinSkill && (
              <button type="submit" className="btn btn-primary">
                Save Assignments
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
