import { beforeEach, describe, expect, it, vi } from 'vitest';
import { STORAGE_KEYS } from '../../utils/storage';
import {
  DEFAULT_THREE_VIEWER_PREFERENCES,
  getThreeViewerPreferences,
  setThreeViewerPreferences,
} from './threeViewerPreferences';

describe('threeViewerPreferences', () => {
  const values = new Map<string, string>();

  beforeEach(() => {
    values.clear();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    });
  });

  it('uses defaults before any viewer setting is saved', () => {
    expect(getThreeViewerPreferences()).toEqual(DEFAULT_THREE_VIEWER_PREFERENCES);
  });

  it('persists partial updates without losing other viewer settings', () => {
    setThreeViewerPreferences({ modelColor: '#ff00aa', modelOpacity: 45 });
    setThreeViewerPreferences({ lightIntensity: 135 });

    expect(getThreeViewerPreferences()).toMatchObject({
      modelColor: '#ff00aa',
      modelOpacity: 45,
      lightIntensity: 135,
      backgroundColor: DEFAULT_THREE_VIEWER_PREFERENCES.backgroundColor,
    });
    expect(values.has(STORAGE_KEYS.THREE_VIEWER_SETTINGS)).toBe(true);
  });
});
