import { SceneManager } from '../scene/SceneManager';
import { disconnect, clearCallbacks } from '../websocket';

// Session storage key to track if we had an active WebGL context
const WEBGL_SESSION_KEY = 'tide_webgl_active';

// Window extensions for HMR and back navigation
declare global {
  interface Window {
    __tideSetBackNavModal?: (show: boolean) => void;
    __tideBackNavSetup?: boolean;
    __tideHistoryDepth?: number;
    __tideAppInitialized?: boolean;
    // HMR-persistent state - survives module re-evaluation
    __tidePersistedScene?: SceneManager | null;
    __tidePersistedCanvas?: HTMLCanvasElement | null;
    __tideWsConnected?: boolean;
    __tideIsPageUnloading?: boolean;
  }
}

// Initialize HMR-persistent state on window if not present
if (typeof window !== 'undefined') {
  if (window.__tidePersistedScene === undefined) window.__tidePersistedScene = null;
  if (window.__tidePersistedCanvas === undefined) window.__tidePersistedCanvas = null;
  if (window.__tideWsConnected === undefined) window.__tideWsConnected = false;
  if (window.__tideIsPageUnloading === undefined) window.__tideIsPageUnloading = false;
}

// Getters/setters that read from window for HMR persistence
export function getPersistedScene(): SceneManager | null {
  return typeof window !== 'undefined' ? window.__tidePersistedScene ?? null : null;
}

export function getPersistedCanvas(): HTMLCanvasElement | null {
  return typeof window !== 'undefined' ? window.__tidePersistedCanvas ?? null : null;
}

export function getWsConnected(): boolean {
  return typeof window !== 'undefined' ? window.__tideWsConnected ?? false : false;
}

export function getIsPageUnloading(): boolean {
  return typeof window !== 'undefined' ? window.__tideIsPageUnloading ?? false : false;
}

export function setPersistedScene(scene: SceneManager | null): void {
  if (typeof window !== 'undefined') {
    window.__tidePersistedScene = scene;
  }
}

export function setPersistedCanvas(canvas: HTMLCanvasElement | null): void {
  if (typeof window !== 'undefined') {
    window.__tidePersistedCanvas = canvas;
  }
}

export function setWsConnected(connected: boolean): void {
  if (typeof window !== 'undefined') {
    window.__tideWsConnected = connected;
  }
}

export function setIsPageUnloading(unloading: boolean): void {
  if (typeof window !== 'undefined') {
    window.__tideIsPageUnloading = unloading;
  }
}

export function markWebGLActive(): void {
  sessionStorage.setItem(WEBGL_SESSION_KEY, 'true');
}

/**
 * Cleanup function to dispose scene - called from multiple unload events
 */
export function cleanupScene(_source: string): void {
  setIsPageUnloading(true);

  // Clear the session flag to indicate clean shutdown
  sessionStorage.removeItem(WEBGL_SESSION_KEY);

  // Disconnect WebSocket and clear all callbacks FIRST to prevent them from holding references
  disconnect();
  clearCallbacks();

  // Clear debug reference BEFORE dispose to break reference chains
  if ((window as any).__tideScene) {
    (window as any).__tideScene = null;
  }

  const scene = getPersistedScene();
  if (scene) {
    console.log('[App] Calling persistedScene.dispose()');
    scene.dispose();
    setPersistedScene(null);
  } else {
    console.log('[App] No persistedScene to dispose');
  }

  setPersistedCanvas(null);
  setWsConnected(false);

  // Remove canvas from DOM to help browser release WebGL context
  const canvas = document.getElementById('battlefield');
  if (canvas) {
    canvas.remove();
  }

  // Clear the app container to remove all React nodes
  const app = document.getElementById('app');
  if (app) {
    app.innerHTML = '';
  }
}

/**
 * Clean up stale WebGL contexts from previous sessions.
 * Called on page load to handle bfcache or reload preserved old memory.
 * IMPORTANT: Skip this cleanup during Vite HMR - the scene is still valid!
 */
function cleanupStaleContexts(): void {
  // Detect if this is an HMR reload vs a full page load
  if (window.__tideAppInitialized) {
    return;
  }

  // Mark that the app has been initialized (will persist through HMR)
  window.__tideAppInitialized = true;

  // Check if previous session didn't clean up properly
  const hadActiveContext = sessionStorage.getItem(WEBGL_SESSION_KEY) === 'true';
  if (hadActiveContext) {
    console.log('[App] Detected unclean shutdown from previous session - forcing cleanup');
  }

  // Clear any stale global references
  if ((window as any).__tideScene) {
    console.log('[App] Cleaning up stale __tideScene reference');
    try {
      (window as any).__tideScene.dispose?.();
    } catch {
      // May already be disposed
    }
    (window as any).__tideScene = null;
  }

  // Clear persistedScene if it exists from a previous load
  const staleScene = getPersistedScene();
  if (staleScene) {
    console.log('[App] Cleaning up stale persistedScene');
    try {
      staleScene.dispose();
    } catch {
      // May already be disposed
    }
    setPersistedScene(null);
  }

  // Remove any existing battlefield canvas from DOM (from bfcache or previous session)
  // IMPORTANT: Only remove if it's truly stale (not the currently active React canvas)
  const existingCanvas = document.getElementById('battlefield') as HTMLCanvasElement | null;
  const persistedCanvas = getPersistedCanvas();
  if (existingCanvas && existingCanvas !== persistedCanvas) {
    existingCanvas.remove();
  }

  // Clear the session flag since we've done cleanup
  sessionStorage.removeItem(WEBGL_SESSION_KEY);
}

/**
 * Initialize page lifecycle handlers for WebGL cleanup.
 * Should be called once at module load time.
 */
export function initializePageLifecycle(): void {
  if (typeof window === 'undefined') return;

  // Clean up stale contexts on page load
  cleanupStaleContexts();

  // Detect bfcache restore and force cleanup
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) {
      console.log('[App] Page restored from bfcache - cleaning up');
      cleanupScene('bfcache-restore');
      window.location.reload();
    }
  });

  // Cleanup handlers for page unload
  window.onunload = () => cleanupScene('onunload');
  window.onbeforeunload = (_e: BeforeUnloadEvent) => {
    cleanupScene('onbeforeunload');
    return undefined;
  };
  window.addEventListener('pagehide', (event) => {
    cleanupScene(`pagehide (persisted=${event.persisted})`);
  });
}

// Auto-initialize on module load
initializePageLifecycle();
