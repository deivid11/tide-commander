import type { Scene2DCamera } from '../Scene2DCamera';
import { BaseRenderer } from './BaseRenderer';

export interface ToolAnimationState {
  tool: string;
  startTime: number;
  fadeIn: boolean;
  opacity: number;
}

const TOOL_FADE_DURATION = 200;

export class EffectRenderer extends BaseRenderer {
  private toolAnimations: Map<string, ToolAnimationState> = new Map();

  constructor(ctx: CanvasRenderingContext2D, camera: Scene2DCamera) {
    super(ctx, camera);
  }

  update(deltaTime: number): void {
    this.animationTime += deltaTime;
    this.updateToolAnimations();
  }

  getAnimationTime(): number {
    return this.animationTime;
  }

  private updateToolAnimations(): void {
    const now = performance.now();
    const toRemove: string[] = [];

    for (const [agentId, state] of this.toolAnimations) {
      const elapsed = now - state.startTime;
      const progress = Math.min(1, elapsed / TOOL_FADE_DURATION);

      if (state.fadeIn) {
        state.opacity = this.easeOutCubic(progress);
      } else {
        state.opacity = 1 - this.easeInCubic(progress);

        if (progress >= 1) {
          toRemove.push(agentId);
        }
      }
    }

    for (const id of toRemove) {
      this.toolAnimations.delete(id);
    }
  }

  updateAgentTool(agentId: string, currentTool: string | undefined): void {
    const existing = this.toolAnimations.get(agentId);
    const now = performance.now();

    if (currentTool) {
      if (!existing || existing.tool !== currentTool || !existing.fadeIn) {
        this.toolAnimations.set(agentId, {
          tool: currentTool,
          startTime: now,
          fadeIn: true,
          opacity: existing?.opacity ?? 0,
        });
      }
    } else {
      if (existing && existing.fadeIn) {
        existing.fadeIn = false;
        existing.startTime = now;
      }
    }
  }

  getToolAnimation(agentId: string): ToolAnimationState | undefined {
    return this.toolAnimations.get(agentId);
  }
}
