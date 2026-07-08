/**
 * Per-building view-mode preference: whether a dockable building surface
 * (terminal, PM2 logs, database, tests, HTTP requests) last opened as a
 * compact bottom panel ("dock") or as its full modal ("modal"). The statusbar
 * shortcut buttons honor the saved mode, and the explicit minimize/maximize
 * buttons update it — so each building reopens the way the user left it.
 */

import { store } from '../store';

export type DockPanelType = 'terminal' | 'pm2-logs' | 'database' | 'tests' | 'http';
export type BuildingViewMode = 'dock' | 'modal';

const LS_KEY = 'tide:building-view-modes';

function readModes(): Record<string, BuildingViewMode> {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, BuildingViewMode>;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function getBuildingViewMode(buildingId: string): BuildingViewMode | null {
  return readModes()[buildingId] ?? null;
}

export function setBuildingViewMode(buildingId: string, mode: BuildingViewMode): void {
  try {
    const modes = readModes();
    if (modes[buildingId] === mode) return;
    modes[buildingId] = mode;
    localStorage.setItem(LS_KEY, JSON.stringify(modes));
  } catch {
    /* quota/private mode — preference just won't stick */
  }
}

/**
 * Minimize a building into a compact bottom panel and remember the choice.
 * Host resolution: the flat-view chat pane takes it when flat mode is the
 * visible surface (guake closed) AND the building belongs to the pane's area
 * (the listener sets `handled`); otherwise it docks under the Guake terminal
 * input, opening the guake if needed.
 */
export function dockBuilding(buildingId: string, type: DockPanelType): void {
  setBuildingViewMode(buildingId, 'dock');
  const state = store.getState();
  if (type === 'terminal') {
    // The dock shows "starting…" until the terminal has a URL — kick it off.
    const building = state.buildings.get(buildingId);
    if (building && !building.terminalStatus?.url) {
      store.sendBuildingCommand(buildingId, 'start');
    }
  }
  if (state.viewMode === 'flat' && !state.terminalOpen) {
    const detail = { buildingId, type, handled: false };
    window.dispatchEvent(new CustomEvent('tide:dock-building-flat', { detail }));
    if (detail.handled) return;
  }
  store.setTerminalOpen(true);
  window.dispatchEvent(new CustomEvent(`tide:open-bottom-${type}`, { detail: { buildingId } }));
}

/**
 * Maximize a building into its rich modal and remember the choice. Routing per
 * building type (PM2/Docker logs, database grid, tests browser, HTTP browser,
 * terminal modal) lives in App's `tide:building-action` handler.
 */
export function expandBuilding(buildingId: string): void {
  setBuildingViewMode(buildingId, 'modal');
  window.dispatchEvent(new CustomEvent('tide:building-action', { detail: { buildingId } }));
}
