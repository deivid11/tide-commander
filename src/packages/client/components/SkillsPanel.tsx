import React, { useState, useMemo, useCallback } from 'react';
import { store, useSkillsArray, useAgents, useCustomAgentClassesArray } from '../store';
import { SkillEditorModal } from './SkillEditorModal';
import { ModelPreview } from './ModelPreview';
import type { Skill, CustomAgentClass } from '../../shared/types';
import { ALL_CHARACTER_MODELS } from '../scene/config';

type PanelTab = 'skills' | 'classes';

interface SkillsPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

export function SkillsPanel({ isOpen, onClose }: SkillsPanelProps) {
  const skills = useSkillsArray();
  const agents = useAgents();
  const customClasses = useCustomAgentClassesArray();
  const [activeTab, setActiveTab] = useState<PanelTab>('skills');
  const [editingSkillId, setEditingSkillId] = useState<string | null>(null);
  const [showEditor, setShowEditor] = useState(false);
  const [showClassEditor, setShowClassEditor] = useState(false);
  const [editingClassId, setEditingClassId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  // Class editor state
  const [className, setClassName] = useState('');
  const [classIcon, setClassIcon] = useState('');
  const [classColor, setClassColor] = useState('#4a9eff');
  const [classDescription, setClassDescription] = useState('');
  const [classModel, setClassModel] = useState('character-male-a.glb');
  const [classDefaultSkillIds, setClassDefaultSkillIds] = useState<string[]>([]);
  const [classInstructions, setClassInstructions] = useState('');

  // Get current model index for navigation
  const currentModelIndex = useMemo(() => {
    const idx = ALL_CHARACTER_MODELS.findIndex(m => m.file === classModel);
    return idx >= 0 ? idx : 0;
  }, [classModel]);

  // Get current model info
  const currentModelInfo = useMemo(() => {
    return ALL_CHARACTER_MODELS[currentModelIndex] || ALL_CHARACTER_MODELS[0];
  }, [currentModelIndex]);

  // Navigate to previous/next model
  const navigateModel = useCallback((direction: 'prev' | 'next') => {
    const newIndex = direction === 'prev'
      ? (currentModelIndex - 1 + ALL_CHARACTER_MODELS.length) % ALL_CHARACTER_MODELS.length
      : (currentModelIndex + 1) % ALL_CHARACTER_MODELS.length;
    setClassModel(ALL_CHARACTER_MODELS[newIndex].file);
  }, [currentModelIndex]);

  // Filter skills by search
  const filteredSkills = skills.filter(skill => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return (
      skill.name.toLowerCase().includes(query) ||
      skill.description.toLowerCase().includes(query) ||
      skill.slug.toLowerCase().includes(query)
    );
  });

  // Sort skills: enabled first, then by name
  const sortedSkills = [...filteredSkills].sort((a, b) => {
    if (a.enabled !== b.enabled) return a.enabled ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  const handleCreate = () => {
    setEditingSkillId(null);
    setShowEditor(true);
  };

  const handleEdit = (skillId: string) => {
    setEditingSkillId(skillId);
    setShowEditor(true);
  };

  const handleToggleEnabled = (skill: Skill) => {
    store.updateSkill(skill.id, { enabled: !skill.enabled });
  };

  const getAssignmentSummary = (skill: Skill): string => {
    const parts: string[] = [];

    if (skill.assignedAgentClasses.length > 0) {
      parts.push(`${skill.assignedAgentClasses.length} class${skill.assignedAgentClasses.length > 1 ? 'es' : ''}`);
    }

    if (skill.assignedAgentIds.length > 0) {
      parts.push(`${skill.assignedAgentIds.length} agent${skill.assignedAgentIds.length > 1 ? 's' : ''}`);
    }

    if (parts.length === 0) {
      return 'Not assigned';
    }

    return parts.join(', ');
  };

  const getActiveAgentCount = (skill: Skill): number => {
    if (!skill.enabled) return 0;

    let count = 0;
    const countedAgents = new Set<string>();

    // Count agents from class assignments
    for (const agent of agents.values()) {
      if (skill.assignedAgentClasses.includes(agent.class)) {
        countedAgents.add(agent.id);
      }
    }

    // Count directly assigned agents
    for (const agentId of skill.assignedAgentIds) {
      countedAgents.add(agentId);
    }

    return countedAgents.size;
  };

  // Custom class handlers
  const handleCreateClass = () => {
    setEditingClassId(null);
    setClassName('');
    setClassIcon('');
    setClassColor('#4a9eff');
    setClassDescription('');
    setClassModel('character-male-a.glb');
    setClassDefaultSkillIds([]);
    setClassInstructions('');
    setShowClassEditor(true);
  };

  const handleEditClass = (classId: string) => {
    const customClass = customClasses.find(c => c.id === classId);
    if (!customClass) return;

    setEditingClassId(classId);
    setClassName(customClass.name);
    setClassIcon(customClass.icon);
    setClassColor(customClass.color);
    setClassDescription(customClass.description);
    setClassModel(customClass.model || 'character-male-a.glb');
    setClassDefaultSkillIds(customClass.defaultSkillIds || []);
    setClassInstructions(customClass.instructions || '');
    setShowClassEditor(true);
  };

  const handleSaveClass = () => {
    const classData = {
      name: className,
      icon: classIcon || '🔷',
      color: classColor,
      description: classDescription,
      model: classModel,
      defaultSkillIds: classDefaultSkillIds,
      instructions: classInstructions || undefined,
    };

    if (editingClassId) {
      store.updateCustomAgentClass(editingClassId, classData);
    } else {
      store.createCustomAgentClass(classData);
    }

    setShowClassEditor(false);
  };

  const handleDeleteClass = (classId: string) => {
    if (window.confirm('Are you sure you want to delete this custom agent class?')) {
      store.deleteCustomAgentClass(classId);
    }
  };

  const toggleClassSkill = (skillId: string) => {
    setClassDefaultSkillIds(prev =>
      prev.includes(skillId)
        ? prev.filter(id => id !== skillId)
        : [...prev, skillId]
    );
  };

  if (!isOpen) return null;

  return (
    <>
      <div className="panel-overlay" onClick={onClose} />
      <div className="skills-panel side-panel">
        <div className="panel-header">
          <h3>{activeTab === 'skills' ? 'Skills' : 'Agent Classes'}</h3>
          {activeTab === 'skills' ? (
            <button className="btn btn-sm btn-primary" onClick={handleCreate}>
              + New Skill
            </button>
          ) : (
            <button className="btn btn-sm btn-primary" onClick={handleCreateClass}>
              + New Class
            </button>
          )}
          <button className="panel-close" onClick={onClose}>
            &times;
          </button>
        </div>

        {/* Tabs */}
        <div className="panel-tabs" style={{ display: 'flex', borderBottom: '1px solid var(--border-color)', padding: '0 16px' }}>
          <button
            className={`panel-tab ${activeTab === 'skills' ? 'active' : ''}`}
            onClick={() => setActiveTab('skills')}
            style={{
              padding: '8px 16px',
              background: 'transparent',
              border: 'none',
              borderBottom: activeTab === 'skills' ? '2px solid var(--accent-blue)' : '2px solid transparent',
              color: activeTab === 'skills' ? 'var(--text-primary)' : 'var(--text-secondary)',
              cursor: 'pointer',
              fontWeight: activeTab === 'skills' ? 600 : 400,
            }}
          >
            Skills ({skills.length})
          </button>
          <button
            className={`panel-tab ${activeTab === 'classes' ? 'active' : ''}`}
            onClick={() => setActiveTab('classes')}
            style={{
              padding: '8px 16px',
              background: 'transparent',
              border: 'none',
              borderBottom: activeTab === 'classes' ? '2px solid var(--accent-blue)' : '2px solid transparent',
              color: activeTab === 'classes' ? 'var(--text-primary)' : 'var(--text-secondary)',
              cursor: 'pointer',
              fontWeight: activeTab === 'classes' ? 600 : 400,
            }}
          >
            Classes ({customClasses.length})
          </button>
        </div>

        {activeTab === 'skills' && (
          <div className="panel-search" style={{ padding: '12px 16px 12px' }}>
            <input
              type="text"
              className="form-input"
              placeholder="Search skills..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{ width: '100%' }}
            />
          </div>
        )}

        <div className="panel-content" style={{ flex: 1, overflowY: 'auto', padding: '0 16px' }}>
          {activeTab === 'skills' ? (
            // Skills List
            sortedSkills.length === 0 ? (
              <div className="empty-state" style={{ textAlign: 'center', padding: '40px 20px', opacity: 0.6 }}>
                {searchQuery ? (
                  <p>No skills match "{searchQuery}"</p>
                ) : (
                  <>
                    <p>No skills defined yet</p>
                    <p style={{ fontSize: '12px', marginTop: '8px' }}>
                      Create skills to teach agents specific capabilities
                    </p>
                  </>
                )}
              </div>
            ) : (
              <div className="skills-list" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {sortedSkills.map((skill) => (
                  <div
                    key={skill.id}
                    className={`skill-card ${!skill.enabled ? 'disabled' : ''}`}
                    style={{
                      background: 'var(--bg-secondary)',
                      borderRadius: '8px',
                      padding: '12px',
                      border: '1px solid var(--border-color)',
                      opacity: skill.enabled ? 1 : 0.6,
                      cursor: 'pointer',
                    }}
                    onClick={() => handleEdit(skill.id)}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span style={{ fontWeight: 600, fontSize: '14px' }}>{skill.name}</span>
                          {!skill.enabled && (
                            <span
                              style={{
                                fontSize: '10px',
                                background: 'var(--bg-tertiary)',
                                padding: '2px 6px',
                                borderRadius: '3px',
                              }}
                            >
                              Disabled
                            </span>
                          )}
                        </div>
                        <div
                          style={{
                            fontSize: '11px',
                            color: 'var(--text-secondary)',
                            fontFamily: 'monospace',
                          }}
                        >
                          /{skill.slug}
                        </div>
                      </div>

                      <button
                        className="btn btn-sm btn-secondary"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleToggleEnabled(skill);
                        }}
                        style={{ fontSize: '10px', padding: '4px 8px' }}
                      >
                        {skill.enabled ? 'Disable' : 'Enable'}
                      </button>
                    </div>

                    <p
                      style={{
                        fontSize: '12px',
                        color: 'var(--text-secondary)',
                        margin: '8px 0',
                        lineHeight: 1.4,
                        display: '-webkit-box',
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: 'vertical',
                        overflow: 'hidden',
                      }}
                    >
                      {skill.description}
                    </p>

                    <div style={{ display: 'flex', gap: '12px', fontSize: '11px', color: 'var(--text-secondary)' }}>
                      <span title="Assigned to">
                        {getAssignmentSummary(skill)}
                      </span>
                      {skill.allowedTools.length > 0 && (
                        <span title="Allowed tools">
                          {skill.allowedTools.length} tool{skill.allowedTools.length !== 1 ? 's' : ''}
                        </span>
                      )}
                      {skill.enabled && getActiveAgentCount(skill) > 0 && (
                        <span style={{ color: 'var(--accent-green)' }}>
                          Active on {getActiveAgentCount(skill)} agent{getActiveAgentCount(skill) !== 1 ? 's' : ''}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )
          ) : (
            // Custom Classes List
            customClasses.length === 0 ? (
              <div className="empty-state" style={{ textAlign: 'center', padding: '40px 20px', opacity: 0.6 }}>
                <p>No custom agent classes yet</p>
                <p style={{ fontSize: '12px', marginTop: '8px' }}>
                  Create custom classes with default skills attached
                </p>
              </div>
            ) : (
              <div className="classes-list" style={{ display: 'flex', flexDirection: 'column', gap: '8px', paddingTop: '12px' }}>
                {customClasses.map((customClass) => (
                  <div
                    key={customClass.id}
                    className="class-card"
                    style={{
                      background: 'var(--bg-secondary)',
                      borderRadius: '8px',
                      padding: '12px',
                      border: `1px solid ${customClass.color}40`,
                      cursor: 'pointer',
                    }}
                    onClick={() => handleEditClass(customClass.id)}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <div
                          style={{
                            width: '36px',
                            height: '36px',
                            borderRadius: '8px',
                            background: `${customClass.color}20`,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: '18px',
                          }}
                        >
                          {customClass.icon}
                        </div>
                        <div>
                          <div style={{ fontWeight: 600, fontSize: '14px' }}>{customClass.name}</div>
                          <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                            Model: {ALL_CHARACTER_MODELS.find(m => m.file === customClass.model)?.name || customClass.model || 'Male A'}
                          </div>
                        </div>
                      </div>

                      <button
                        className="btn btn-sm btn-secondary"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteClass(customClass.id);
                        }}
                        style={{ fontSize: '10px', padding: '4px 8px', color: 'var(--accent-red)' }}
                      >
                        Delete
                      </button>
                    </div>

                    <p
                      style={{
                        fontSize: '12px',
                        color: 'var(--text-secondary)',
                        margin: '8px 0 0',
                        lineHeight: 1.4,
                      }}
                    >
                      {customClass.description || 'No description'}
                    </p>

                    <div style={{ marginTop: '8px', fontSize: '11px', color: 'var(--text-secondary)', display: 'flex', gap: '12px' }}>
                      {customClass.defaultSkillIds.length > 0 && (
                        <span>{customClass.defaultSkillIds.length} default skill{customClass.defaultSkillIds.length !== 1 ? 's' : ''}</span>
                      )}
                      {customClass.instructions && (
                        <span style={{ color: 'var(--accent-cyan)' }}>Has instructions</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )
          )}
        </div>

        <div className="panel-footer" style={{ padding: '12px 16px', borderTop: '1px solid var(--border-color)' }}>
          <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
            {activeTab === 'skills' ? (
              <>
                {skills.length} skill{skills.length !== 1 ? 's' : ''} total
                {skills.filter(s => s.enabled).length !== skills.length && (
                  <span> ({skills.filter(s => s.enabled).length} enabled)</span>
                )}
              </>
            ) : (
              <>
                {customClasses.length} custom class{customClasses.length !== 1 ? 'es' : ''}
              </>
            )}
          </div>
        </div>
      </div>

      {/* Skill Editor Modal */}
      <SkillEditorModal
        isOpen={showEditor}
        onClose={() => setShowEditor(false)}
        skillId={editingSkillId}
      />

      {/* Custom Class Editor Modal */}
      {showClassEditor && (
        <div className="modal-overlay visible" onClick={() => setShowClassEditor(false)}>
          <div className="modal skill-editor-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              {editingClassId ? 'Edit Agent Class' : 'Create Agent Class'}
            </div>
            <div className="modal-body" style={{ padding: '16px' }}>
              <div className="form-section" style={{ marginBottom: '12px' }}>
                <label className="form-label">Name</label>
                <input
                  type="text"
                  className="form-input"
                  value={className}
                  onChange={(e) => setClassName(e.target.value)}
                  placeholder="e.g., Deployer"
                />
              </div>

              {/* Model selector with 3D preview */}
              <div className="form-section" style={{ marginBottom: '16px' }}>
                <label className="form-label">Character Model</label>
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '12px',
                  padding: '12px',
                  background: 'var(--bg-tertiary)',
                  borderRadius: '8px',
                  border: '1px solid var(--border-color)'
                }}>
                  <button
                    type="button"
                    onClick={() => navigateModel('prev')}
                    style={{
                      width: '36px',
                      height: '36px',
                      borderRadius: '50%',
                      border: '1px solid var(--border-color)',
                      background: 'var(--bg-secondary)',
                      color: 'var(--text-primary)',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '18px',
                    }}
                  >
                    ‹
                  </button>
                  <div style={{ textAlign: 'center' }}>
                    <ModelPreview modelFile={classModel} width={120} height={150} />
                    <div style={{
                      marginTop: '8px',
                      fontSize: '12px',
                      fontWeight: 500,
                      color: 'var(--text-primary)'
                    }}>
                      {currentModelInfo.name}
                    </div>
                    <div style={{
                      fontSize: '10px',
                      color: 'var(--text-secondary)',
                      marginTop: '2px'
                    }}>
                      {currentModelIndex + 1} / {ALL_CHARACTER_MODELS.length}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => navigateModel('next')}
                    style={{
                      width: '36px',
                      height: '36px',
                      borderRadius: '50%',
                      border: '1px solid var(--border-color)',
                      background: 'var(--bg-secondary)',
                      color: 'var(--text-primary)',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '18px',
                    }}
                  >
                    ›
                  </button>
                </div>
              </div>

              <div style={{ display: 'flex', gap: '12px', marginBottom: '12px' }}>
                <div className="form-section" style={{ flex: '0 0 80px' }}>
                  <label className="form-label">Icon</label>
                  <input
                    type="text"
                    className="form-input"
                    value={classIcon}
                    onChange={(e) => setClassIcon(e.target.value)}
                    placeholder="🚀"
                    style={{ textAlign: 'center', fontSize: '18px' }}
                  />
                </div>
                <div className="form-section" style={{ flex: 1 }}>
                  <label className="form-label">Color</label>
                  <input
                    type="color"
                    value={classColor}
                    onChange={(e) => setClassColor(e.target.value)}
                    style={{ width: '100%', height: '36px', padding: '2px', cursor: 'pointer' }}
                  />
                </div>
              </div>

              <div className="form-section" style={{ marginBottom: '12px' }}>
                <label className="form-label">Description</label>
                <input
                  type="text"
                  className="form-input"
                  value={classDescription}
                  onChange={(e) => setClassDescription(e.target.value)}
                  placeholder="What this agent class specializes in..."
                />
              </div>

              <div className="form-section" style={{ marginBottom: '12px' }}>
                <label className="form-label">Default Skills</label>
                <p className="form-hint" style={{ fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '8px' }}>
                  Skills automatically assigned to agents of this class
                </p>
                <div style={{ maxHeight: '120px', overflowY: 'auto', border: '1px solid var(--border-color)', borderRadius: '6px', padding: '8px' }}>
                  {skills.filter(s => s.enabled).length === 0 ? (
                    <div style={{ color: 'var(--text-muted)', fontSize: '12px', textAlign: 'center', padding: '12px' }}>
                      No enabled skills available
                    </div>
                  ) : (
                    skills.filter(s => s.enabled).map(skill => (
                      <div
                        key={skill.id}
                        onClick={() => toggleClassSkill(skill.id)}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '8px',
                          padding: '6px 8px',
                          borderRadius: '4px',
                          cursor: 'pointer',
                          background: classDefaultSkillIds.includes(skill.id) ? 'rgba(80, 250, 123, 0.15)' : 'transparent',
                        }}
                      >
                        <span style={{ width: '16px', color: 'var(--dracula-green)' }}>
                          {classDefaultSkillIds.includes(skill.id) ? '✓' : ''}
                        </span>
                        <span style={{ fontSize: '13px' }}>{skill.name}</span>
                      </div>
                    ))
                  )}
                </div>
              </div>

              <div className="form-section">
                <label className="form-label">Instructions (CLAUDE.md)</label>
                <p className="form-hint" style={{ fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '8px' }}>
                  Markdown instructions injected as system prompt when spawning agents of this class
                </p>
                <textarea
                  className="form-input"
                  value={classInstructions}
                  onChange={(e) => setClassInstructions(e.target.value)}
                  placeholder="# Agent Instructions&#10;&#10;You are a specialized agent...&#10;&#10;## Guidelines&#10;- Follow these rules...&#10;- Use best practices..."
                  style={{
                    minHeight: '150px',
                    resize: 'vertical',
                    fontFamily: 'monospace',
                    fontSize: '12px',
                    lineHeight: '1.5',
                  }}
                />
              </div>
            </div>
            <div className="modal-footer" style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', padding: '12px 16px', borderTop: '1px solid var(--border-color)' }}>
              <button className="btn btn-secondary" onClick={() => setShowClassEditor(false)}>
                Cancel
              </button>
              <button
                className="btn btn-primary"
                onClick={handleSaveClass}
                disabled={!className.trim()}
              >
                {editingClassId ? 'Save Changes' : 'Create Class'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
