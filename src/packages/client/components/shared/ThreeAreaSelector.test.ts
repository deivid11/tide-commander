import { describe, expect, it } from 'vitest';
import { buildThreeAreaPrompt, type ThreeAreaMark } from './ThreeAreaSelector';

describe('buildThreeAreaPrompt', () => {
  it('copies agent-readable and machine-readable sphere and box coordinates', () => {
    const areas: ThreeAreaMark[] = [
      { id: 'one', shape: 'sphere', center: [1.23456, 2, -3], size: [8, 8, 8] },
      { id: 'two', shape: 'box', center: [10, 20, 30], size: [4, 5, 6] },
    ];

    const prompt = buildThreeAreaPrompt('part.stl', '/models/part.stl', areas);

    expect(prompt).toContain('centro XYZ [1.235, 2, -3] mm, radio 4 mm');
    expect(prompt).toContain('tamaño XYZ [4, 5, 6] mm');
    expect(prompt).toContain('"coordinateSystem": "original-model-coordinates"');
    expect(prompt).toContain('"file": "/models/part.stl"');
  });
});
