const REFERENCE_ZOOM = 30;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function get2DDistanceScale(zoom: number): number {
  return clamp(Math.max(zoom, 1) / REFERENCE_ZOOM, 0.5, 1);
}

export function get2DIndicatorZoomFactor(zoom: number): number {
  return get2DDistanceScale(zoom);
}

export function get2DNameplateZoomFactor(zoom: number, hasTaskLabel: boolean): number {
  void hasTaskLabel;
  return get2DDistanceScale(zoom);
}
