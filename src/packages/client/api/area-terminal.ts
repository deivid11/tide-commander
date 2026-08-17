/**
 * Area terminal API — start/stop an area's zero-config default terminal
 * (ttyd + tmux cwd'd to the area's folder). No terminal building required;
 * every area gets one for free.
 */
import { getAuthToken, getApiBaseUrl } from '../utils/storage';

/**
 * Statusbar/dock id for an area's default terminal. Shares the buildingId
 * slots of the embedded-panel plumbing without colliding with real building
 * ids (`building_*`).
 */
export function areaTerminalId(areaId: string): string {
  return `area-${areaId}`;
}

export function isAreaTerminalId(id: string): boolean {
  return id.startsWith('area-');
}

/** The areaId back out of an areaTerminalId(). */
export function areaIdFromTerminalId(id: string): string {
  return id.slice('area-'.length);
}

/**
 * Start (or reuse) the area's default terminal. Returns the proxy URL to pass
 * to <TerminalEmbed>. Idempotent server-side; throws with a readable message
 * on failure.
 */
export async function startAreaTerminal(areaId: string): Promise<{ url: string }> {
  const token = getAuthToken();
  const response = await fetch(`${getApiBaseUrl()}/api/areas/${areaId}/terminal`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}` },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body?.error || `Failed to start area terminal (${response.status})`);
  }
  return response.json();
}

/** Stop the area's terminal viewer (the tmux session keeps running). */
export async function stopAreaTerminal(areaId: string): Promise<void> {
  const token = getAuthToken();
  await fetch(`${getApiBaseUrl()}/api/areas/${areaId}/terminal`, {
    method: 'DELETE',
    headers: { 'Authorization': `Bearer ${token}` },
  });
}
