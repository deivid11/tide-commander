/**
 * Centralized localStorage wrapper with type safety and error handling
 * Use this module for all persistent client-side storage
 */

/**
 * Storage keys used throughout the application
 * Centralizing keys helps prevent typos and makes it easy to find all storage usage
 */
export const STORAGE_KEYS = {
  // App config
  CONFIG: 'tide-commander-config',
  SHOW_FPS: 'tide-show-fps',
  SETTINGS: 'tide-settings',
  SHORTCUTS: 'tide-shortcuts',
  MOUSE_CONTROLS: 'tide-mouse-controls',
  BACKEND_URL: 'tide-backend-url',

  // Camera
  CAMERA_STATE: 'tide-camera-state',

  // Terminal/Guake
  VIEW_MODE: 'guake-view-mode',
  ADVANCED_VIEW: 'guake-advanced-view', // Legacy key
  TERMINAL_HEIGHT: 'guake-terminal-height',
  INPUT_TEXT_PREFIX: 'guake-input-',
  PASTED_TEXTS_PREFIX: 'guake-pasted-',

  // Commander
  COMMANDER_TAB: 'commander-active-tab',

  // Spawn/CWD
  LAST_CWD: 'tide-last-cwd',

  // UI State
  GLOBAL_SUPERVISOR_COLLAPSED: 'tide-global-supervisor-collapsed',
  TOOLS_COLLAPSED: 'tide-tool-history-collapsed',
  FILES_COLLAPSED: 'tide-file-history-collapsed',
  MOBILE_VIEW: 'tide-mobile-view',
} as const;

/**
 * Get a value from localStorage with type safety
 * Returns the default value if the key doesn't exist or parsing fails
 */
export function getStorage<T>(key: string, defaultValue: T): T {
  try {
    const stored = localStorage.getItem(key);
    if (stored === null) {
      return defaultValue;
    }
    return JSON.parse(stored) as T;
  } catch {
    return defaultValue;
  }
}

/**
 * Get a raw string value from localStorage
 * Returns the default value if the key doesn't exist
 */
export function getStorageString(key: string, defaultValue: string = ''): string {
  try {
    return localStorage.getItem(key) ?? defaultValue;
  } catch {
    return defaultValue;
  }
}

/**
 * Get a boolean value from localStorage
 * Returns the default value if the key doesn't exist
 */
export function getStorageBoolean(key: string, defaultValue: boolean = false): boolean {
  try {
    const stored = localStorage.getItem(key);
    if (stored === null) {
      return defaultValue;
    }
    return stored === 'true';
  } catch {
    return defaultValue;
  }
}

/**
 * Get a numeric value from localStorage
 * Returns the default value if the key doesn't exist or is not a valid number
 */
export function getStorageNumber(key: string, defaultValue: number): number {
  try {
    const stored = localStorage.getItem(key);
    if (stored === null) {
      return defaultValue;
    }
    const parsed = Number(stored);
    return isNaN(parsed) ? defaultValue : parsed;
  } catch {
    return defaultValue;
  }
}

/**
 * Set a value in localStorage with JSON serialization
 */
export function setStorage<T>(key: string, value: T): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    console.error(`Failed to save to localStorage: ${key}`, error);
  }
}

/**
 * Set a raw string value in localStorage
 */
export function setStorageString(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch (error) {
    console.error(`Failed to save to localStorage: ${key}`, error);
  }
}

/**
 * Set a boolean value in localStorage
 */
export function setStorageBoolean(key: string, value: boolean): void {
  try {
    localStorage.setItem(key, String(value));
  } catch (error) {
    console.error(`Failed to save to localStorage: ${key}`, error);
  }
}

/**
 * Set a numeric value in localStorage
 */
export function setStorageNumber(key: string, value: number): void {
  try {
    localStorage.setItem(key, String(value));
  } catch (error) {
    console.error(`Failed to save to localStorage: ${key}`, error);
  }
}

/**
 * Remove a value from localStorage
 */
export function removeStorage(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch (error) {
    console.error(`Failed to remove from localStorage: ${key}`, error);
  }
}

/**
 * Check if a key exists in localStorage
 */
export function hasStorage(key: string): boolean {
  try {
    return localStorage.getItem(key) !== null;
  } catch {
    return false;
  }
}

/**
 * Get the backend API base URL
 * Uses configured backend URL or defaults to 127.0.0.1:5174
 */
export function getApiBaseUrl(): string {
  const configuredUrl = getStorageString(STORAGE_KEYS.BACKEND_URL, '');
  if (configuredUrl) {
    // Remove trailing slash if present
    return configuredUrl.replace(/\/$/, '');
  }
  return 'http://127.0.0.1:5174';
}

/**
 * Build a full API URL from a path
 * @param path - API path starting with /api (e.g., '/api/agents')
 */
export function apiUrl(path: string): string {
  return `${getApiBaseUrl()}${path}`;
}

/**
 * Clear all tide-commander related storage
 * Use with caution!
 */
export function clearAllStorage(): void {
  try {
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && (key.startsWith('tide-') || key.startsWith('guake-') || key.startsWith('commander-'))) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach(key => localStorage.removeItem(key));
  } catch (error) {
    console.error('Failed to clear storage', error);
  }
}
