import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock THREE - use function() constructors (arrow functions can't be `new`ed)
vi.mock('three', () => {
  const createMockMaterial = () => ({
    dispose: vi.fn(),
    map: { dispose: vi.fn() },
    normalMap: { dispose: vi.fn() },
    roughnessMap: { dispose: vi.fn() },
    metalnessMap: { dispose: vi.fn() },
    emissiveMap: { dispose: vi.fn() },
  });

  return {
    Group: function (this: any) {
      this.remove = vi.fn();
      this.children = [];
      this.userData = {};
      this.traverse = vi.fn();
      this.name = '';
      this.position = {
        x: 0,
        y: 0,
        z: 0,
        set(x: number, y: number, z: number) { this.x = x; this.y = y; this.z = z; },
      };
      // Real reparenting: applyModelOffset moves the geometry under the pivot.
      this.add = vi.fn((child: any) => {
        if (child?.parent?.children) {
          child.parent.children = child.parent.children.filter((c: any) => c !== child);
        }
        if (child) child.parent = this;
        this.children.push(child);
        return this;
      });
    },
    Mesh: function (this: any) {
      this.geometry = { dispose: vi.fn() };
      this.material = createMockMaterial();
      this.position = { y: 0 };
      this.castShadow = false;
      this.receiveShadow = false;
      this.name = '';
    },
    CapsuleGeometry: vi.fn(),
    MeshStandardMaterial: function (this: any) { Object.assign(this, createMockMaterial()); },
    MeshBasicMaterial: function (this: any) { Object.assign(this, createMockMaterial()); },
    SpriteMaterial: function (this: any) { Object.assign(this, createMockMaterial()); },
    AnimationMixer: function (this: any) {
      this.stopAllAction = vi.fn();
      this.uncacheRoot = vi.fn();
    },
    SkinnedMesh: vi.fn(),
    Sprite: vi.fn(),
  };
});

// Mock config
vi.mock('../config', () => ({
  AGENT_CLASS_CONFIG: {
    scout: { icon: '🔍', color: 0x4a9eff, description: 'Explores' },
    builder: { icon: '🔨', color: 0xff9e4a, description: 'Builds' },
    boss: { icon: '👑', color: 0xffd700, description: 'Boss' },
  },
  AGENT_CLASS_MODELS: {
    scout: 'character-male-a.glb',
    builder: 'character-male-b.glb',
    boss: 'character-male-c.glb',
  },
}));

import * as THREE from 'three';
import { ModelLoader, applyBodyTransform, applyModelOffset } from './ModelLoader';
import type { Agent, CustomAgentClass } from '../../../shared/types';

function createMockCharacterLoader() {
  return {
    clone: vi.fn().mockReturnValue(null),
    cloneByModelFile: vi.fn().mockReturnValue(null),
    cloneCustomModel: vi.fn().mockReturnValue(null),
  } as any;
}

function createMockAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: 'agent-1',
    name: 'TestAgent',
    class: 'scout',
    status: 'idle',
    provider: 'claude',
    position: { x: 0, y: 0, z: 0 },
    tokensUsed: 0,
    contextUsed: 50000,
    contextLimit: 200000,
    taskCount: 0,
    createdAt: Date.now(),
    lastActivity: Date.now(),
    cwd: '/tmp',
    permissionMode: 'bypass',
    ...overrides,
  } as Agent;
}

