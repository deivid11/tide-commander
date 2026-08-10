import { getStorage, setStorage, STORAGE_KEYS } from '../../utils/storage';

export interface ThreeViewerPreferences {
  modelColor: string;
  backgroundColor: string;
  lightIntensity: number;
  modelOpacity: number;
  showEdges: boolean;
  preserveModelColors: boolean;
}

export const DEFAULT_THREE_VIEWER_PREFERENCES: ThreeViewerPreferences = {
  modelColor: '#58c7d9',
  backgroundColor: '#11141a',
  lightIntensity: 100,
  modelOpacity: 100,
  showEdges: true,
  preserveModelColors: true,
};

export function getThreeViewerPreferences(): ThreeViewerPreferences {
  const saved = getStorage<Partial<ThreeViewerPreferences>>(STORAGE_KEYS.THREE_VIEWER_SETTINGS, {});
  return { ...DEFAULT_THREE_VIEWER_PREFERENCES, ...saved };
}

export function setThreeViewerPreferences(preferences: Partial<ThreeViewerPreferences>): void {
  setStorage(STORAGE_KEYS.THREE_VIEWER_SETTINGS, {
    ...getThreeViewerPreferences(),
    ...preferences,
  });
}
