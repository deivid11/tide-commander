import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getContextRemainingPercent, VisualConfig } from './VisualConfig';
import type { Agent } from '../../../shared/types';

function createMockAgent(overrides: Partial<any> = {}): Agent {
  return {
    id: 'agent-1',
    name: 'TestAgent',
    class: 'scout',
    status: 'idle',
    provider: 'claude',
    position: { x: 0, y: 0, z: 0 },
    tokensUsed: 0,
    contextUsed: 0,
    contextLimit: 200000,
    taskCount: 0,
    createdAt: Date.now(),
    lastActivity: Date.now(),
    cwd: '/tmp',
    permissionMode: 'bypass',
    ...overrides,
  } as Agent;
}

describe('getContextRemainingPercent', () => {
  it('returns 100% when no context used', () => {
    const agent = createMockAgent({ contextUsed: 0, contextLimit: 200000 });
    expect(getContextRemainingPercent(agent)).toBe(100);
  });

  it('returns 50% when half context used', () => {
    const agent = createMockAgent({ contextUsed: 100000, contextLimit: 200000 });
    expect(getContextRemainingPercent(agent)).toBe(50);
  });

  it('returns 0% when all context used', () => {
    const agent = createMockAgent({ contextUsed: 200000, contextLimit: 200000 });
    expect(getContextRemainingPercent(agent)).toBe(0);
  });

  it('clamps to 0% when context exceeds limit', () => {
    const agent = createMockAgent({ contextUsed: 250000, contextLimit: 200000 });
    expect(getContextRemainingPercent(agent)).toBe(0);
  });

  it('uses contextStats when available', () => {
    const agent = createMockAgent({
      contextUsed: 50000,
      contextLimit: 200000,
      contextStats: { usedPercent: 75 },
    });
    // Should use contextStats (100 - 75 = 25), not basic calc (75%)
    expect(getContextRemainingPercent(agent)).toBe(25);
  });

  it('falls back to basic calc without contextStats', () => {
    const agent = createMockAgent({
      contextUsed: 150000,
      contextLimit: 200000,
      contextStats: undefined,
    });
    expect(getContextRemainingPercent(agent)).toBe(25);
  });

  it('defaults to 200000 context limit when limit is 0', () => {
    const agent = createMockAgent({ contextUsed: 100000, contextLimit: 0 });
    // contextLimit || 200000 = 200000 when contextLimit is 0
    expect(getContextRemainingPercent(agent)).toBe(50);
  });

  it('handles zero contextUsed gracefully', () => {
    const agent = createMockAgent({ contextUsed: 0, contextLimit: 0 });
    // contextUsed || 0 = 0, contextLimit || 200000 = 200000
    expect(getContextRemainingPercent(agent)).toBe(100);
  });
});

