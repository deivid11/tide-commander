/**
 * WebSocket callback registry.
 * Scene, UI, and lifecycle callbacks are stored here and invoked by message handlers.
 */

import type { Agent, CustomAgentClass, AgentNotification, Subagent } from '../../shared/types';

/** Mutable callback registry – handlers and connection code read from this directly. */
export const cb = {
  onToast: null as ((type: 'error' | 'success' | 'warning' | 'info', title: string, message: string) => void) | null,
  onAgentCreated: null as ((agent: Agent) => void) | null,
  onAgentUpdated: null as ((agent: Agent, positionChanged: boolean) => void) | null,
  onAgentDeleted: null as ((agentId: string) => void) | null,
  onAgentsSync: null as ((agents: Agent[]) => void) | null,
  onAreasSync: null as (() => void) | null,
  onSpawnError: null as (() => void) | null,
  onSpawnSuccess: null as (() => void) | null,
  onToolUse: null as ((agentId: string, toolName: string, toolInput?: Record<string, unknown>) => void) | null,
  onDirectoryNotFound: null as ((path: string) => void) | null,
  onDelegation: null as ((bossId: string, subordinateId: string) => void) | null,
  onCustomClassesSync: null as ((classes: Map<string, CustomAgentClass>) => void) | null,
  onReconnect: null as (() => void) | null,
  onAgentNotification: null as ((notification: AgentNotification) => void) | null,
  onBuildingUpdated: null as ((building: import('../../shared/types').Building) => void) | null,
  onSubagentStarted: null as ((subagent: Subagent) => void) | null,
  onSubagentCompleted: null as ((subagentId: string) => void) | null,
};

export type WsCallbacks = {
  [K in keyof typeof cb]?: typeof cb[K];
};

export function setCallbacks(callbacks: WsCallbacks): void {
  if (callbacks.onToast) cb.onToast = callbacks.onToast;
  if (callbacks.onAgentCreated) cb.onAgentCreated = callbacks.onAgentCreated;
  if (callbacks.onAgentUpdated) cb.onAgentUpdated = callbacks.onAgentUpdated;
  if (callbacks.onAgentDeleted) cb.onAgentDeleted = callbacks.onAgentDeleted;
  if (callbacks.onAgentsSync) cb.onAgentsSync = callbacks.onAgentsSync;
  if (callbacks.onAreasSync) cb.onAreasSync = callbacks.onAreasSync;
  if (callbacks.onSpawnError) cb.onSpawnError = callbacks.onSpawnError;
  if (callbacks.onSpawnSuccess) cb.onSpawnSuccess = callbacks.onSpawnSuccess;
  if (callbacks.onToolUse) cb.onToolUse = callbacks.onToolUse;
  if (callbacks.onDirectoryNotFound) cb.onDirectoryNotFound = callbacks.onDirectoryNotFound;
  if (callbacks.onDelegation) cb.onDelegation = callbacks.onDelegation;
  if (callbacks.onCustomClassesSync) cb.onCustomClassesSync = callbacks.onCustomClassesSync;
  if (callbacks.onReconnect) cb.onReconnect = callbacks.onReconnect;
  if (callbacks.onAgentNotification) cb.onAgentNotification = callbacks.onAgentNotification;
  if (callbacks.onBuildingUpdated) cb.onBuildingUpdated = callbacks.onBuildingUpdated;
  if (callbacks.onSubagentStarted) cb.onSubagentStarted = callbacks.onSubagentStarted;
  if (callbacks.onSubagentCompleted) cb.onSubagentCompleted = callbacks.onSubagentCompleted;
}

/**
 * Clear all callbacks to prevent memory leaks on page unload.
 * This breaks reference chains that could keep React components alive.
 */
export function clearCallbacks(): void {
  cb.onToast = null;
  cb.onAgentCreated = null;
  cb.onAgentUpdated = null;
  cb.onAgentDeleted = null;
  cb.onAgentsSync = null;
  cb.onAreasSync = null;
  cb.onSpawnError = null;
  cb.onSpawnSuccess = null;
  cb.onToolUse = null;
  cb.onDirectoryNotFound = null;
  cb.onDelegation = null;
  cb.onCustomClassesSync = null;
  cb.onReconnect = null;
  cb.onAgentNotification = null;
  cb.onSubagentStarted = null;
  cb.onSubagentCompleted = null;
}

/**
 * Clear only scene-specific callbacks (for 3D scene disposal when switching to 2D mode).
 * Preserves toast, reconnect, and notification callbacks that are still needed.
 */
export function clearSceneCallbacks(): void {
  cb.onAgentCreated = null;
  cb.onAgentUpdated = null;
  cb.onAgentDeleted = null;
  cb.onAgentsSync = null;
  cb.onAreasSync = null;
  cb.onToolUse = null;
  cb.onDelegation = null;
  cb.onCustomClassesSync = null;
  cb.onBuildingUpdated = null;
  cb.onSubagentStarted = null;
  cb.onSubagentCompleted = null;
}
