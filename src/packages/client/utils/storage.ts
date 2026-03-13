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
  AUTH_TOKEN: 'tide-auth-token',

  // Scene view mode (2d/3d/dashboard)
  SCENE_VIEW_MODE: 'tide-scene-view-mode',

  // Camera
  CAMERA_STATE: 'tide-camera-state',
  CAMERA_STATE_2D: 'tide-camera-state-2d',

  // Terminal/Guake
  VIEW_MODE: 'guake-view-mode',
  ADVANCED_VIEW: 'guake-advanced-view', // Legacy key
  TERMINAL_HEIGHT: 'guake-terminal-height',
  TERMINAL_FULLSCREEN: 'guake-terminal-fullscreen',
  INPUT_TEXT_PREFIX: 'guake-input-',
  PASTED_TEXTS_PREFIX: 'guake-pasted-',

  // Commander
  COMMANDER_TAB: 'commander-active-tab',
  COMMANDER_FILTERS: 'commander-filters',

  // Spawn/CWD
  LAST_CWD: 'tide-last-cwd',

  // UI State
  GLOBAL_SUPERVISOR_COLLAPSED: 'tide-global-supervisor-collapsed',
  TOOLS_COLLAPSED: 'tide-tool-history-collapsed',
  FILES_COLLAPSED: 'tide-file-history-collapsed',
  MOBILE_VIEW: 'tide-mobile-view',

  // File Explorer
  TREE_PANEL_WIDTH: 'tide-tree-panel-width',
  MOBILE_TREE_PANEL_HEIGHT: 'tide-mobile-tree-panel-height',

  // Agent Bar
  AGENT_ORDER: 'tide-agent-order',

  // Agent Overview Panel
  AOP_CONFIG: 'tide-aop-config',
  AOP_OPEN: 'tide-aop-open',
  MOBILE_OVERVIEW_HEIGHT: 'tide-mobile-overview-height',

  // Git Panel
  GIT_PANEL_OPEN: 'guake-git-panel-open',
  GIT_PANEL_MODE: 'guake-git-panel-mode',
  GIT_PANEL_VIEW_MODE: 'guake-git-view-mode',
  GIT_PANEL_FOLDER_IDX: 'guake-git-folder-idx',

  // Buildings Panel
  BUILDINGS_PANEL_OPEN: 'guake-buildings-panel-open',

  // Side panel width (shared by overview, git, buildings, debug panels)
  SIDE_PANEL_WIDTH: 'guake-side-panel-width',

  // Agent notifications
  UNSEEN_AGENTS: 'tide-unseen-agents',
} as const;

export const BACKEND_URL_CHANGE_EVENT = 'tide-backend-url-change';

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
 * Uses configured backend URL, dev default, or same-origin in production.
 */
export function getApiBaseUrl(): string {
  const configuredUrl = getBackendUrl();
  if (configuredUrl) {
    // Remove trailing slash if present
    return configuredUrl.replace(/\/$/, '');
  }

  // In dev, frontend (Vite) and backend run on different ports.
  if (import.meta.env.DEV) {
    const defaultPort = typeof __SERVER_PORT__ !== 'undefined' ? __SERVER_PORT__ : 6200;
    const apiProtocol = window.location.protocol === 'https:' ? 'https' : 'http';
    return `${apiProtocol}://localhost:${defaultPort}`;
  }

  // In production, use the same host that served the UI.
  return `${window.location.protocol}//${window.location.host}`;
}

/**
 * Get the configured auth token
 */
export function getAuthToken(): string {
  return getStorageString(STORAGE_KEYS.AUTH_TOKEN, '');
}

/**
 * Get the configured backend URL.
 */
export function getBackendUrl(): string {
  return getStorageString(STORAGE_KEYS.BACKEND_URL, '');
}

/**
 * Set the configured backend URL and notify listeners in this window.
 */
export function setBackendUrl(url: string): void {
  const nextUrl = url.trim();
  setStorageString(STORAGE_KEYS.BACKEND_URL, nextUrl);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent<string>(BACKEND_URL_CHANGE_EVENT, { detail: nextUrl }));
  }
}

/**
 * Subscribe to backend URL changes from both in-window updates and cross-tab storage updates.
 */
export function subscribeBackendUrlChange(onChange: (url: string) => void): () => void {
  if (typeof window === 'undefined') {
    return () => {};
  }

  const handleCustomEvent = (event: Event) => {
    const customEvent = event as CustomEvent<string>;
    onChange(customEvent.detail);
  };

  const handleStorageEvent = (event: StorageEvent) => {
    if (event.key !== STORAGE_KEYS.BACKEND_URL) {
      return;
    }
    onChange(event.newValue ?? '');
  };

  window.addEventListener(BACKEND_URL_CHANGE_EVENT, handleCustomEvent);
  window.addEventListener('storage', handleStorageEvent);

  return () => {
    window.removeEventListener(BACKEND_URL_CHANGE_EVENT, handleCustomEvent);
    window.removeEventListener('storage', handleStorageEvent);
  };
}

/**
 * Build a full API URL from a path
 * @param path - API path starting with /api (e.g., '/api/agents')
 */
export function apiUrl(path: string): string {
  return `${getApiBaseUrl()}${path}`;
}

/**
 * Get headers for authenticated API requests
 */
export function getAuthHeaders(): HeadersInit {
  const token = getAuthToken();
  if (token) {
    return {
      'X-Auth-Token': token,
    };
  }
  return {};
}

/**
 * Make an authenticated fetch request
 * Automatically adds auth token header if configured
 */
export async function authFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const token = getAuthToken();
  const headers = new Headers(init?.headers);

  if (token) {
    headers.set('X-Auth-Token', token);
  }

  return fetch(input, {
    ...init,
    headers,
    cache: 'no-store',
  });
}

/**
 * Build an authenticated URL by appending the auth token as a query parameter.
 * Use this for XHR requests (e.g., Three.js loaders) that don't support custom headers.
 * @param url - The URL to authenticate (can be relative or absolute)
 * @returns URL with token query parameter if auth is configured
 */
export function authUrl(url: string): string {
  const token = getAuthToken();
  if (!token) {
    return url;
  }

  // Parse URL and add token parameter
  try {
    // Handle relative URLs by using a dummy base
    const isRelative = !url.startsWith('http://') && !url.startsWith('https://');
    const base = isRelative ? 'http://dummy' : undefined;
    const urlObj = new URL(url, base);
    urlObj.searchParams.set('token', token);
    // Return relative URL if input was relative
    return isRelative ? urlObj.pathname + urlObj.search : urlObj.toString();
  } catch {
    // Fallback: simple string append
    const separator = url.includes('?') ? '&' : '?';
    return `${url}${separator}token=${encodeURIComponent(token)}`;
  }
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
