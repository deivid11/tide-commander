/**
 * Scene2DRenderer - Facade that delegates to domain-specific renderers.
 *
 * Renders agents, buildings, areas, grid, and effects using Canvas 2D API.
 */

import type { Agent2DData, Building2DData, Area2DData } from './Scene2D';
import type { Scene2DCamera } from './Scene2DCamera';
import {
  EffectRenderer,
  GridRenderer,
  AreaRenderer,
  BuildingRenderer,
  AgentRenderer,
} from './renderers';

export class Scene2DRenderer {
  private grid: GridRenderer;
  private area: AreaRenderer;
  private building: BuildingRenderer;
  private agent: AgentRenderer;
  private effect: EffectRenderer;

  constructor(ctx: CanvasRenderingContext2D, camera: Scene2DCamera) {
    this.effect = new EffectRenderer(ctx, camera);
    this.grid = new GridRenderer(ctx, camera);
    this.area = new AreaRenderer(ctx, camera);
    this.building = new BuildingRenderer(ctx, camera);
    this.agent = new AgentRenderer(ctx, camera, this.effect);
  }

  update(deltaTime: number): void {
    this.effect.update(deltaTime);
    // Sync animation time to all renderers
    const time = this.effect.getAnimationTime();
    this.grid.setAnimationTime(time);
    this.area.setAnimationTime(time);
    this.building.setAnimationTime(time);
    this.agent.setAnimationTime(time);
  }

  drawGround(size: number): void {
    this.grid.drawGround(size);
  }

  drawGrid(size: number, spacing: number): void {
    this.grid.drawGrid(size, spacing);
  }

  drawArea(area: Area2DData, isSelected: boolean = false): void {
    this.area.drawArea(area, isSelected);
  }

  drawBuilding(building: Building2DData, isSelected: boolean, isHovered: boolean = false): void {
    this.building.drawBuilding(building, isSelected, isHovered);
  }

  drawAgent(agent: Agent2DData, isSelected: boolean, isMoving: boolean, indicatorScale: number): void {
    this.agent.drawAgent(agent, isSelected, isMoving, indicatorScale);
  }

  drawBossLine(from: { x: number; z: number }, to: { x: number; z: number }): void {
    this.building.drawBossLine(from, to);
  }

  drawSelectionBox(start: { x: number; z: number }, end: { x: number; z: number }): void {
    this.agent.drawSelectionBox(start, end);
  }

  drawAreaPreview(start: { x: number; z: number }, end: { x: number; z: number }, tool: 'rectangle' | 'circle'): void {
    this.area.drawAreaPreview(start, end, tool);
  }

  updateAgentTool(agentId: string, currentTool: string | undefined): void {
    this.effect.updateAgentTool(agentId, currentTool);
  }

  getToolAnimation(agentId: string) {
    return this.effect.getToolAnimation(agentId);
  }
}
