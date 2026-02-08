import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock THREE - use function() constructors (arrow functions can't be `new`ed)
vi.mock('three', () => {
  const createMockMaterial = () => ({
    dispose: vi.fn(),
    map: { dispose: vi.fn(), image: null, needsUpdate: false },
    color: { setHex: vi.fn() },
    opacity: 0,
  });

  function MockGroup(this: any) {
    this.children = [];
    this.userData = {};
    this.position = { set: vi.fn(), x: 0, y: 0, z: 0 };
    this.name = '';
    this.add = vi.fn((child: any) => this.children.push(child));
    this.remove = vi.fn();
    this.getObjectByName = vi.fn((name: string) =>
      this.children.find((c: any) => c.name === name) || null
    );
    this.traverse = vi.fn();
  }

  function MockMesh(this: any) {
    this.geometry = { dispose: vi.fn() };
    this.material = createMockMaterial();
    this.position = { y: 0 };
    this.rotation = { x: 0 };
    this.castShadow = false;
    this.receiveShadow = false;
    this.renderOrder = 0;
    this.name = '';
  }

  function MockSprite(this: any) {
    this.material = createMockMaterial();
    this.position = { y: 0, set: vi.fn() };
    this.scale = { set: vi.fn() };
    this.userData = {};
    this.name = '';
  }

  function MockCanvasTexture(this: any) {
    this.minFilter = 0;
    this.magFilter = 0;
    this.generateMipmaps = false;
    this.anisotropy = 0;
    this.needsUpdate = false;
  }

  function MockAnimationMixer(this: any) {
    this.stopAllAction = vi.fn();
    this.uncacheRoot = vi.fn();
  }

  return {
    Group: MockGroup,
    Mesh: MockMesh,
    Sprite: MockSprite,
    CapsuleGeometry: vi.fn(),
    SphereGeometry: vi.fn(),
    RingGeometry: vi.fn(),
    MeshStandardMaterial: function (this: any) { Object.assign(this, createMockMaterial()); },
    MeshBasicMaterial: function (this: any) { Object.assign(this, createMockMaterial()); },
    SpriteMaterial: function (this: any) { Object.assign(this, createMockMaterial()); },
    CanvasTexture: MockCanvasTexture,
    AnimationMixer: MockAnimationMixer,
    SkinnedMesh: vi.fn(),
    DoubleSide: 2,
    LinearFilter: 1006,
    LinearMipmapLinearFilter: 1008,
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

// Mock document.createElement for canvas
const mockCanvasCtx = {
  clearRect: vi.fn(),
  beginPath: vi.fn(),
  arc: vi.fn(),
  fill: vi.fn(),
  stroke: vi.fn(),
  strokeText: vi.fn(),
  fillText: vi.fn(),
  roundRect: vi.fn(),
  measureText: vi.fn().mockReturnValue({ width: 100 }),
  font: '',
  textAlign: '',
  textBaseline: '',
  fillStyle: '',
  strokeStyle: '',
  lineWidth: 0,
  lineJoin: '',
  shadowColor: '',
  shadowBlur: 0,
  shadowOffsetX: 0,
  shadowOffsetY: 0,
};

const mockCanvas = {
  width: 4096,
  height: 2560,
  getContext: vi.fn().mockReturnValue(mockCanvasCtx),
};

vi.stubGlobal('document', {
  createElement: vi.fn().mockReturnValue(mockCanvas),
});

import { CharacterFactory } from './CharacterFactory';
import type { Agent } from '../../../shared/types';

function createMockCharacterLoader() {
  return {
    clone: vi.fn().mockReturnValue(null),
    cloneByModelFile: vi.fn().mockReturnValue(null),
    cloneCustomModel: vi.fn().mockReturnValue(null),
  } as any;
}

function createMockAgent(overrides: Partial<any> = {}): Agent {
  return {
    id: 'agent-1',
    name: 'TestAgent',
    class: 'scout',
    status: 'idle',
    provider: 'claude',
    position: { x: 5, y: 0, z: 3 },
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

describe('CharacterFactory', () => {
  let factory: CharacterFactory;
  let mockCharacterLoader: ReturnType<typeof createMockCharacterLoader>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockCharacterLoader = createMockCharacterLoader();
    factory = new CharacterFactory(mockCharacterLoader);
  });

  describe('createAgentMesh', () => {
    it('returns an AgentMeshData object', () => {
      const agent = createMockAgent();
      const result = factory.createAgentMesh(agent);

      expect(result.group).toBeDefined();
      expect(result.currentAction).toBeNull();
      expect(result.animations).toBeInstanceOf(Map);
    });

    it('sets agentId in group userData', () => {
      const agent = createMockAgent({ id: 'test-id-123' });
      const result = factory.createAgentMesh(agent);

      expect(result.group.userData.agentId).toBe('test-id-123');
    });

    it('stores agent metadata in userData', () => {
      const agent = createMockAgent({ name: 'Alpha', class: 'builder' });
      const result = factory.createAgentMesh(agent);

      expect(result.group.userData.agentName).toBe('Alpha');
      expect(result.group.userData.agentClass).toBe('builder');
    });

    it('marks boss agents in userData', () => {
      const bossAgent = createMockAgent({ isBoss: true });
      const result = factory.createAgentMesh(bossAgent);
      expect(result.group.userData.isBoss).toBe(true);

      const normalAgent = createMockAgent({ isBoss: false });
      const result2 = factory.createAgentMesh(normalAgent);
      expect(result2.group.userData.isBoss).toBe(false);
    });

    it('detects boss by class name for backward compatibility', () => {
      const agent = createMockAgent({ class: 'boss' });
      const result = factory.createAgentMesh(agent);
      expect(result.group.userData.isBoss).toBe(true);
    });

    it('sets initial position from agent data', () => {
      const agent = createMockAgent({ position: { x: 10, y: 0, z: 5 } });
      const result = factory.createAgentMesh(agent);

      expect(result.group.position.set).toHaveBeenCalledWith(10, 0, 5);
    });

    it('adds child elements to group', () => {
      const agent = createMockAgent();
      const result = factory.createAgentMesh(agent);

      // Should add: body, selectionRing, statusBar, nameLabel, hitbox = 5 children
      expect(result.group.add).toHaveBeenCalledTimes(5);
    });
  });

  describe('updateAgentClass', () => {
    it('returns null when class has not changed', () => {
      const agent = createMockAgent({ class: 'scout' });
      const meshData = {
        group: { userData: { agentClass: 'scout' } } as any,
        mixer: null,
        animations: new Map(),
        currentAction: null,
      };

      const result = factory.updateAgentClass(meshData, agent);
      expect(result).toBeNull();
    });

    it('attempts model replacement when class changes', () => {
      const agent = createMockAgent({ class: 'builder', name: 'Agent1' });
      const mockGroup = {
        userData: { agentClass: 'scout' },
        getObjectByName: vi.fn().mockReturnValue(null),
        remove: vi.fn(),
        add: vi.fn(),
        traverse: vi.fn(),
      };
      const meshData = {
        group: mockGroup as any,
        mixer: null,
        animations: new Map(),
        currentAction: null,
      };

      // Will return null since cloneByModelFile returns null by default
      const result = factory.updateAgentClass(meshData, agent);
      expect(result).toBeNull();
    });
  });

  describe('getStatusColor', () => {
    it('returns correct color for each status', () => {
      expect(factory.getStatusColor('idle')).toBe(0x4aff9e);
      expect(factory.getStatusColor('working')).toBe(0x4a9eff);
      expect(factory.getStatusColor('error')).toBe(0xff4a4a);
      expect(factory.getStatusColor('orphaned')).toBe(0xff00ff);
    });

    it('returns default for unknown status', () => {
      expect(factory.getStatusColor('banana')).toBe(0x888888);
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

      factory.disposeAgentMesh({
        group: mockGroup as any,
        mixer: mockMixer as any,
        animations,
        currentAction: null,
      });

      expect(mockMixer.stopAllAction).toHaveBeenCalled();
      expect(animations.size).toBe(0);
    });
  });

  describe('setCustomClasses', () => {
    it('passes custom classes through to model loader', () => {
      const classes = new Map([
        ['ninja', {
          id: 'ninja',
          name: 'Ninja',
          icon: '🥷',
          color: '#ff00ff',
          description: 'Stealthy',
          defaultSkillIds: [],
          createdAt: Date.now(),
          updatedAt: Date.now(),
        }],
      ]);

      factory.setCustomClasses(classes);

      // Verify by using the custom class in createAgentMesh
      const agent = createMockAgent({ class: 'ninja' });
      const result = factory.createAgentMesh(agent);
      // Should not crash and should create mesh with custom class
      expect(result.group).toBeDefined();
    });
  });

  describe('delegation integrity', () => {
    it('CharacterFactory exposes all original public methods', () => {
      expect(typeof factory.createAgentMesh).toBe('function');
      expect(typeof factory.updateAgentClass).toBe('function');
      expect(typeof factory.updateVisuals).toBe('function');
      expect(typeof factory.upgradeToCharacterModel).toBe('function');
      expect(typeof factory.disposeAgentMesh).toBe('function');
      expect(typeof factory.getStatusColor).toBe('function');
      expect(typeof factory.updateIdleTimer).toBe('function');
      expect(typeof factory.updateManaBar).toBe('function');
      expect(typeof factory.setCustomClasses).toBe('function');
    });
  });
});
