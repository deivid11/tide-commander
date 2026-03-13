const REFERENCE_ZOOM = 30;
const MIN_DISTANCE_SCALE = 0.18;

export type AgentDetailLevel = 'full' | 'reduced' | 'compact' | 'minimal';

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function get2DDistanceScale(zoom: number): number {
  return clamp(Math.max(zoom, 1) / REFERENCE_ZOOM, MIN_DISTANCE_SCALE, 1);
}

export function get2DIndicatorZoomFactor(zoom: number): number {
  return get2DDistanceScale(zoom);
}

export function get2DNameplateZoomFactor(zoom: number, hasTaskLabel: boolean): number {
  void hasTaskLabel;
  return get2DDistanceScale(zoom);
}

export function get2DAgentDetailLevel(zoom: number): AgentDetailLevel {
  if (zoom >= 30) return 'full';
  if (zoom >= 24) return 'reduced';
  if (zoom >= 18) return 'compact';
  return 'minimal';
}
