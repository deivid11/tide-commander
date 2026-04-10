/**
 * Area Layout API Client
 * Handles auto-organize layout operations for areas and agents
 */

import { getAuthToken, getApiBaseUrl } from '../utils/storage';

export interface OrganizedAgent {
  agentId: string;
  position: { x: number; y: number; z: number };
}

export interface OrganizedBuilding {
  buildingId: string;
  position: { x: number; z: number };
}

export interface OrganizeResult {
  organized: OrganizedAgent[];
  buildings: OrganizedBuilding[];
}

interface OrganizeAllAreaResult extends OrganizeResult {
  areaId: string;
  areaName: string;
}

interface OrganizeAllResponse {
  organized?: OrganizedAgent[];
  buildings?: OrganizedBuilding[];
  results?: OrganizeAllAreaResult[];
}

function authHeaders(): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'X-Auth-Token': getAuthToken(),
  };
}

/**
 * Organize agents within a single area into a tidy layout
 */
export async function organizeArea(areaId: string): Promise<OrganizeResult> {
  const response = await fetch(`${getApiBaseUrl()}/api/areas/${areaId}/organize`, {
    method: 'POST',
    headers: authHeaders(),
  });
  if (!response.ok) {
    throw new Error(`Failed to organize area: ${response.statusText}`);
  }
  const data = await response.json() as Partial<OrganizeResult>;
  return {
    organized: Array.isArray(data.organized) ? data.organized : [],
    buildings: Array.isArray(data.buildings) ? data.buildings : [],
  };
}

/**
 * Organize agents across all areas
 */
export async function organizeAllAreas(): Promise<OrganizeResult> {
  const response = await fetch(`${getApiBaseUrl()}/api/areas/organize-all`, {
    method: 'POST',
    headers: authHeaders(),
  });
  if (!response.ok) {
    throw new Error(`Failed to organize all areas: ${response.statusText}`);
  }
  const data = await response.json() as OrganizeAllResponse;
  if (Array.isArray(data.organized)) {
    return {
      organized: data.organized,
      buildings: Array.isArray(data.buildings) ? data.buildings : [],
    };
  }

  return (Array.isArray(data.results) ? data.results : []).reduce<OrganizeResult>((acc, result) => {
    acc.organized.push(...result.organized);
    acc.buildings.push(...result.buildings);
    return acc;
  }, { organized: [], buildings: [] });
}