describe('VisualConfig name labels', () => {
  let visualConfig: VisualConfig;
  let ctx: CanvasRenderingContext2D;

  beforeEach(() => {
    visualConfig = new VisualConfig({
      formatIdleTimeShort: vi.fn().mockReturnValue('1m'),
      getIdleTimerColor: vi.fn().mockReturnValue({
        bg: '#000000',
        border: '#ffffff',
        text: '#ffffff',
      }),
    } as any);
    ctx = {
      clearRect: vi.fn(),
      beginPath: vi.fn(),
      arc: vi.fn(),
      fill: vi.fn(),
      stroke: vi.fn(),
      strokeText: vi.fn(),
      fillText: vi.fn(),
      roundRect: vi.fn(),
      measureText: vi.fn((text: string) => {
        const match = /(\d+)px/.exec((ctx as any).font ?? '');
        const fontSize = match ? Number(match[1]) : 0;
        return { width: text.length * fontSize * 0.55 };
      }),
      font: '',
      textAlign: '',
      textBaseline: '',
      fillStyle: '',
      strokeStyle: '',
      lineWidth: 0,
      lineJoin: 'round',
      shadowColor: '',
      shadowBlur: 0,
      shadowOffsetX: 0,
      shadowOffsetY: 0,
    } as unknown as CanvasRenderingContext2D;

    vi.stubGlobal('document', {
      createElement: vi.fn().mockReturnValue({
        width: 0,
        height: 0,
        getContext: vi.fn().mockReturnValue(ctx),
      }),
    });
  });

  it('caps short names below the previous maximum font size', () => {
    visualConfig.drawNameLabel(ctx, 4096, 1024, 'Bo', 0x4a9eff, false, undefined, undefined);

    expect((ctx.fillText as any).mock.calls[0][0]).toBe('Bo');
    expect(ctx.font).toBe('bold 420px Arial');
  });

  it('uses the same cap when a task label is present', () => {
    visualConfig.drawNameLabel(ctx, 4096, 2048, 'Bo', 0x4a9eff, false, undefined, 'Answered GPT version');

    const finalTaskFontSize = Number(/(\d+)px/.exec(ctx.font)?.[1] ?? 0);
    expect(finalTaskFontSize).toBeLessThanOrEqual(357);
    expect(finalTaskFontSize).toBeGreaterThanOrEqual(200);
  });

  it('keeps long non-boss names at the same font size and truncates them to fit', () => {
    visualConfig.drawNameLabel(
      ctx,
      4096,
      1024,
      'ExtraordinarilyLongAgentNameThatNeedsToShrink',
      0x4a9eff,
      false,
      'claude',
      undefined
    );

    const finalFontSize = Number(/(\d+)px/.exec(ctx.font)?.[1] ?? 0);
    expect(finalFontSize).toBe(420);
    expect((ctx.fillText as any).mock.calls[0][0]).toContain('...');
  });

  it('uses a compact sprite scale for name-only labels', () => {
    const sprite = visualConfig.createNameLabelSprite('Juanito', 0x4a9eff, false, undefined, undefined);

    expect(sprite.userData.baseIndicatorScale).toBe(2.5);
    expect(sprite.scale.x).toBe(2.5);
    expect(sprite.scale.y).toBe(0.625);
  });

  it('uses the same base scale when a task label is present', () => {
    const sprite = visualConfig.createNameLabelSprite('Juanito', 0x4a9eff, false, undefined, 'Answered GPT version');

    expect(sprite.userData.baseIndicatorScale).toBe(2.5);
    expect(sprite.scale.x).toBe(2.5);
    expect(sprite.scale.y).toBe(1.25);
  });

  it('rebuilds existing name-only labels when layout rules change', () => {
    const oldSprite = {
      userData: {
        nameLabelLayoutVersion: 0,
        baseIndicatorScale: 2,
      },
      material: {
        map: { dispose: vi.fn() },
        dispose: vi.fn(),
      },
    };
    const group = {
      userData: {
        agentName: 'Juanito',
        _cachedTaskLabel: undefined,
        _cachedStatus: 'idle',
        _cachedPercent: 100,
        _cachedIsBoss: false,
        _cachedIdleBucket: 0,
        isBoss: false,
      },
      getObjectByName: vi.fn((name: string) => {
        if (name === 'nameLabelSprite') return oldSprite;
        if (name === 'statusBar') return {};
        return null;
      }),
      remove: vi.fn(),
      add: vi.fn(),
    } as any;
    const agent = createMockAgent({ name: 'Juanito', taskLabel: undefined, lastActivity: Date.now() });

    visualConfig.updateVisuals(group, agent, false, false, 0x4a9eff);

    expect(group.remove).toHaveBeenCalledWith(oldSprite);
    expect(group.add).toHaveBeenCalledTimes(1);
  });

  it('uses a larger status indicator scale for non-boss agents', () => {
    const sprite = visualConfig.createStatusBarSprite(75, 'idle', Date.now(), false, 2);

    expect(sprite.userData.baseIndicatorScale).toBe(2.1);
    expect(sprite.scale.x).toBe(2.1);
    expect(sprite.scale.y).toBe(1.3125);
  });

  it('uses a larger status indicator scale for boss agents', () => {
    const sprite = visualConfig.createStatusBarSprite(75, 'idle', Date.now(), true, 2.5);

    expect(sprite.userData.baseIndicatorScale).toBe(2.6);
    expect(sprite.scale.x).toBe(2.6);
    expect(sprite.scale.y).toBe(1.625);
  });
});