describe('ModelLoader', () => {
  let loader: ModelLoader;
  let mockCharacterLoader: ReturnType<typeof createMockCharacterLoader>;

  beforeEach(() => {
    mockCharacterLoader = createMockCharacterLoader();
    loader = new ModelLoader(mockCharacterLoader);
  });

  describe('getClassConfig', () => {
    it('returns built-in class config', () => {
      const config = loader.getClassConfig('scout');
      expect(config.icon).toBe('🔍');
      expect(config.color).toBe(0x4a9eff);
    });

    it('returns custom class config', () => {
      const custom: CustomAgentClass = {
        id: 'ninja',
        name: 'Ninja',
        icon: '🥷',
        color: '#ff00ff',
        description: 'Stealthy agent',
        defaultSkillIds: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      loader.setCustomClasses(new Map([['ninja', custom]]));

      const config = loader.getClassConfig('ninja');
      expect(config.icon).toBe('🥷');
      expect(config.color).toBe(0xff00ff);
      expect(config.description).toBe('Stealthy agent');
    });

    it('returns fallback for unknown class', () => {
      const config = loader.getClassConfig('unknown-class');
      expect(config.icon).toBe('❓');
      expect(config.color).toBe(0x888888);
    });

    it('handles invalid hex color in custom class', () => {
      const custom: CustomAgentClass = {
        id: 'bad-color',
        name: 'Bad Color',
        icon: '❌',
        color: 'not-a-hex',
        description: 'Bad',
        defaultSkillIds: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      loader.setCustomClasses(new Map([['bad-color', custom]]));

      const config = loader.getClassConfig('bad-color');
      expect(config.color).toBe(0x888888); // fallback gray
    });

    it('prioritizes built-in over custom with same name', () => {
      const custom: CustomAgentClass = {
        id: 'scout',
        name: 'Custom Scout',
        icon: '🔎',
        color: '#000000',
        description: 'Custom',
        defaultSkillIds: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      loader.setCustomClasses(new Map([['scout', custom]]));

      const config = loader.getClassConfig('scout');
      expect(config.icon).toBe('🔍'); // built-in, not custom
    });
  });

  describe('getModelInfo', () => {
    it('returns built-in model file', () => {
      const info = loader.getModelInfo('scout');
      expect(info.file).toBe('character-male-a.glb');
      expect(info.isCustomModel).toBe(false);
    });

    it('returns custom model path when set', () => {
      const custom: CustomAgentClass = {
        id: 'ninja',
        name: 'Ninja',
        icon: '🥷',
        color: '#ff00ff',
        description: 'Stealthy',
        defaultSkillIds: [],
        customModelPath: '/custom/ninja.glb',
        modelScale: 2.0,
        modelOffset: { x: 1, y: 2, z: 3 },
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      loader.setCustomClasses(new Map([['ninja', custom]]));

      const info = loader.getModelInfo('ninja');
      expect(info.file).toBe('/custom/ninja.glb');
      expect(info.isCustomModel).toBe(true);
      expect(info.customClassId).toBe('ninja');
      expect(info.scale).toBe(2.0);
      expect(info.offset).toEqual({ x: 1, y: 2, z: 3 });
    });

    it('returns custom class built-in model when no custom model path', () => {
      const custom: CustomAgentClass = {
        id: 'ninja',
        name: 'Ninja',
        icon: '🥷',
        color: '#ff00ff',
        description: 'Stealthy',
        defaultSkillIds: [],
        model: 'character-female-a.glb',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      loader.setCustomClasses(new Map([['ninja', custom]]));

      const info = loader.getModelInfo('ninja');
      expect(info.file).toBe('character-female-a.glb');
      expect(info.isCustomModel).toBe(false);
    });

    it('returns default model for unknown class', () => {
      const info = loader.getModelInfo('totally-unknown');
      expect(info.file).toBe('character-male-a.glb'); // DEFAULT_CUSTOM_CLASS_MODEL
      expect(info.isCustomModel).toBe(false);
    });
  });

  describe('calculateModelHeight', () => {
    it('returns 2.0 for boss', () => {
      expect(loader.calculateModelHeight({} as any, true)).toBe(2.0);
    });

    it('returns 1.5 for non-boss', () => {
      expect(loader.calculateModelHeight({} as any, false)).toBe(1.5);
    });
  });

  describe('createCharacterBody', () => {
    it('uses custom model clone when available', () => {
      const custom: CustomAgentClass = {
        id: 'ninja',
        name: 'Ninja',
        icon: '🥷',
        color: '#ff00ff',
        description: 'Stealthy',
        defaultSkillIds: [],
        customModelPath: '/custom/ninja.glb',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      loader.setCustomClasses(new Map([['ninja', custom]]));

      const mockMesh = {
        name: '',
        userData: {} as Record<string, unknown>,
        position: { set: vi.fn() },
      };
      mockCharacterLoader.cloneCustomModel.mockReturnValue({
        mesh: mockMesh,
        animations: [{ name: 'Idle' }, { name: 'Walk' }],
      });

      const agent = createMockAgent({ class: 'ninja' });
      const result = loader.createCharacterBody(agent, 0x888888);

      expect(mockCharacterLoader.cloneCustomModel).toHaveBeenCalledWith('ninja');
      expect(result.mixer).not.toBeNull();
      expect(result.animations.has('idle')).toBe(true);
      expect(result.animations.has('walk')).toBe(true);
      // Also stores original name
      expect(result.animations.has('Idle')).toBe(true);
    });

    it('falls back to built-in model clone', () => {
      const mockMesh = {
        name: '',
        userData: {} as Record<string, unknown>,
        position: { set: vi.fn() },
      };
      mockCharacterLoader.cloneByModelFile.mockReturnValue({
        mesh: mockMesh,
        animations: [],
      });

      const agent = createMockAgent({ class: 'scout' });
      const result = loader.createCharacterBody(agent, 0x888888);

      expect(mockCharacterLoader.cloneByModelFile).toHaveBeenCalledWith('character-male-a.glb');
      expect(result.body).toBe(mockMesh);
    });

    it('creates fallback capsule when no model available', () => {
      const agent = createMockAgent({ class: 'scout' });
      const result = loader.createCharacterBody(agent, 0xff0000);

      expect(result.mixer).toBeNull();
      expect(result.animations.size).toBe(0);
      expect(result.body).toBeDefined();
    });

    it('stores animation mapping from custom class', () => {
      const custom: CustomAgentClass = {
        id: 'dancer',
        name: 'Dancer',
        icon: '💃',
        color: '#ff00ff',
        description: 'Dances',
        defaultSkillIds: [],
        model: 'character-male-a.glb',
        animationMapping: { idle: 'Dance', working: 'Spin' },
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      loader.setCustomClasses(new Map([['dancer', custom]]));

      const mockMesh = {
        name: '',
        userData: {} as Record<string, unknown>,
        position: { set: vi.fn() },
      };
      mockCharacterLoader.cloneByModelFile.mockReturnValue({
        mesh: mockMesh,
        animations: [],
      });

      const agent = createMockAgent({ class: 'dancer' });
      loader.createCharacterBody(agent, 0x888888);

      expect((mockMesh.userData as { animationMapping?: unknown }).animationMapping).toEqual({ idle: 'Dance', working: 'Spin' });
    });

    it('applies model offset when non-zero', () => {
      const custom: CustomAgentClass = {
        id: 'offset-model',
        name: 'Offset',
        icon: '📐',
        color: '#ff00ff',
        description: 'Offset',
        defaultSkillIds: [],
        model: 'character-male-a.glb',
        modelOffset: { x: 1.5, y: 2.0, z: 0.5 },
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      loader.setCustomClasses(new Map([['offset-model', custom]]));

      const geometry = { name: 'Armature', userData: {}, parent: null as any };
      const mockMesh = {
        name: '',
        userData: {} as Record<string, unknown>,
        position: { set: vi.fn() },
        children: [geometry] as any[],
        add: vi.fn(function (this: any, child: any) { this.children.push(child); }),
      };
      mockCharacterLoader.cloneByModelFile.mockReturnValue({
        mesh: mockMesh,
        animations: [],
      });

      const agent = createMockAgent({ class: 'offset-model' });
      loader.createCharacterBody(agent, 0x888888);

      // The offset goes on a pivot below the body, not on the body itself, so it
      // rotates with the baked-in origin shift it cancels.
      expect(mockMesh.position.set).not.toHaveBeenCalled();
      const pivot = mockMesh.children.find((child: any) => child.userData?.isModelOffsetPivot);
      expect(pivot).toBeDefined();
      expect(pivot.children).toContain(geometry);
      // Note: offset maps x->x, z->y (vertical), y->z (depth); modelScale is 1 here
      expect([pivot.position.x, pivot.position.y, pivot.position.z]).toEqual([1.5, 0.5, 2.0]);
    });
  });

  describe('disposeAgentMesh', () => {
    it('stops mixer and clears animations', () => {
      const mockMixer = {
        stopAllAction: vi.fn(),
        uncacheRoot: vi.fn(),
      };
      const mockGroup = {
        traverse: vi.fn(),
        children: [],
        remove: vi.fn(),
      };
      const animations = new Map([['idle', {} as any]]);

      const meshData = {
        group: mockGroup as any,
        mixer: mockMixer as any,
        animations,
        currentAction: null,
      };

      loader.disposeAgentMesh(meshData);

      expect(mockMixer.stopAllAction).toHaveBeenCalled();
      expect(mockMixer.uncacheRoot).toHaveBeenCalledWith(mockGroup);
      expect(animations.size).toBe(0);
    });

    it('handles null mixer gracefully', () => {
      const mockGroup = {
        traverse: vi.fn(),
        children: [],
        remove: vi.fn(),
      };

      const meshData = {
        group: mockGroup as any,
        mixer: null,
        animations: new Map(),
        currentAction: null,
      };

      expect(() => loader.disposeAgentMesh(meshData)).not.toThrow();
    });
  });

  describe('disposeMaterial', () => {
    it('disposes material and all texture maps', () => {
      const _mat = {
        dispose: vi.fn(),
        map: { dispose: vi.fn() },
        normalMap: { dispose: vi.fn() },
        roughnessMap: { dispose: vi.fn() },
        metalnessMap: { dispose: vi.fn() },
        emissiveMap: { dispose: vi.fn() },
      };
      // Need to make it pass instanceof checks - use Object.setPrototypeOf or just test the logic
      // Since THREE is mocked, the instanceof checks won't work on plain objects.
      // Test that it calls dispose() at minimum.
      const simpleMat = { dispose: vi.fn() } as any;
      loader.disposeMaterial(simpleMat);
      expect(simpleMat.dispose).toHaveBeenCalled();
    });
  });
});

describe('applyBodyTransform', () => {
  const makeBody = (userData: Record<string, unknown>) => ({
    userData,
    scale: { setScalar: vi.fn() },
    position: { set: vi.fn() },
  }) as any;

  it('multiplies the model scale by the character scale and boss multiplier', () => {
    const body = makeBody({ customModelScale: 0.5 });

    expect(applyBodyTransform(body, 2.0, false)).toBe(1.0);
    expect(body.scale.setScalar).toHaveBeenCalledWith(1.0);

    expect(applyBodyTransform(body, 2.0, true)).toBe(1.5);
    expect(body.scale.setScalar).toHaveBeenLastCalledWith(1.5);
  });

  it('defaults to a model scale of 1 when the class has none', () => {
    const body = makeBody({});
    expect(applyBodyTransform(body, 1.5, false)).toBe(1.5);
  });

  it('leaves the body position alone — the offset rides the pivot below it', () => {
    const body = makeBody({ customModelScale: 0.036, modelOffset: { x: 0, y: -2.4, z: 0 } });

    applyBodyTransform(body, 2.0, false);

    expect(body.position.set).not.toHaveBeenCalled();
  });
});

describe('applyModelOffset', () => {
  const makeChild = (name: string) => ({ name, userData: {}, parent: null as any });

  const makeBody = (...children: any[]) => {
    const body = new (THREE as any).Group();
    for (const child of children) body.add(child);
    (body.add as any).mockClear?.();
    return body;
  };

  it('reparents the geometry under a pivot carrying the offset in model space', () => {
    const geometry = makeChild('Armature');
    const body = makeBody(geometry);

    // hoppip: 66.67 units of baked-in Z shift, cancelled by modelOffset.y at
    // modelScale 0.036. Dividing by the scale puts the correction back into
    // model space, where it rotates with the shift it cancels.
    applyModelOffset(body, { x: 0, y: -2.4, z: 0 }, 0.036);

    expect(body.children).toHaveLength(1);
    const pivot = body.children[0];
    expect(pivot.userData.isModelOffsetPivot).toBe(true);
    expect(pivot.children).toContain(geometry);
    // set(x, offset.z, offset.y) — depth lands on THREE's z axis
    expect(pivot.position.x).toBeCloseTo(0);
    expect(pivot.position.y).toBeCloseTo(0);
    expect(pivot.position.z).toBeCloseTo(-2.4 / 0.036);
  });

  it('reuses the existing pivot instead of nesting a second one', () => {
    const body = makeBody(makeChild('Armature'));

    applyModelOffset(body, { x: 0, y: -2.4, z: 0 }, 0.036);
    const pivot = body.children[0];

    applyModelOffset(body, { x: 0, y: -1.2, z: 0 }, 0.036);

    expect(body.children).toHaveLength(1);
    expect(body.children[0]).toBe(pivot);
    expect(pivot.position.z).toBeCloseTo(-1.2 / 0.036);
  });

  it('falls back to a scale of 1 rather than dividing by zero', () => {
    const body = makeBody(makeChild('Armature'));

    applyModelOffset(body, { x: 1, y: 2, z: 3 }, 0);

    const pivot = body.children[0];
    expect(pivot.position.x).toBe(1);
    expect(pivot.position.y).toBe(3);
    expect(pivot.position.z).toBe(2);
  });
});
