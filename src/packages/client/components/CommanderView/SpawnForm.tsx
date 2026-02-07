/**
 * SpawnForm component for adding new agents in CommanderView
 */

import React, { useState } from 'react';
import type { DrawingArea, AgentClass, AgentProvider } from '../../../shared/types';
import { AGENT_CLASS_CONFIG, DEFAULT_NAMES, CHARACTER_MODELS } from '../../scene/config';
import { store } from '../../store';
import { STORAGE_KEYS, getStorageString, setStorageString } from '../../utils/storage';
import { FolderInput } from '../shared/FolderInput';

interface SpawnFormProps {
  currentArea: DrawingArea | null;
  onClose: () => void;
}

export function SpawnForm({ currentArea, onClose }: SpawnFormProps) {
  const [name, setName] = useState(() => {
    const usedNames = new Set(Array.from(store.getState().agents.values()).map(a => a.name));
    return DEFAULT_NAMES.find(n => !usedNames.has(n)) || `Agent-${Date.now().toString(36)}`;
  });
  const [cwd, setCwd] = useState(() => getStorageString(STORAGE_KEYS.LAST_CWD));
  const [selectedClass, setSelectedClass] = useState<AgentClass>('scout');
  const [selectedProvider, setSelectedProvider] = useState<AgentProvider>('claude');
  const [isSpawning, setIsSpawning] = useState(false);

  const handleSpawn = () => {
    if (!name.trim() || !cwd.trim()) return;

    setIsSpawning(true);
    setStorageString(STORAGE_KEYS.LAST_CWD, cwd);

    // Calculate position based on area center
    let position: { x: number; z: number } | undefined;
    if (currentArea) {
      // Place in center of area
      position = {
        x: currentArea.center.x,
        z: currentArea.center.z,
      };
    }

    store.spawnAgent(
      name.trim(),
      selectedClass,
      cwd.trim(),
      position,
      undefined,
      undefined,
      undefined,
      undefined,
      selectedProvider,
    );

    // Close after a short delay
    setTimeout(() => {
      onClose();
    }, 500);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSpawn();
    }
    if (e.key === 'Escape') {
      onClose();
    }
  };

  return (
    <div className="commander-spawn-overlay" onClick={onClose}>
      <div className="commander-spawn-form" onClick={e => e.stopPropagation()}>
        <div className="commander-spawn-header">
          <h3>Add New Agent</h3>
          {currentArea && (
            <span className="commander-spawn-area">
              <span className="commander-spawn-area-dot" style={{ background: currentArea.color }} />
              {currentArea.name}
            </span>
          )}
        </div>

        <div className="commander-spawn-body">
          <div className="commander-spawn-field">
            <label>Name</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              onKeyDown={handleKeyDown}
              autoFocus
            />
          </div>

          <div className="commander-spawn-field">
            <label>Working Directory</label>
            <FolderInput
              value={cwd}
              onChange={setCwd}
              onSubmit={handleSpawn}
              placeholder="/path/to/project"
              directoriesOnly={true}
            />
          </div>

          <div className="commander-spawn-field">
            <label>Class</label>
            <div className="commander-spawn-classes">
              {CHARACTER_MODELS.map(char => {
                const config = AGENT_CLASS_CONFIG[char.id];
                return (
                  <button
                    key={char.id}
                    className={`commander-spawn-class ${selectedClass === char.id ? 'selected' : ''}`}
                    onClick={() => setSelectedClass(char.id)}
                  >
                    <span className="commander-spawn-class-icon">{config.icon}</span>
                    <span>{char.name}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="commander-spawn-field">
            <label>Runtime</label>
            <div className="commander-spawn-classes">
              <button
                className={`commander-spawn-class ${selectedProvider === 'claude' ? 'selected' : ''}`}
                onClick={() => setSelectedProvider('claude')}
              >
                <span className="commander-spawn-class-icon">🧠</span>
                <span>Claude</span>
              </button>
              <button
                className={`commander-spawn-class ${selectedProvider === 'codex' ? 'selected' : ''}`}
                onClick={() => setSelectedProvider('codex')}
              >
                <span className="commander-spawn-class-icon">⚙️</span>
                <span>Codex</span>
              </button>
            </div>
          </div>
        </div>

        <div className="commander-spawn-footer">
          <button className="commander-spawn-cancel" onClick={onClose}>
            Cancel
          </button>
          <button
            className="commander-spawn-submit"
            onClick={handleSpawn}
            disabled={!name.trim() || !cwd.trim() || isSpawning}
          >
            {isSpawning ? 'Deploying...' : 'Deploy Agent'}
          </button>
        </div>
      </div>
    </div>
  );
}
