import { describe, expect, it } from 'vitest';
import { resolveGlbResourcePath } from './GlbViewer';

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
