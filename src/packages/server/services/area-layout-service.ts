/**
 * Area Layout Service
 * Organizes agents and buildings within areas using a hierarchy-aware grid layout
 */

import type { DrawingArea, Agent, Building } from '../../shared/types.js';
import { loadAreas, loadBuildings, saveBuildings } from '../data/index.js';
import * as agentService from './agent-service.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('AreaLayout');

const PADDING = 1.5;
const PREFERRED_SPACING = 2.5;
const MIN_SPACING = 1.0;

export interface OrganizedAgent {
  agentId: string;
  position: { x: number; y: number; z: number };
}

export interface OrganizedBuilding {
  buildingId: string;
  position: { x: number; z: number };
}

export interface LayoutResult {
  organized: OrganizedAgent[];
  buildings: OrganizedBuilding[];
}

interface Bounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/**
 * Get usable bounds for an area (with padding), clamped to positive dimensions.
 */
function getAreaBounds(area: DrawingArea): Bounds {
  let bounds: Bounds;
  if (area.type === 'rectangle' && area.width && area.height) {
    bounds = {
      minX: area.center.x - area.width / 2 + PADDING,
      maxX: area.center.x + area.width / 2 - PADDING,
      minZ: area.center.z - area.height / 2 + PADDING,
      maxZ: area.center.z + area.height / 2 - PADDING,
    };
  } else if (area.type === 'circle' && area.radius) {
    const r = Math.max(0, area.radius - PADDING);
    bounds = {
      minX: area.center.x - r,
      maxX: area.center.x + r,
      minZ: area.center.z - r,
      maxZ: area.center.z + r,
    };
  } else {
    bounds = { minX: area.center.x, maxX: area.center.x, minZ: area.center.z, maxZ: area.center.z };
  }
  // Ensure non-negative dimensions
  if (bounds.maxX < bounds.minX) bounds.maxX = bounds.minX = area.center.x;
  if (bounds.maxZ < bounds.minZ) bounds.maxZ = bounds.minZ = area.center.z;
  return bounds;
}

/**
 * Check if a position is inside an area's bounds.
 */
function isPositionInArea(pos: { x: number; z: number }, area: DrawingArea): boolean {
  if (area.type === 'rectangle' && area.width && area.height) {
    const halfW = area.width / 2;
    const halfH = area.height / 2;
    return (
      pos.x >= area.center.x - halfW &&
      pos.x <= area.center.x + halfW &&
      pos.z >= area.center.z - halfH &&
      pos.z <= area.center.z + halfH
    );
  }
  if (area.type === 'circle' && area.radius) {
    const dx = pos.x - area.center.x;
    const dz = pos.z - area.center.z;
    return dx * dx + dz * dz <= area.radius * area.radius;
  }
  return false;
}

/**
 * Clamp a value to [min, max].
 */
function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Place a row of agents centered horizontally within bounds, clamped.
 */
function placeRow(
  agents: Agent[],
  z: number,
  bounds: Bounds,
): OrganizedAgent[] {
  if (agents.length === 0) return [];
  const width = bounds.maxX - bounds.minX;

  let spacing: number;
  if (agents.length === 1) {
    spacing = 0;
  } else {
    // Calculate ideal spacing, shrink to fit if needed
    spacing = Math.max(MIN_SPACING, Math.min(PREFERRED_SPACING, width / (agents.length - 1)));
  }

  const totalWidth = spacing * (agents.length - 1);
  const startX = (bounds.minX + bounds.maxX) / 2 - totalWidth / 2;
  const clampedZ = clamp(z, bounds.minZ, bounds.maxZ);

  return agents.map((agent, i) => ({
    agentId: agent.id,
    position: {
      x: clamp(startX + i * spacing, bounds.minX, bounds.maxX),
      y: 0,
      z: clampedZ,
    },
  }));
}

/**
 * Find buildings that are physically inside an area.
 */
function getBuildingsInArea(area: DrawingArea): Building[] {
  const allBuildings = loadBuildings();
  return allBuildings.filter(b => isPositionInArea(b.position, area));
}

/**
 * Place buildings along the top-right edge of the bounds.
 * Returns the building positions and the remaining agent bounds (with building space excluded).
 */
function placeBuildingsAndShrinkBounds(
  buildings: Building[],
  bounds: Bounds,
): { buildingLayout: OrganizedBuilding[]; agentBounds: Bounds } {
  if (buildings.length === 0) {
    return { buildingLayout: [], agentBounds: bounds };
  }

  const width = bounds.maxX - bounds.minX;
  const buildingSpacing = Math.max(MIN_SPACING, Math.min(PREFERRED_SPACING, width / buildings.length));
  const buildingRowHeight = PREFERRED_SPACING;

  // Place buildings along the top edge (minZ), right-aligned
  const totalBuildingWidth = buildingSpacing * (buildings.length - 1);
  const startX = bounds.maxX - totalBuildingWidth;

  const buildingLayout: OrganizedBuilding[] = buildings.map((b, i) => ({
    buildingId: b.id,
    position: {
      x: clamp(startX + i * buildingSpacing, bounds.minX, bounds.maxX),
      z: clamp(bounds.minZ, bounds.minZ, bounds.maxZ),
    },
  }));

  // Shrink agent bounds: push minZ down to make room for buildings
  const agentBounds: Bounds = {
    ...bounds,
    minZ: Math.min(bounds.minZ + buildingRowHeight, bounds.maxZ),
  };

  return { buildingLayout, agentBounds };
}

