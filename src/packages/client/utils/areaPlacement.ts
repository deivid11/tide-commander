import type { DrawingArea } from '../../shared/types';

interface AABB {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

function areaBounds(area: DrawingArea): AABB {
  if (area.type === 'rectangle') {
    const w = area.width ?? 0;
    const h = area.height ?? 0;
    return {
      left: area.center.x - w / 2,
      right: area.center.x + w / 2,
      top: area.center.z - h / 2,
      bottom: area.center.z + h / 2,
    };
  }
  const r = area.radius ?? 0;
  return {
    left: area.center.x - r,
    right: area.center.x + r,
    top: area.center.z - r,
    bottom: area.center.z + r,
  };
}

function aabbOverlaps(a: AABB, b: AABB): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

/**
 * Find a free (non-overlapping) position for a new rectangular area of the
 * given dimensions. Scans outward from `origin` in a square spiral, snapping
 * candidates to a grid of `step` world units. Falls back to a position far
 * from the cluster if no free slot is found within `maxRings`.
 */
export function findFreeAreaSpot(
  existingAreas: DrawingArea[],
  width: number,
  height: number,
  origin: { x: number; z: number } = { x: 0, z: 0 },
  options?: { padding?: number; maxRings?: number }
): { x: number; z: number } {
  const padding = options?.padding ?? 1;
  const maxRings = options?.maxRings ?? 24;
  const step = Math.max(width, height) + padding;
  const visibleAreas = existingAreas.filter((a) => !a.archived);
  const obstacles = visibleAreas.map(areaBounds);

  const overlaps = (cx: number, cz: number): boolean => {
    const candidate: AABB = {
      left: cx - width / 2,
      right: cx + width / 2,
      top: cz - height / 2,
      bottom: cz + height / 2,
    };
    for (const o of obstacles) {
      if (aabbOverlaps(candidate, o)) return true;
    }
    return false;
  };

  // Snap origin to the grid so candidates align.
  const ox = Math.round(origin.x / step) * step;
  const oz = Math.round(origin.z / step) * step;

  for (let ring = 0; ring <= maxRings; ring++) {
    if (ring === 0) {
      if (!overlaps(ox, oz)) return { x: ox, z: oz };
      continue;
    }
    // Walk the perimeter of the ring clockwise starting at the top-left corner.
    const half = ring;
    // Top and bottom edges.
    for (let i = -half; i <= half; i++) {
      const x = ox + i * step;
      const zTop = oz - half * step;
      const zBot = oz + half * step;
      if (!overlaps(x, zTop)) return { x, z: zTop };
      if (!overlaps(x, zBot)) return { x, z: zBot };
    }
    // Left and right edges (corners already covered above).
    for (let i = -half + 1; i <= half - 1; i++) {
      const z = oz + i * step;
      const xLeft = ox - half * step;
      const xRight = ox + half * step;
      if (!overlaps(xLeft, z)) return { x: xLeft, z };
      if (!overlaps(xRight, z)) return { x: xRight, z };
    }
  }

  // Fallback: nudge far beyond the last scanned ring.
  return { x: ox + (maxRings + 2) * step, z: oz + (maxRings + 2) * step };
}
