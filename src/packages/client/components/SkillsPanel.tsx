import React, { useState, useMemo, useCallback, useRef } from 'react';
import { store, useSkillsArray, useAgents, useCustomAgentClassesArray } from '../store';
import { SkillEditorModal } from './SkillEditorModal';
import { ModelPreview } from './ModelPreview';
import { EmojiPicker } from './EmojiPicker';
import type { Skill, CustomAgentClass, AnimationMapping } from '../../shared/types';
import { ALL_CHARACTER_MODELS } from '../scene/config';
import { parseGlbAnimations, isValidGlbFile, formatFileSize } from '../utils/glbParser';
import { apiUrl, authFetch } from '../utils/storage';
import { useModalClose } from '../hooks';

type PanelTab = 'skills' | 'classes';

/**
 * Generate a URL-safe slug from a name (must match server-side generateSlug)
 */
function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 64);
}

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
  const [classSearchQuery, setClassSearchQuery] = useState('');

  // Class editor state
  const [className, setClassName] = useState('');
  const [classIcon, setClassIcon] = useState('');
  const [classColor, setClassColor] = useState('#4a9eff');
  const [classDescription, setClassDescription] = useState('');
  const [classModel, setClassModel] = useState('character-male-a.glb');
  const [classDefaultSkillIds, setClassDefaultSkillIds] = useState<string[]>([]);
  const [classInstructions, setClassInstructions] = useState('');

  // Custom model state
  const [hasCustomModel, setHasCustomModel] = useState(false);
  const [customModelFile, setCustomModelFile] = useState<File | null>(null);
  const [customModelAnimations, setCustomModelAnimations] = useState<string[]>([]);
  const [animationMapping, setAnimationMapping] = useState<AnimationMapping>({});
  const [modelScale, setModelScale] = useState(1.0);
  const [modelOffsetX, setModelOffsetX] = useState(0);
  const [modelOffsetY, setModelOffsetY] = useState(0);
  const [modelOffsetZ, setModelOffsetZ] = useState(0);
  const [isUploadingModel, setIsUploadingModel] = useState(false);
  const [modelUploadError, setModelUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Modal close handler for class editor
  const closeClassEditor = useCallback(() => setShowClassEditor(false), []);
  const { handleMouseDown: handleClassEditorBackdropMouseDown, handleClick: handleClassEditorBackdropClick } = useModalClose(closeClassEditor);

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

  // Filter classes by search
  const filteredClasses = customClasses.filter(customClass => {
    if (!classSearchQuery) return true;
    const query = classSearchQuery.toLowerCase();
    return (
      customClass.name.toLowerCase().includes(query) ||
      customClass.description.toLowerCase().includes(query) ||
      customClass.id.toLowerCase().includes(query)
    );
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

  // Generate a random vibrant color for new classes
  const generateRandomColor = () => {
    const colors = [
      '#4a9eff', '#50fa7b', '#ff79c6', '#bd93f9', '#ffb86c',
      '#8be9fd', '#f1fa8c', '#ff5555', '#6272a4', '#44475a',
      '#00d4aa', '#ff6b6b', '#4ecdc4', '#45b7d1', '#96ceb4',
      '#ffeaa7', '#dfe6e9', '#a29bfe', '#fd79a8', '#00b894',
    ];
    return colors[Math.floor(Math.random() * colors.length)];
  };

  // Custom class handlers
  const handleCreateClass = () => {
    setEditingClassId(null);
    setClassName('');
    setClassIcon('');
    setClassColor(generateRandomColor());
    setClassDescription('');
    setClassModel('character-male-a.glb');
    setClassDefaultSkillIds([]);
    setClassInstructions('');
    // Reset custom model state
    setHasCustomModel(false);
    setCustomModelFile(null);
    setCustomModelAnimations([]);
    setAnimationMapping({});
    setModelScale(1.0);
    setModelOffsetX(0);
    setModelOffsetY(0);
    setModelOffsetZ(0);
    setModelUploadError(null);
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
    // Set custom model state
    setHasCustomModel(!!customClass.customModelPath);
    setCustomModelFile(null); // File reference is not preserved
    setCustomModelAnimations(customClass.availableAnimations || []);
    setAnimationMapping(customClass.animationMapping || {});
    setModelScale(customClass.modelScale || 1.0);
    setModelOffsetX(customClass.modelOffset?.x || 0);
    setModelOffsetY(customClass.modelOffset?.y || 0);
    setModelOffsetZ(customClass.modelOffset?.z || 0);
    setModelUploadError(null);
    setShowClassEditor(true);
  };

  const handleSaveClass = async () => {
    const classData: Partial<CustomAgentClass> = {
      name: className,
      icon: classIcon || '🔷',
      color: classColor,
      description: classDescription,
      defaultSkillIds: classDefaultSkillIds,
      instructions: classInstructions || undefined,
      modelScale: modelScale !== 1.0 ? modelScale : undefined,
      modelOffset: (modelOffsetX !== 0 || modelOffsetY !== 0 || modelOffsetZ !== 0) ? { x: modelOffsetX, y: modelOffsetY, z: modelOffsetZ } : undefined,
      animationMapping: Object.keys(animationMapping).length > 0 ? animationMapping : undefined,
      availableAnimations: customModelAnimations.length > 0 ? customModelAnimations : undefined,
    };

    // If using built-in model, set model field; if custom, leave for upload handler
    if (!hasCustomModel) {
      classData.model = classModel;
      classData.customModelPath = undefined;
    }

    if (editingClassId) {
      // Update existing class
      store.updateCustomAgentClass(editingClassId, classData);

      // Upload custom model if a new file was selected
      if (customModelFile) {
        await uploadCustomModel(editingClassId);
      }
    } else {
      // Create new class
      store.createCustomAgentClass(classData as Omit<CustomAgentClass, 'id' | 'createdAt' | 'updatedAt'>);

      // If we have a custom model to upload, predict the class ID and upload it
      // The server generates the ID using generateSlug(name), same as client-side
      if (customModelFile) {
        const predictedId = generateSlug(className);
        // Small delay to ensure the class is created server-side first
        await new Promise(resolve => setTimeout(resolve, 100));
        await uploadCustomModel(predictedId);
      }
    }

    setShowClassEditor(false);
  };

  // Upload custom model to server
  const uploadCustomModel = async (classId: string) => {
    if (!customModelFile) return;

    setIsUploadingModel(true);
    setModelUploadError(null);

    try {
      const response = await authFetch(apiUrl(`/api/custom-models/upload/${classId}`), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/octet-stream',
          'X-Filename': customModelFile.name,
        },
        body: customModelFile,
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Upload failed');
      }

      // Update class with animation info
      store.updateCustomAgentClass(classId, {
        availableAnimations: customModelAnimations,
        animationMapping,
        modelScale: modelScale !== 1.0 ? modelScale : undefined,
      });
    } catch (err: any) {
      setModelUploadError(err.message || 'Failed to upload model');
      console.error('Model upload error:', err);
    } finally {
      setIsUploadingModel(false);
    }
  };

  // Handle file selection for custom model
  const handleModelFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setModelUploadError(null);

    // Validate file
    const isValid = await isValidGlbFile(file);
    if (!isValid) {
      setModelUploadError('Invalid file: Please select a valid .glb file');
      return;
    }

    // Check file size (50MB max)
    if (file.size > 50 * 1024 * 1024) {
      setModelUploadError('File too large: Maximum size is 50MB');
      return;
    }

    try {
      // Parse animations
      const animations = await parseGlbAnimations(file);

      setCustomModelFile(file);
      setCustomModelAnimations(animations);
      setHasCustomModel(true);

      // Auto-map common animation names
      const autoMapping: AnimationMapping = {};
      const animLower = animations.map(a => a.toLowerCase());

      // Try to find idle animation
      const idleIdx = animLower.findIndex(a => a.includes('idle') || a === 'static');
      if (idleIdx >= 0) autoMapping.idle = animations[idleIdx];

      // Try to find walk animation
      const walkIdx = animLower.findIndex(a => a.includes('walk') || a.includes('run'));
      if (walkIdx >= 0) autoMapping.walk = animations[walkIdx];

      // Try to find working animation (action, attack, work)
      const workIdx = animLower.findIndex(a =>
        a.includes('work') || a.includes('action') || a.includes('attack') || a.includes('jump')
      );
      if (workIdx >= 0) autoMapping.working = animations[workIdx];

      setAnimationMapping(autoMapping);
    } catch (_err: any) {
      setModelUploadError(_err.message || 'Failed to parse model');
      console.error('Model parse error:', _err);
    }

    // Clear the input so the same file can be selected again
    event.target.value = '';
  };

  // Remove custom model
  const handleRemoveCustomModel = async () => {
    if (editingClassId) {
      // Delete from server
      try {
        await authFetch(apiUrl(`/api/custom-models/${editingClassId}`), { method: 'DELETE' });
      } catch (err) {
        console.error('Failed to delete model:', err);
      }
    }

    setHasCustomModel(false);
    setCustomModelFile(null);
    setCustomModelAnimations([]);
    setAnimationMapping({});
    setModelScale(1.0);
    setClassModel('character-male-a.glb'); // Reset to default
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

        {activeTab === 'classes' && (
          <div className="panel-search" style={{ padding: '12px 16px 12px' }}>
            <input
              type="text"
              className="form-input"
              placeholder="Search classes..."
              value={classSearchQuery}
              onChange={(e) => setClassSearchQuery(e.target.value)}
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
                          {skill.builtin && (
                            <span
                              style={{
                                fontSize: '10px',
                                background: 'linear-gradient(135deg, var(--accent-cyan), var(--accent-purple))',
                                color: '#fff',
                                padding: '3px 8px',
                                borderRadius: '10px',
                                fontWeight: 700,
                                textTransform: 'uppercase',
                                letterSpacing: '0.5px',
                                boxShadow: '0 2px 4px rgba(139, 233, 253, 0.3)',
                              }}
                            >
                              Built-in
                            </span>
                          )}
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
                      {skill.builtin && (
                        <span style={{ color: 'var(--accent-cyan)' }} title="Built-in Tide Commander skill">
                          Tide Commander
                        </span>
                      )}
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
            ) : filteredClasses.length === 0 ? (
              <div className="empty-state" style={{ textAlign: 'center', padding: '40px 20px', opacity: 0.6 }}>
                <p>No classes match "{classSearchQuery}"</p>
              </div>
            ) : (
              <div className="classes-list" style={{ display: 'flex', flexDirection: 'column', gap: '8px', paddingTop: '12px' }}>
                {filteredClasses.map((customClass) => (
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
        <div className="modal-overlay visible" onMouseDown={handleClassEditorBackdropMouseDown} onClick={handleClassEditorBackdropClick}>
          <div className="modal skill-editor-modal">
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

                {/* Hidden file input */}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".glb"
                  onChange={handleModelFileSelect}
                  style={{ display: 'none' }}
                />

                {!hasCustomModel ? (
                  <>
                    {/* Built-in model selector */}
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

                    {/* Upload custom model button */}
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      style={{
                        width: '100%',
                        marginTop: '8px',
                        padding: '8px 12px',
                        background: 'var(--bg-secondary)',
                        border: '1px dashed var(--border-color)',
                        borderRadius: '6px',
                        color: 'var(--text-secondary)',
                        cursor: 'pointer',
                        fontSize: '12px',
                      }}
                    >
                      Upload Custom Model (.glb)
                    </button>
                  </>
                ) : (
                  <>
                    {/* Custom model info with preview */}
                    <div style={{
                      padding: '12px',
                      background: 'var(--bg-tertiary)',
                      borderRadius: '8px',
                      border: '1px solid var(--accent-cyan)',
                    }}>
                      {/* 3D Preview for custom model */}
                      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '12px' }}>
                        <ModelPreview
                          customModelFile={customModelFile || undefined}
                          customModelUrl={!customModelFile && editingClassId ? apiUrl(`/api/custom-models/${editingClassId}`) : undefined}
                          modelScale={modelScale}
                          modelOffset={{ x: modelOffsetX, y: modelOffsetY, z: modelOffsetZ }}
                          idleAnimation={animationMapping.idle !== undefined ? animationMapping.idle : ''}
                          width={120}
                          height={150}
                        />
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
                        <div>
                          <div style={{ fontSize: '12px', fontWeight: 500, color: 'var(--accent-cyan)' }}>
                            Custom Model
                          </div>
                          <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '2px' }}>
                            {customModelFile ? `${customModelFile.name} (${formatFileSize(customModelFile.size)})` : 'Uploaded'}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={handleRemoveCustomModel}
                          style={{
                            padding: '4px 8px',
                            background: 'transparent',
                            border: '1px solid var(--accent-red)',
                            borderRadius: '4px',
                            color: 'var(--accent-red)',
                            cursor: 'pointer',
                            fontSize: '10px',
                          }}
                        >
                          Remove
                        </button>
                      </div>

                      {/* Model Scale slider (exponential for better range control) */}
                      <div style={{ marginBottom: '12px' }}>
                        <label style={{ fontSize: '11px', color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>
                          Model Scale: {modelScale.toFixed(3)}x
                        </label>
                        <input
                          type="range"
                          min="0"
                          max="100"
                          step="1"
                          value={Math.log(modelScale / 0.01) / Math.log(10000) * 100}
                          onChange={(e) => {
                            // Exponential mapping: slider 0-100 maps to scale 0.01-100.0
                            // Using formula: scale = 0.01 * 10000^(slider/100)
                            const sliderValue = parseFloat(e.target.value);
                            const scale = 0.01 * Math.pow(10000, sliderValue / 100);
                            setModelScale(Math.round(scale * 1000) / 1000);
                          }}
                          style={{ width: '100%' }}
                        />
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '9px', color: 'var(--text-muted)', marginTop: '2px' }}>
                          <span>0.01x</span>
                          <span>1x</span>
                          <span>100x</span>
                        </div>
                      </div>

                      {/* Model Position Offset sliders */}
                      <div style={{ marginBottom: '12px' }}>
                        <label style={{ fontSize: '11px', color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>
                          Position Offset X: {modelOffsetX.toFixed(2)}
                        </label>
                        <input
                          type="range"
                          min="-1"
                          max="1"
                          step="0.01"
                          value={modelOffsetX}
                          onChange={(e) => setModelOffsetX(parseFloat(e.target.value))}
                          style={{ width: '100%' }}
                        />
                      </div>

                      <div style={{ marginBottom: '12px' }}>
                        <label style={{ fontSize: '11px', color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>
                          Position Offset Y: {modelOffsetY.toFixed(2)}
                        </label>
                        <input
                          type="range"
                          min="-1"
                          max="1"
                          step="0.01"
                          value={modelOffsetY}
                          onChange={(e) => setModelOffsetY(parseFloat(e.target.value))}
                          style={{ width: '100%' }}
                        />
                      </div>

                      <div style={{ marginBottom: '12px' }}>
                        <label style={{ fontSize: '11px', color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>
                          Position Offset Z (Height): {modelOffsetZ.toFixed(2)}
                        </label>
                        <input
                          type="range"
                          min="-3"
                          max="3"
                          step="0.01"
                          value={modelOffsetZ}
                          onChange={(e) => setModelOffsetZ(parseFloat(e.target.value))}
                          style={{ width: '100%' }}
                        />
                      </div>

                      {/* Animation mapping */}
                      {customModelAnimations.length > 0 && (
                        <div>
                          <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '8px' }}>
                            Animation Mapping ({customModelAnimations.length} detected)
                          </div>

                          {/* Idle animation */}
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                            <span style={{ fontSize: '11px', color: 'var(--text-primary)', width: '60px' }}>Idle:</span>
                            <select
                              value={animationMapping.idle || ''}
                              onChange={(e) => setAnimationMapping(prev => ({ ...prev, idle: e.target.value || undefined }))}
                              style={{
                                flex: 1,
                                padding: '4px 8px',
                                background: 'var(--bg-secondary)',
                                border: '1px solid var(--border-color)',
                                borderRadius: '4px',
                                color: 'var(--text-primary)',
                                fontSize: '11px',
                              }}
                            >
                              <option value="">None</option>
                              {customModelAnimations.map(anim => (
                                <option key={anim} value={anim}>{anim}</option>
                              ))}
                            </select>
                          </div>

                          {/* Walk animation */}
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                            <span style={{ fontSize: '11px', color: 'var(--text-primary)', width: '60px' }}>Walk:</span>
                            <select
                              value={animationMapping.walk || ''}
                              onChange={(e) => setAnimationMapping(prev => ({ ...prev, walk: e.target.value || undefined }))}
                              style={{
                                flex: 1,
                                padding: '4px 8px',
                                background: 'var(--bg-secondary)',
                                border: '1px solid var(--border-color)',
                                borderRadius: '4px',
                                color: 'var(--text-primary)',
                                fontSize: '11px',
                              }}
                            >
                              <option value="">None</option>
                              {customModelAnimations.map(anim => (
                                <option key={anim} value={anim}>{anim}</option>
                              ))}
                            </select>
                          </div>

                          {/* Working animation */}
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <span style={{ fontSize: '11px', color: 'var(--text-primary)', width: '60px' }}>Working:</span>
                            <select
                              value={animationMapping.working || ''}
                              onChange={(e) => setAnimationMapping(prev => ({ ...prev, working: e.target.value || undefined }))}
                              style={{
                                flex: 1,
                                padding: '4px 8px',
                                background: 'var(--bg-secondary)',
                                border: '1px solid var(--border-color)',
                                borderRadius: '4px',
                                color: 'var(--text-primary)',
                                fontSize: '11px',
                              }}
                            >
                              <option value="">None (bounce)</option>
                              {customModelAnimations.map(anim => (
                                <option key={anim} value={anim}>{anim}</option>
                              ))}
                            </select>
                          </div>
                        </div>
                      )}

                      {customModelAnimations.length === 0 && (
                        <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontStyle: 'italic' }}>
                          No animations detected in this model
                        </div>
                      )}
                    </div>

                    {/* Change model button */}
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      style={{
                        width: '100%',
                        marginTop: '8px',
                        padding: '6px 12px',
                        background: 'var(--bg-secondary)',
                        border: '1px solid var(--border-color)',
                        borderRadius: '6px',
                        color: 'var(--text-secondary)',
                        cursor: 'pointer',
                        fontSize: '11px',
                      }}
                    >
                      Replace with Different Model
                    </button>
                  </>
                )}

                {/* Error message */}
                {modelUploadError && (
                  <div style={{
                    marginTop: '8px',
                    padding: '8px',
                    background: 'rgba(255, 85, 85, 0.1)',
                    border: '1px solid var(--accent-red)',
                    borderRadius: '4px',
                    fontSize: '11px',
                    color: 'var(--accent-red)',
                  }}>
                    {modelUploadError}
                  </div>
                )}
              </div>

              <div style={{ display: 'flex', gap: '12px', marginBottom: '12px' }}>
                <div className="form-section" style={{ flex: '0 0 80px' }}>
                  <label className="form-label">Icon</label>
                  <EmojiPicker value={classIcon} onChange={setClassIcon} />
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
              <button className="btn btn-secondary" onClick={() => setShowClassEditor(false)} disabled={isUploadingModel}>
                Cancel
              </button>
              <button
                className="btn btn-primary"
                onClick={handleSaveClass}
                disabled={!className.trim() || isUploadingModel}
              >
                {isUploadingModel ? 'Uploading...' : (editingClassId ? 'Save Changes' : 'Create Class')}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
