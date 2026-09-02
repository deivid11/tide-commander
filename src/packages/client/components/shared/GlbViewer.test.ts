import { describe, expect, it } from 'vitest';
import { buildGlbAnimationOptions, resolveGlbResourcePath } from './GlbViewer';

describe('resolveGlbResourcePath', () => {
  it('resolves external textures relative to the model', () => {
    expect(resolveGlbResourcePath('/models/robot/model.glb', 'Textures/body color.png'))
      .toBe('/models/robot/Textures/body color.png');
  });

  it('normalizes parent segments and ignores cache-busting queries', () => {
    expect(resolveGlbResourcePath('/models/robot/model.glb', '../shared/metal.png?v=2'))
      .toBe('/models/shared/metal.png');
  });

  it('preserves Windows drive paths', () => {
    expect(resolveGlbResourcePath('C:\\models\\robot.glb', 'maps/base.png'))
      .toBe('C:/models/maps/base.png');
  });
});

describe('buildGlbAnimationOptions', () => {
  it('keeps authored clip names and exposes their duration', () => {
    expect(buildGlbAnimationOptions([
      { name: 'Idle', duration: 2.5 },
      { name: 'Walk', duration: 1.25 },
    ])).toEqual([
      { index: 0, label: 'Idle', duration: 2.5 },
      { index: 1, label: 'Walk', duration: 1.25 },
    ]);
  });

  it('labels unnamed and duplicate clips uniquely', () => {
    expect(buildGlbAnimationOptions([
      { name: '', duration: 1 },
      { name: 'Run', duration: 2 },
      { name: 'Run', duration: 3 },
    ]).map((option) => option.label)).toEqual(['Animation 1', 'Run', 'Run (2)']);
  });
});
