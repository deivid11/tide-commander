import { describe, expect, it } from 'vitest';
import {
  get2DDistanceScale,
  get2DIndicatorZoomFactor,
  get2DNameplateZoomFactor,
} from '../utils/indicatorScale';

describe('AgentRenderer zoom scaling', () => {
  it('matches the 3D-style neutral scale at the reference zoom', () => {
    expect(get2DDistanceScale(30)).toBe(1);
    expect(get2DIndicatorZoomFactor(30)).toBe(1);
    expect(get2DNameplateZoomFactor(30, false)).toBe(1);
    expect(get2DNameplateZoomFactor(30, true)).toBe(1);
  });

  it('scales labels and indicators down when zooming out', () => {
    expect(get2DDistanceScale(12)).toBe(0.5);
    expect(get2DIndicatorZoomFactor(12)).toBe(0.5);
    expect(get2DNameplateZoomFactor(12, false)).toBe(0.5);
    expect(get2DNameplateZoomFactor(12, true)).toBe(0.5);
  });

  it('does not grow labels or indicators when zooming in', () => {
    expect(get2DDistanceScale(60)).toBe(1);
    expect(get2DIndicatorZoomFactor(60)).toBe(1);
    expect(get2DNameplateZoomFactor(60, false)).toBe(1);
    expect(get2DNameplateZoomFactor(60, true)).toBe(1);
  });
});
