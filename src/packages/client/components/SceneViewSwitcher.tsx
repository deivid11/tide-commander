/**
 * SceneViewSwitcher - Toggle between 2D and 3D scene views
 *
 * Allows users to switch between the full 3D Three.js scene and
 * the lightweight 2D Canvas view while preserving coordinates and state.
 */

import { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { STORAGE_KEYS, getStorageString, setStorageString } from '../utils/storage';
import './SceneViewSwitcher.scss';

export type SceneViewMode = '2d' | '3d';

interface SceneViewSwitcherProps {
  mode: SceneViewMode;
  onModeChange: (mode: SceneViewMode) => void;
  className?: string;
}

export function SceneViewSwitcher({ mode, onModeChange, className = '' }: SceneViewSwitcherProps) {
  const { t } = useTranslation(['terminal']);
  return (
    <div className={`scene-view-switcher ${className}`}>
      <button
        className={`switcher-btn ${mode === '2d' ? 'active' : ''}`}
        onClick={() => onModeChange('2d')}
        title={t('terminal:sceneView.view2d')}
      >
        <span className="icon">2D</span>
      </button>
      <button
        className={`switcher-btn ${mode === '3d' ? 'active' : ''}`}
        onClick={() => onModeChange('3d')}
        title={t('terminal:sceneView.view3d')}
      >
        <span className="icon">3D</span>
      </button>
    </div>
  );
}

/**
 * Hook for managing scene view mode with localStorage persistence
 */
export function useSceneViewMode(defaultMode: SceneViewMode = '3d') {
  const [mode, setMode] = useState<SceneViewMode>(() => {
    const saved = getStorageString(STORAGE_KEYS.SCENE_VIEW_MODE, defaultMode);
    return (saved === '2d' || saved === '3d') ? saved : defaultMode;
  });

  const setModeWithPersist = useCallback((newMode: SceneViewMode) => {
    setMode(newMode);
    setStorageString(STORAGE_KEYS.SCENE_VIEW_MODE, newMode);
  }, []);

  return [mode, setModeWithPersist] as const;
}