/**
 * Organize agents within a single area using hierarchy-aware grid layout.
 * Returns the new positions without applying them.
 */
export function calculateLayout(area: DrawingArea, agents: Agent[], buildings: Building[]): LayoutResult {
  const fullBounds = getAreaBounds(area);
  const { buildingLayout, agentBounds } = placeBuildingsAndShrinkBounds(buildings, fullBounds);

  if (agents.length === 0) {
    return { organized: [], buildings: buildingLayout };
  }

  const usableHeight = agentBounds.maxZ - agentBounds.minZ;
  const usableWidth = agentBounds.maxX - agentBounds.minX;

  // Separate into hierarchy groups
  const bosses: Agent[] = [];
  const subordinatesByBoss = new Map<string, Agent[]>();
  const regulars: Agent[] = [];
  const bossIdsInArea = new Set(agents.filter(a => a.isBoss).map(a => a.id));

  for (const agent of agents) {
    if (agent.isBoss) {
      bosses.push(agent);
      if (!subordinatesByBoss.has(agent.id)) subordinatesByBoss.set(agent.id, []);
    } else if (agent.bossId && bossIdsInArea.has(agent.bossId)) {
      const subs = subordinatesByBoss.get(agent.bossId) || [];
      subs.push(agent);
      subordinatesByBoss.set(agent.bossId, subs);
    } else {
      regulars.push(agent);
    }
  }

  // Calculate max agents per row - adapt to fit
  const maxPerRow = usableWidth <= 0
    ? agents.length
    : Math.max(1, Math.floor(usableWidth / MIN_SPACING) + 1);

  // Build rows: bosses first, then subs per boss, then regulars
  const rows: Agent[][] = [];

  for (let i = 0; i < bosses.length; i += maxPerRow) {
    rows.push(bosses.slice(i, i + maxPerRow));
  }
  for (const boss of bosses) {
    const subs = subordinatesByBoss.get(boss.id) || [];
    for (let i = 0; i < subs.length; i += maxPerRow) {
      rows.push(subs.slice(i, i + maxPerRow));
    }
  }
  for (let i = 0; i < regulars.length; i += maxPerRow) {
    rows.push(regulars.slice(i, i + maxPerRow));
  }

  if (rows.length === 0) {
    return { organized: [], buildings: buildingLayout };
  }

  // Calculate row spacing - shrink to fit within bounds
  let rowSpacing: number;
  if (rows.length === 1) {
    rowSpacing = 0;
  } else {
    rowSpacing = Math.max(MIN_SPACING, Math.min(PREFERRED_SPACING, usableHeight / (rows.length - 1)));
  }

  // Start from top of agent bounds
  const startZ = rows.length === 1
    ? (agentBounds.minZ + agentBounds.maxZ) / 2
    : agentBounds.minZ;

  const organized: OrganizedAgent[] = [];
  for (let r = 0; r < rows.length; r++) {
    const z = startZ + r * rowSpacing;
    organized.push(...placeRow(rows[r], z, agentBounds));
  }

  return { organized, buildings: buildingLayout };
}

/**
 * Organize agents and buildings within a single area and apply position updates.
 */
export function organizeArea(areaId: string): LayoutResult {
  const areas = loadAreas();
  const area = areas.find(a => a.id === areaId);
  if (!area) throw new Error(`Area ${areaId} not found`);
  if (area.archived) throw new Error(`Area ${areaId} is archived`);

  const agents = area.assignedAgentIds
    .map(id => agentService.getAgent(id))
    .filter((a): a is Agent => a !== undefined);

  const buildings = getBuildingsInArea(area);
  const result = calculateLayout(area, agents, buildings);

  // Apply agent positions
  for (const item of result.organized) {
    agentService.updateAgent(item.agentId, { position: item.position }, false);
  }

  // Apply building positions
  if (result.buildings.length > 0) {
    const allBuildings = loadBuildings();
    let changed = false;
    for (const item of result.buildings) {
      const idx = allBuildings.findIndex(b => b.id === item.buildingId);
      if (idx !== -1) {
        allBuildings[idx] = { ...allBuildings[idx], position: item.position };
        changed = true;
      }
    }
    if (changed) saveBuildings(allBuildings);
  }

  log.log(`Organized ${result.organized.length} agents and ${result.buildings.length} buildings in area "${area.name}"`);
  return result;
}

/**
 * Organize all non-archived areas.
 */
export function organizeAllAreas(): { areaId: string; areaName: string; organized: OrganizedAgent[]; buildings: OrganizedBuilding[] }[] {
  const areas = loadAreas();
  const results: { areaId: string; areaName: string; organized: OrganizedAgent[]; buildings: OrganizedBuilding[] }[] = [];

  for (const area of areas) {
    if (area.archived) continue;
    // Organize even if no assigned agents — buildings may still need layout
    try {
      const result = organizeArea(area.id);
      if (result.organized.length > 0 || result.buildings.length > 0) {
        results.push({ areaId: area.id, areaName: area.name, ...result });
      }
    } catch (err: any) {
      log.error(`Failed to organize area "${area.name}": ${err.message}`);
    }
  }

  return results;
}
