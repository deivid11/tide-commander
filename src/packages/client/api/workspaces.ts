/**
 * Workspaces API Client
 * Handles API calls for workspace management (grouping areas together)
 */

import { getAuthToken, getApiBaseUrl } from '../utils/storage';

export interface Workspace {
  id: string;
  name: string;
  areaIds: string[];
  cameraState?: {
    position: { x: number; y: number; z: number };
    target: { x: number; y: number; z: number };
  };
  createdAt: number;
  updatedAt: number;
}

function authHeaders(): Record<string, string> {
  return {
    'Authorization': `Bearer ${getAuthToken()}`,
    'Content-Type': 'application/json',
  };
}

export async function fetchWorkspaces(): Promise<Workspace[]> {
  const response = await fetch(`${getApiBaseUrl()}/api/workspaces`, {
    headers: authHeaders(),
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch workspaces: ${response.statusText}`);
  }
  return response.json();
}

export async function createWorkspace(name: string, areaIds: string[]): Promise<Workspace> {
  const response = await fetch(`${getApiBaseUrl()}/api/workspaces`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ name, areaIds }),
  });
  if (!response.ok) {
    throw new Error(`Failed to create workspace: ${response.statusText}`);
  }
  return response.json();
}

export async function updateWorkspace(id: string, updates: Partial<Pick<Workspace, 'name' | 'areaIds' | 'cameraState'>>): Promise<Workspace> {
  const response = await fetch(`${getApiBaseUrl()}/api/workspaces/${id}`, {
    method: 'PUT',
    headers: authHeaders(),
    body: JSON.stringify(updates),
  });
  if (!response.ok) {
    throw new Error(`Failed to update workspace: ${response.statusText}`);
  }
  return response.json();
}

export async function deleteWorkspace(id: string): Promise<void> {
  const response = await fetch(`${getApiBaseUrl()}/api/workspaces/${id}`, {
    method: 'DELETE',
    headers: authHeaders(),
  });
  if (!response.ok) {
    throw new Error(`Failed to delete workspace: ${response.statusText}`);
  }
}

export async function getActiveWorkspace(): Promise<string | null> {
  const response = await fetch(`${getApiBaseUrl()}/api/workspaces/active`, {
    headers: authHeaders(),
  });
  if (!response.ok) {
    throw new Error(`Failed to get active workspace: ${response.statusText}`);
  }
  const data = await response.json();
  return data.activeWorkspaceId ?? null;
}

export async function setActiveWorkspace(id: string | null): Promise<void> {
  const response = await fetch(`${getApiBaseUrl()}/api/workspaces/active`, {
    method: 'PUT',
    headers: authHeaders(),
    body: JSON.stringify({ workspaceId: id }),
  });
  if (!response.ok) {
    throw new Error(`Failed to set active workspace: ${response.statusText}`);
  }
}
