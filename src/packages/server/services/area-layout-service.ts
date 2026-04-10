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

interface RowSpan {
  minX: number;
  maxX: number;
  z: number;
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
 * Get the usable horizontal span for a row at a given z position.
 */
function getRowSpan(area: DrawingArea, bounds: Bounds, z: number): RowSpan {
  const clampedZ = clamp(z, bounds.minZ, bounds.maxZ);

  if (area.type === 'circle' && area.radius) {
    const usableRadius = Math.max(0, area.radius - PADDING);
    const dz = clampedZ - area.center.z;
    const horizontalRadius = Math.sqrt(Math.max(0, usableRadius * usableRadius - dz * dz));
    const minX = clamp(area.center.x - horizontalRadius, bounds.minX, bounds.maxX);
    const maxX = clamp(area.center.x + horizontalRadius, bounds.minX, bounds.maxX);
    return { minX, maxX, z: clampedZ };
  }

  return {
    minX: bounds.minX,
    maxX: bounds.maxX,
    z: clampedZ,
  };
}

function getRowCapacity(area: DrawingArea, bounds: Bounds, z: number): number {
  const span = getRowSpan(area, bounds, z);
  const width = Math.max(0, span.maxX - span.minX);
  return width <= 0 ? 1 : Math.max(1, Math.floor(width / MIN_SPACING) + 1);
}

function getRowZPositions(bounds: Bounds, rowCount: number): number[] {
  if (rowCount <= 0) return [];

  if (rowCount === 1) {
    return [(bounds.minZ + bounds.maxZ) / 2];
  }

  const usableHeight = Math.max(0, bounds.maxZ - bounds.minZ);
  const spacing = usableHeight <= 0
    ? 0
    : Math.min(PREFERRED_SPACING, usableHeight / (rowCount - 1));

  return Array.from({ length: rowCount }, (_, index) => bounds.minZ + index * spacing);
}

function placeItemsInSpan<T extends string>(
  ids: T[],
  area: DrawingArea,
  bounds: Bounds,
  z: number,
  align: 'center' | 'end' = 'center',
): Array<{ id: T; position: { x: number; z: number } }> {
  if (ids.length === 0) return [];

  const span = getRowSpan(area, bounds, z);
  const width = Math.max(0, span.maxX - span.minX);

  let spacing: number;
  if (ids.length === 1) {
    spacing = 0;
  } else {
    spacing = width <= 0 ? 0 : Math.min(PREFERRED_SPACING, width / (ids.length - 1));
  }

  const totalWidth = spacing * Math.max(0, ids.length - 1);
  const startX = align === 'end'
    ? span.maxX - totalWidth
    : (span.minX + span.maxX) / 2 - totalWidth / 2;

  return ids.map((id, index) => ({
    id,
    position: {
      x: clamp(startX + index * spacing, span.minX, span.maxX),
      z: span.z,
    },
  }));
}

function tryPackGroupsIntoRows<T>(
  area: DrawingArea,
  bounds: Bounds,
  groups: T[][],
): Array<{ items: T[]; z: number }> | null {
  const nonEmptyGroups = groups.filter(group => group.length > 0);
  if (nonEmptyGroups.length === 0) return [];

  const totalItems = nonEmptyGroups.reduce((sum, group) => sum + group.length, 0);

  for (let rowCount = nonEmptyGroups.length; rowCount <= totalItems; rowCount++) {
    const rowZPositions = getRowZPositions(bounds, rowCount);
    const packed: Array<{ items: T[]; z: number }> = [];
    let rowIndex = 0;
    let failed = false;

    for (const group of nonEmptyGroups) {
      let cursor = 0;

      while (cursor < group.length) {
        if (rowIndex >= rowZPositions.length) {
          failed = true;
          break;
        }

        const z = rowZPositions[rowIndex];
        const capacity = getRowCapacity(area, bounds, z);
        const take = Math.min(capacity, group.length - cursor);
        packed.push({ items: group.slice(cursor, cursor + take), z });
        cursor += take;
        rowIndex++;
      }

      if (failed) break;
    }

    if (!failed) return packed;
  }

  return null;
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
  area: DrawingArea,
  buildings: Building[],
  bounds: Bounds,
): { buildingLayout: OrganizedBuilding[]; agentBounds: Bounds } {
  if (buildings.length === 0) {
    return { buildingLayout: [], agentBounds: bounds };
  }

  const fullHeight = Math.max(0, bounds.maxZ - bounds.minZ);

  for (let buildingRows = 1; buildingRows <= buildings.length; buildingRows++) {
    const reservedHeight = fullHeight <= 0
      ? 0
      : Math.min(fullHeight, Math.max(MIN_SPACING, (buildingRows - 1) * PREFERRED_SPACING + MIN_SPACING));
    const buildingBounds: Bounds = {
      ...bounds,
      maxZ: Math.min(bounds.maxZ, bounds.minZ + reservedHeight),
    };
    const packedRows = tryPackGroupsIntoRows(area, buildingBounds, [buildings]);
    if (!packedRows) continue;

    const buildingLayout = packedRows.flatMap(row =>
      placeItemsInSpan(
        row.items.map(building => building.id),
        area,
        buildingBounds,
        row.z,
        'end',
      ).map(item => ({
        buildingId: item.id,
        position: item.position,
      }))
    );

    const nextMinZ = Math.min(bounds.maxZ, buildingBounds.maxZ + MIN_SPACING);
    const agentBounds: Bounds = {
      ...bounds,
      minZ: nextMinZ,
    };

    return { buildingLayout, agentBounds };
  }

  // Fall back to keeping agents centered while pinning buildings as tightly as possible inside the area.
  const fallbackZ = bounds.minZ;
  const buildingLayout = placeItemsInSpan(
    buildings.map(building => building.id),
    area,
    bounds,
    fallbackZ,
    'end',
  ).map(item => ({
    buildingId: item.id,
    position: item.position,
  }));

  return { buildingLayout, agentBounds: bounds };
}

/**
 * Organize agents within a single area using hierarchy-aware grid layout.
 * Returns the new positions without applying them.
 */
export function calculateLayout(area: DrawingArea, agents: Agent[], buildings: Building[]): LayoutResult {
  const fullBounds = getAreaBounds(area);
  const { buildingLayout, agentBounds } = placeBuildingsAndShrinkBounds(area, buildings, fullBounds);

  if (agents.length === 0) {
    return { organized: [], buildings: buildingLayout };
  }

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

  const groups: Agent[][] = [];
  if (bosses.length > 0) groups.push(bosses);
  for (const boss of bosses) {
    const subs = subordinatesByBoss.get(boss.id) || [];
    if (subs.length > 0) groups.push(subs);
  }
  if (regulars.length > 0) groups.push(regulars);

  if (groups.length === 0) {
    return { organized: [], buildings: buildingLayout };
  }

  const packedRows = tryPackGroupsIntoRows(area, agentBounds, groups)
    ?? tryPackGroupsIntoRows(area, fullBounds, groups)
    ?? [];

  const organized: OrganizedAgent[] = packedRows.flatMap(row =>
    placeItemsInSpan(
      row.items.map(agent => agent.id),
      area,
      packedRows.length > 0 ? agentBounds : fullBounds,
      row.z,
    ).map(item => ({
      agentId: item.id,
      position: { x: item.position.x, y: 0, z: item.position.z },
    }))
  );

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
