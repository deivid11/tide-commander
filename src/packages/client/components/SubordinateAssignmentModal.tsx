import React, { useState, useEffect } from 'react';
import { store, useAgents, useAgent } from '../store';
import { AGENT_CLASSES } from '../../shared/types';

interface SubordinateAssignmentModalProps {
  isOpen: boolean;
  bossId: string;
  onClose: () => void;
}

export function SubordinateAssignmentModal({ isOpen, bossId, onClose }: SubordinateAssignmentModalProps) {
  const agents = useAgents();
  const boss = useAgent(bossId);
  const [selectedSubordinates, setSelectedSubordinates] = useState<Set<string>>(new Set());
  const [isSaving, setIsSaving] = useState(false);

  // Get available agents (non-boss, and either unassigned or assigned to this boss)
  const availableAgents = Array.from(agents.values()).filter(
    (agent) => agent.class !== 'boss' && (!agent.bossId || agent.bossId === bossId)
  );

  // Initialize selected subordinates when modal opens
  useEffect(() => {
    if (isOpen && boss) {
      setSelectedSubordinates(new Set(boss.subordinateIds || []));
    }
  }, [isOpen, boss]);

  const handleSave = () => {
    setIsSaving(true);
    store.assignSubordinates(bossId, Array.from(selectedSubordinates));

    // Close after a brief delay to show the action
    setTimeout(() => {
      setIsSaving(false);
      onClose();
    }, 300);
  };

  const toggleSubordinate = (agentId: string) => {
    const newSelected = new Set(selectedSubordinates);
    if (newSelected.has(agentId)) {
      newSelected.delete(agentId);
    } else {
      newSelected.add(agentId);
    }
    setSelectedSubordinates(newSelected);
  };

  const selectAll = () => {
    setSelectedSubordinates(new Set(availableAgents.map(a => a.id)));
  };

  const deselectAll = () => {
    setSelectedSubordinates(new Set());
  };

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

  if (!isOpen || !boss) return null;

  const bossConfig = AGENT_CLASSES.boss;
  const currentSubCount = boss.subordinateIds?.length || 0;
  const newSubCount = selectedSubordinates.size;
  const hasChanges = JSON.stringify([...(boss.subordinateIds || [])].sort()) !==
                     JSON.stringify([...selectedSubordinates].sort());

  return (
    <div
      className={`modal-overlay ${isOpen ? 'visible' : ''}`}
      onClick={handleBackdropClick}
      onKeyDown={handleKeyDown}
    >
      <div className="modal subordinate-assignment-modal">
        <div className="modal-header">
          <span className="boss-header-icon" style={{ color: bossConfig.color }}>
            {bossConfig.icon}
          </span>
          Manage Team: {boss.name}
        </div>

        <div className="modal-body subordinate-assignment-body">
          <div className="subordinate-assignment-info">
            <p>Select which agents should report to this boss.</p>
            <div className="subordinate-assignment-actions">
              <button className="btn btn-small" onClick={selectAll}>
                Select All
              </button>
              <button className="btn btn-small" onClick={deselectAll}>
                Clear All
              </button>
            </div>
          </div>

          <div className="subordinates-list">
            {availableAgents.length === 0 ? (
              <div className="subordinates-empty">
                No available agents. Deploy regular agents first.
              </div>
            ) : (
              availableAgents.map((agent) => {
                const isSelected = selectedSubordinates.has(agent.id);
                const classConfig = AGENT_CLASSES[agent.class as keyof typeof AGENT_CLASSES];
                const isCurrentlyAssigned = boss.subordinateIds?.includes(agent.id);

                return (
                  <div
                    key={agent.id}
                    className={`subordinate-item ${isSelected ? 'selected' : ''}`}
                    onClick={() => toggleSubordinate(agent.id)}
                  >
                    <div className="subordinate-checkbox">
                      {isSelected ? '✓' : ''}
                    </div>
                    <div
                      className="subordinate-icon"
                      style={{ color: classConfig.color }}
                    >
                      {classConfig.icon}
                    </div>
                    <div className="subordinate-info">
                      <div className="subordinate-name">{agent.name}</div>
                      <div className="subordinate-class">{agent.class}</div>
                    </div>
                    <div className={`subordinate-status status-${agent.status}`}>
                      {agent.status}
                    </div>
                    {isCurrentlyAssigned && (
                      <div className="subordinate-badge">current</div>
                    )}
                  </div>
                );
              })
            )}
          </div>

          <div className="subordinate-assignment-summary">
            {hasChanges ? (
              <span className="summary-changed">
                {currentSubCount} → {newSubCount} subordinates
              </span>
            ) : (
              <span className="summary-unchanged">
                {currentSubCount} subordinate{currentSubCount !== 1 ? 's' : ''}
              </span>
            )}
          </div>
        </div>

        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-boss"
            onClick={handleSave}
            disabled={isSaving || !hasChanges}
          >
            {isSaving ? 'Saving...' : 'Save Team'}
          </button>
        </div>
      </div>
    </div>
  );
}
