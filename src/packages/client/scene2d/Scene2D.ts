/**
 * Scene2D - Lightweight 2D top-down view alternative to 3D scene
 *
 * Provides the same functionality as SceneManager but renders using
 * Canvas 2D API for better performance on lower-end devices.
 *
 * Coordinates are shared with 3D view (X = left/right, Z = up/down in 2D)
 */

import type { Agent, Building, DrawingArea, BuiltInAgentClass, ContextStats } from '../../shared/types';
import { store } from '../store';
import { Scene2DRenderer } from './Scene2DRenderer';
import { Scene2DInput } from './Scene2DInput';
import { Scene2DCamera } from './Scene2DCamera';
import { Scene2DEffects } from './Scene2DEffects';
import { AGENT_CLASS_CONFIG, FORMATION_SPACING } from '../scene/config';
import { fpsTracker } from '../utils/profiling';

/**
 * Agent data for 2D rendering
 */
export interface Agent2DData {
  id: string;
  position: { x: number; z: number };
  name: string;
  class: string;
  status: string;
  isBoss: boolean;
  color: number;
  contextRemaining: number;
  lastActivity: number;
  subordinateIds?: string[];
  bossId?: string;
  currentTool?: string;
  contextUsed?: number;
  contextLimit?: number;
  contextStats?: ContextStats;
}

/**
 * Building data for 2D rendering
 */
export interface Building2DData {
  id: string;
  position: { x: number; z: number };
  name: string;
  style: string;
  status: string;
  color?: string;
  scale: number;
  subordinateBuildingIds?: string[];  // For boss buildings
}

/**
 * Area data for 2D rendering
 */
export interface Area2DData {
  id: string;
  type: 'rectangle' | 'circle';
  position: { x: number; z: number };
  size: { width: number; height: number } | { radius: number };
  color: string;
  label?: string;
  zIndex: number;
  hasDirectories?: boolean;
}

/**
 * Callbacks for scene interactions
 */
export interface Scene2DCallbacks {
  onAgentClick?: (agentId: string, shiftKey: boolean) => void;
  onAgentDoubleClick?: (agentId: string) => void;
  onAgentHover?: (agentId: string | null, screenPos: { x: number; y: number } | null) => void;
  onBuildingClick?: (buildingId: string, screenPos: { x: number; y: number }) => void;
  onBuildingDoubleClick?: (buildingId: string) => void;
  onBuildingDragStart?: (buildingId: string, startPos: { x: number; z: number }) => void;
  onBuildingDragMove?: (buildingId: string, currentPos: { x: number; z: number }) => void;
  onBuildingDragEnd?: (buildingId: string, endPos: { x: number; z: number }) => void;
  onBuildingDragCancel?: (buildingId: string) => void;
  onContextMenu?: (screenPos: { x: number; y: number }, worldPos: { x: number; z: number }, target: { type: string; id?: string } | null) => void;
  onGroundClick?: (worldPos: { x: number; z: number }) => void;
  onSelectionBox?: (start: { x: number; z: number }, end: { x: number; z: number }) => void;
  onMoveCommand?: (agentIds: string[], targetPos: { x: number; z: number }) => void;
  onAreaFolderClick?: (areaId: string) => void;
  onAreaDoubleClick?: (areaId: string) => void;
}

/**
 * Scene2D - Main class for 2D rendering
 */
export class Scene2D {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private renderer: Scene2DRenderer;
  private input: Scene2DInput;
  private camera: Scene2DCamera;
  private effects: Scene2DEffects;

  // Data
  private agents = new Map<string, Agent2DData>();
  private buildings = new Map<string, Building2DData>();
  private areas = new Map<string, Area2DData>();
  private selectedAgentIds = new Set<string>();
  private selectedBuildingIds = new Set<string>();

  // Animation
  private animationFrameId: number | null = null;
  private lastFrameTime = 0;
  private lastRenderTime = 0;
  private isRunning = false;

  // FPS limiting
  private fpsLimit = 0; // 0 = unlimited
  private frameInterval = 0; // Calculated from fpsLimit

  // Movements (for animation)
  private movements = new Map<string, {
    startPos: { x: number; z: number };
    endPos: { x: number; z: number };
    startTime: number;
    duration: number;
  }>();

  // Callbacks
  private callbacks: Scene2DCallbacks = {};

  // Configuration
  private indicatorScale = 0.7;
  private showGrid = true;
  private gridSize = 30; // World units
  private gridSpacing = 2; // World units between lines

  // Drawing state
  private drawingTool: 'rectangle' | 'circle' | 'select' | null = null;
  private isDrawing = false;
  private drawStartPos: { x: number; z: number } | null = null;
  private drawCurrentPos: { x: number; z: number } | null = null;

  // Area selection and resize state
  private selectedAreaId: string | null = null;
  private isResizingArea = false;
  private resizeHandleType: 'move' | 'nw' | 'ne' | 'sw' | 'se' | 'n' | 's' | 'e' | 'w' | 'radius' | null = null;
  private resizeStartPos: { x: number; z: number } | null = null;
  private resizeOriginalArea: Area2DData | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Failed to get 2D context');
    this.ctx = ctx;

    // Initialize subsystems
    this.camera = new Scene2DCamera(canvas.width, canvas.height);
    this.renderer = new Scene2DRenderer(ctx, this.camera);
    this.effects = new Scene2DEffects();
    this.input = new Scene2DInput(canvas, this.camera, this);

    // Handle resize
    this.handleResize();
    window.addEventListener('resize', this.handleResize);
  }

  // ============================================
  // Lifecycle
  // ============================================

  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.lastFrameTime = performance.now();
    this.animate();
  }

  stop(): void {
    this.isRunning = false;
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
  }

  dispose(): void {
    this.stop();
    // Save camera state before disposing
    this.camera.saveState();
    window.removeEventListener('resize', this.handleResize);
    this.input.dispose();
    this.agents.clear();
    this.buildings.clear();
    this.areas.clear();
  }

  private handleResize = (): void => {
    const parent = this.canvas.parentElement;
    if (!parent) return;

    const dpr = window.devicePixelRatio || 1;
    const width = parent.clientWidth;
    const height = parent.clientHeight;

    this.canvas.width = width * dpr;
    this.canvas.height = height * dpr;
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;

    this.ctx.scale(dpr, dpr);
    this.camera.setViewportSize(width, height);
  };

  // ============================================
  // Animation Loop
  // ============================================

  private animate = (): void => {
    if (!this.isRunning) return;

    this.animationFrameId = requestAnimationFrame(this.animate);

    const now = performance.now();

    // FPS limiting - skip render if not enough time has passed
    if (this.frameInterval > 0) {
      const elapsed = now - this.lastRenderTime;
      if (elapsed < this.frameInterval) {
        // Still update camera for smooth panning even when frame-limited
        const deltaTime = (now - this.lastFrameTime) / 1000;
        this.lastFrameTime = now;
        this.camera.update(deltaTime);
        return;
      }
      this.lastRenderTime = now;
    }

    // Track FPS for the FPSMeter component
    fpsTracker.tick();

    const deltaTime = (now - this.lastFrameTime) / 1000;
    this.lastFrameTime = now;

    // Update camera (smooth easing)
    this.camera.update(deltaTime);

    // Update movements
    this.updateMovements(now);

    // Update effects
    this.effects.update(deltaTime);

    // Update renderer animation time
    this.renderer.update(deltaTime);

    // Render
    this.render();
  };

  private updateMovements(now: number): void {
    const completedIds: string[] = [];

    for (const [agentId, movement] of this.movements) {
      const elapsed = now - movement.startTime;
      const linearProgress = Math.min(1, elapsed / movement.duration);

      // Use ease-out cubic for smooth deceleration (feels like walking/stopping)
      const progress = 1 - Math.pow(1 - linearProgress, 3);

      const agent = this.agents.get(agentId);
      if (agent) {
        agent.position.x = movement.startPos.x + (movement.endPos.x - movement.startPos.x) * progress;
        agent.position.z = movement.startPos.z + (movement.endPos.z - movement.startPos.z) * progress;
      }

      if (linearProgress >= 1) {
        completedIds.push(agentId);
      }
    }

    for (const id of completedIds) {
      this.movements.delete(id);
    }
  }

  private render(): void {
    const { width, height } = this.canvas;
    const dpr = window.devicePixelRatio || 1;

    // Clear
    this.ctx.clearRect(0, 0, width / dpr, height / dpr);

    // Draw ground
    this.renderer.drawGround(this.gridSize);

    // Draw grid
    if (this.showGrid) {
      this.renderer.drawGrid(this.gridSize, this.gridSpacing);
    }

    // Draw areas (sorted by zIndex - lower values first, higher on top)
    const sortedAreas = Array.from(this.areas.values()).sort((a, b) => a.zIndex - b.zIndex);
    for (const area of sortedAreas) {
      const isSelected = area.id === this.selectedAreaId;
      this.renderer.drawArea(area, isSelected);
    }

    // Draw boss-subordinate lines
    this.renderBossLines();

    // Draw buildings
    for (const building of this.buildings.values()) {
      const isSelected = this.selectedBuildingIds.has(building.id);
      this.renderer.drawBuilding(building, isSelected);
    }

    // Draw agents
    for (const agent of this.agents.values()) {
      const isSelected = this.selectedAgentIds.has(agent.id);
      const isMoving = this.movements.has(agent.id);
      this.renderer.drawAgent(agent, isSelected, isMoving, this.indicatorScale);
    }

    // Draw effects
    this.effects.render(this.ctx, this.camera);

    // Draw selection box if active
    const selectionBox = this.input.getSelectionBox();
    if (selectionBox) {
      this.renderer.drawSelectionBox(selectionBox.start, selectionBox.end);
    }

    // Draw area drawing preview if active
    const drawingPreview = this.getDrawingPreview();
    if (drawingPreview) {
      this.renderer.drawAreaPreview(drawingPreview.start, drawingPreview.end, drawingPreview.tool);
    }
  }

  private renderBossLines(): void {
    // Draw lines for selected boss agents to their subordinates
    for (const agentId of this.selectedAgentIds) {
      const agent = this.agents.get(agentId);
      if (!agent) continue;

      // If selected agent is a boss, show lines to subordinates
      if (agent.isBoss && agent.subordinateIds) {
        for (const subId of agent.subordinateIds) {
          const sub = this.agents.get(subId);
          if (sub) {
            this.effects.renderBossLine(this.ctx, this.camera, agent.position, sub.position);
          }
        }
      }

      // If selected agent has a boss, show that boss's hierarchy
      if (agent.bossId) {
        const boss = this.agents.get(agent.bossId);
        if (boss && boss.subordinateIds) {
          for (const subId of boss.subordinateIds) {
            const sub = this.agents.get(subId);
            if (sub) {
              this.effects.renderBossLine(this.ctx, this.camera, boss.position, sub.position);
            }
          }
        }
      }
    }

    // Draw lines for selected boss buildings to their subordinate buildings
    for (const buildingId of this.selectedBuildingIds) {
      const building = this.buildings.get(buildingId);
      if (!building) continue;

      // If selected building is a boss (has subordinates), show lines to them
      if (building.subordinateBuildingIds && building.subordinateBuildingIds.length > 0) {
        for (const subId of building.subordinateBuildingIds) {
          const sub = this.buildings.get(subId);
          if (sub) {
            this.effects.renderBossLine(this.ctx, this.camera, building.position, sub.position);
          }
        }
      }
    }

    // Also show lines when a subordinate building is selected (show connection to its boss)
    for (const buildingId of this.selectedBuildingIds) {
      // Find any boss building that has this building as a subordinate
      for (const building of this.buildings.values()) {
        if (building.subordinateBuildingIds?.includes(buildingId)) {
          // This building is a boss of the selected building, show all its connections
          for (const subId of building.subordinateBuildingIds) {
            const sub = this.buildings.get(subId);
            if (sub) {
              this.effects.renderBossLine(this.ctx, this.camera, building.position, sub.position);
            }
          }
          break; // A building can only have one boss
        }
      }
    }
  }

  // ============================================
  // Agent Management
  // ============================================

  addAgent(agent: Agent): void {
    const classConfig = AGENT_CLASS_CONFIG[agent.class as BuiltInAgentClass];
    const color = classConfig?.color ?? 0xffffff;

    this.agents.set(agent.id, {
      id: agent.id,
      position: { x: agent.position.x, z: agent.position.z },
      name: agent.name,
      class: agent.class,
      status: agent.status,
      isBoss: agent.isBoss === true || agent.class === 'boss',
      color,
      contextRemaining: 100 - (agent.contextUsed ?? 0),
      lastActivity: agent.lastActivity,
      subordinateIds: agent.subordinateIds,
      bossId: agent.bossId,
      currentTool: agent.currentTool,
      contextUsed: agent.contextUsed,
      contextLimit: agent.contextLimit,
      contextStats: agent.contextStats,
    });
  }

  removeAgent(agentId: string): void {
    this.agents.delete(agentId);
    this.movements.delete(agentId);
    this.selectedAgentIds.delete(agentId);
  }

  updateAgent(agent: Agent, animatePosition = true): void {
    const existing = this.agents.get(agent.id);
    if (!existing) {
      this.addAgent(agent);
      return;
    }

    const classConfig = AGENT_CLASS_CONFIG[agent.class as BuiltInAgentClass];
    const color = classConfig?.color ?? 0xffffff;

    // Check if there's an active movement animation
    const currentMovement = this.movements.get(agent.id);

    // If there's an active movement, check if the incoming position matches the target
    // Use a small epsilon for floating point comparison
    const epsilon = 0.01;
    let positionChanged: boolean;

    if (currentMovement) {
      // Compare incoming position with movement's end position
      const dx = Math.abs(currentMovement.endPos.x - agent.position.x);
      const dz = Math.abs(currentMovement.endPos.z - agent.position.z);
      positionChanged = dx > epsilon || dz > epsilon;
    } else {
      // No active movement - compare with existing position
      const dx = Math.abs(existing.position.x - agent.position.x);
      const dz = Math.abs(existing.position.z - agent.position.z);
      positionChanged = dx > epsilon || dz > epsilon;
    }

    if (positionChanged && animatePosition) {
      // Start movement animation from current visual position to new target
      const distance = Math.sqrt(
        Math.pow(agent.position.x - existing.position.x, 2) +
        Math.pow(agent.position.z - existing.position.z, 2)
      );
      // Walking speed: ~2 units per second for a natural walking pace
      const duration = (distance / 2) * 1000;

      this.movements.set(agent.id, {
        startPos: { x: existing.position.x, z: existing.position.z },
        endPos: { x: agent.position.x, z: agent.position.z },
        startTime: performance.now(),
        duration: Math.max(500, Math.min(duration, 3000)), // 500ms min, 3s max
      });
    } else if (positionChanged && !animatePosition && !currentMovement) {
      // Instant teleport - only if not currently animating
      existing.position.x = agent.position.x;
      existing.position.z = agent.position.z;
    }
    // If there's an active movement or position hasn't changed, preserve current animation

    // Update other properties
    existing.name = agent.name;
    existing.class = agent.class;
    existing.status = agent.status;
    existing.isBoss = agent.isBoss === true || agent.class === 'boss';
    existing.color = color;
    existing.contextRemaining = 100 - (agent.contextUsed ?? 0);
    existing.lastActivity = agent.lastActivity;
    existing.subordinateIds = agent.subordinateIds;
    existing.bossId = agent.bossId;
    existing.currentTool = agent.currentTool;
    existing.contextUsed = agent.contextUsed;
    existing.contextLimit = agent.contextLimit;
    existing.contextStats = agent.contextStats;
  }

  syncAgents(agents: Agent[]): void {
    // Remove agents that no longer exist or are in archived areas
    const agentIds = new Set(agents.map(a => a.id));
    for (const id of this.agents.keys()) {
      if (!agentIds.has(id) || store.isAgentInArchivedArea(id)) {
        this.removeAgent(id);
      }
    }

    // Add/update agents (skip those in archived areas)
    for (const agent of agents) {
      if (!store.isAgentInArchivedArea(agent.id)) {
        this.updateAgent(agent, false);
      }
    }
  }

  // ============================================
  // Building Management
  // ============================================

  addBuilding(building: Building): void {
    this.buildings.set(building.id, {
      id: building.id,
      position: { x: building.position.x, z: building.position.z },
      name: building.name,
      style: building.style,
      status: building.status,
      color: building.color,
      scale: building.scale || 1,
      subordinateBuildingIds: building.subordinateBuildingIds,
    });
  }

  removeBuilding(buildingId: string): void {
    this.buildings.delete(buildingId);
    this.selectedBuildingIds.delete(buildingId);
  }

  updateBuilding(building: Building): void {
    const existing = this.buildings.get(building.id);
    if (!existing) {
      this.addBuilding(building);
      return;
    }

    existing.position.x = building.position.x;
    existing.position.z = building.position.z;
    existing.name = building.name;
    existing.style = building.style;
    existing.status = building.status;
    existing.color = building.color;
    existing.scale = building.scale || 1;
    existing.subordinateBuildingIds = building.subordinateBuildingIds;
  }

  syncBuildings(): void {
    const state = store.getState();
    const buildingIds = new Set(state.buildings.keys());

    // Remove buildings that no longer exist
    for (const id of this.buildings.keys()) {
      if (!buildingIds.has(id)) {
        this.removeBuilding(id);
      }
    }

    // Add/update buildings
    for (const building of state.buildings.values()) {
      this.updateBuilding(building);
    }
  }

  // ============================================
  // Area Management
  // ============================================

  syncAreas(): void {
    const state = store.getState();
    this.areas.clear();

    for (const area of state.areas.values()) {
      // Skip archived areas - they should not be rendered
      if (area.archived) continue;

      const hasDirectories = area.directories && area.directories.length > 0;
      if (area.type === 'rectangle' && area.width && area.height) {
        this.areas.set(area.id, {
          id: area.id,
          type: 'rectangle',
          position: { x: area.center.x, z: area.center.z },
          size: { width: area.width, height: area.height },
          color: area.color,
          label: area.name,
          zIndex: area.zIndex ?? 0,
          hasDirectories,
        });
      } else if (area.type === 'circle' && area.radius) {
        this.areas.set(area.id, {
          id: area.id,
          type: 'circle',
          position: { x: area.center.x, z: area.center.z },
          size: { radius: area.radius },
          color: area.color,
          label: area.name,
          zIndex: area.zIndex ?? 0,
          hasDirectories,
        });
      }
    }
  }

  // ============================================
  // Area Selection & Resize
  // ============================================

  getSelectedAreaId(): string | null {
    return this.selectedAreaId;
  }

  selectArea(areaId: string | null): void {
    this.selectedAreaId = areaId;
    store.selectArea(areaId);
  }

  isAreaSelected(): boolean {
    return this.selectedAreaId !== null;
  }

  /**
   * Get the resize handle at a world position, if any.
   * Returns the handle type if within the handle hit area.
   */
  getAreaHandleAtWorldPos(worldX: number, worldZ: number): { areaId: string; handleType: 'move' | 'nw' | 'ne' | 'sw' | 'se' | 'n' | 's' | 'e' | 'w' | 'radius' } | null {
    if (!this.selectedAreaId) return null;

    const area = this.areas.get(this.selectedAreaId);
    if (!area) return null;

    const handleRadius = 0.4; // World units for handle hit area
    const zoom = this.camera.getZoom();
    const adaptiveRadius = handleRadius * (30 / Math.max(zoom, 10)); // Adapt to zoom level

    // Check move handle (center)
    const dxCenter = worldX - area.position.x;
    const dzCenter = worldZ - area.position.z;
    if (Math.sqrt(dxCenter * dxCenter + dzCenter * dzCenter) <= adaptiveRadius) {
      return { areaId: area.id, handleType: 'move' };
    }

    if (area.type === 'rectangle' && 'width' in area.size) {
      const { width, height } = area.size;
      // Check corner handles first (higher priority)
      const corners: { type: 'nw' | 'ne' | 'sw' | 'se'; x: number; z: number }[] = [
        { type: 'nw', x: area.position.x - width / 2, z: area.position.z - height / 2 },
        { type: 'ne', x: area.position.x + width / 2, z: area.position.z - height / 2 },
        { type: 'sw', x: area.position.x - width / 2, z: area.position.z + height / 2 },
        { type: 'se', x: area.position.x + width / 2, z: area.position.z + height / 2 },
      ];

      for (const corner of corners) {
        const dx = worldX - corner.x;
        const dz = worldZ - corner.z;
        if (Math.sqrt(dx * dx + dz * dz) <= adaptiveRadius) {
          return { areaId: area.id, handleType: corner.type };
        }
      }

      // Check edge handles (midpoints of each side)
      const edges: { type: 'n' | 's' | 'e' | 'w'; x: number; z: number }[] = [
        { type: 'n', x: area.position.x, z: area.position.z - height / 2 },
        { type: 's', x: area.position.x, z: area.position.z + height / 2 },
        { type: 'e', x: area.position.x + width / 2, z: area.position.z },
        { type: 'w', x: area.position.x - width / 2, z: area.position.z },
      ];

      for (const edge of edges) {
        const dx = worldX - edge.x;
        const dz = worldZ - edge.z;
        if (Math.sqrt(dx * dx + dz * dz) <= adaptiveRadius) {
          return { areaId: area.id, handleType: edge.type };
        }
      }
    } else if (area.type === 'circle' && 'radius' in area.size) {
      // Radius handle is on the right edge of the circle
      const handleX = area.position.x + area.size.radius;
      const handleZ = area.position.z;
      const dx = worldX - handleX;
      const dz = worldZ - handleZ;
      if (Math.sqrt(dx * dx + dz * dz) <= adaptiveRadius) {
        return { areaId: area.id, handleType: 'radius' };
      }
    }

    return null;
  }

  /**
   * Start resizing/moving an area.
   */
  startAreaResize(handleType: 'move' | 'nw' | 'ne' | 'sw' | 'se' | 'n' | 's' | 'e' | 'w' | 'radius', pos: { x: number; z: number }): void {
    if (!this.selectedAreaId) return;

    const area = this.areas.get(this.selectedAreaId);
    if (!area) return;

    this.isResizingArea = true;
    this.resizeHandleType = handleType;
    this.resizeStartPos = { ...pos };
    this.resizeOriginalArea = { ...area, size: { ...area.size } };
  }

  /**
   * Update resize/move during drag.
   */
  updateAreaResize(pos: { x: number; z: number }): void {
    if (!this.isResizingArea || !this.resizeOriginalArea || !this.resizeHandleType || !this.resizeStartPos) return;

    const area = this.resizeOriginalArea;
    let updates: { center?: { x: number; z: number }; width?: number; height?: number; radius?: number } = {};

    if (this.resizeHandleType === 'move') {
      const deltaX = pos.x - this.resizeStartPos.x;
      const deltaZ = pos.z - this.resizeStartPos.z;
      updates = {
        center: {
          x: area.position.x + deltaX,
          z: area.position.z + deltaZ,
        },
      };
    } else if (area.type === 'rectangle' && 'width' in area.size) {
      // Asymmetric resize: anchor the opposite side, only move the dragged side
      const deltaX = pos.x - this.resizeStartPos.x;
      const deltaZ = pos.z - this.resizeStartPos.z;
      const origW = area.size.width;
      const origH = area.size.height;
      const origCX = area.position.x;
      const origCZ = area.position.z;

      // Helper: compute new dimension/center when moving one side
      const moveRight = (dx: number) => {
        const newW = Math.max(0.5, origW + dx);
        return { width: newW, cx: origCX + (newW - origW) / 2 };
      };
      const moveLeft = (dx: number) => {
        const newW = Math.max(0.5, origW - dx);
        return { width: newW, cx: origCX + (origW - newW) / 2 };
      };
      const moveBottom = (dz: number) => {
        const newH = Math.max(0.5, origH + dz);
        return { height: newH, cz: origCZ + (newH - origH) / 2 };
      };
      const moveTop = (dz: number) => {
        const newH = Math.max(0.5, origH - dz);
        return { height: newH, cz: origCZ + (origH - newH) / 2 };
      };

      switch (this.resizeHandleType) {
        case 'se': {
          const r = moveRight(deltaX);
          const b = moveBottom(deltaZ);
          updates = { width: r.width, height: b.height, center: { x: r.cx, z: b.cz } };
          break;
        }
        case 'sw': {
          const l = moveLeft(deltaX);
          const b = moveBottom(deltaZ);
          updates = { width: l.width, height: b.height, center: { x: l.cx, z: b.cz } };
          break;
        }
        case 'ne': {
          const r = moveRight(deltaX);
          const t = moveTop(deltaZ);
          updates = { width: r.width, height: t.height, center: { x: r.cx, z: t.cz } };
          break;
        }
        case 'nw': {
          const l = moveLeft(deltaX);
          const t = moveTop(deltaZ);
          updates = { width: l.width, height: t.height, center: { x: l.cx, z: t.cz } };
          break;
        }
        case 'e': {
          const r = moveRight(deltaX);
          updates = { width: r.width, center: { x: r.cx, z: origCZ } };
          break;
        }
        case 'w': {
          const l = moveLeft(deltaX);
          updates = { width: l.width, center: { x: l.cx, z: origCZ } };
          break;
        }
        case 's': {
          const b = moveBottom(deltaZ);
          updates = { height: b.height, center: { x: origCX, z: b.cz } };
          break;
        }
        case 'n': {
          const t = moveTop(deltaZ);
          updates = { height: t.height, center: { x: origCX, z: t.cz } };
          break;
        }
      }
    } else if (area.type === 'circle' && this.resizeHandleType === 'radius') {
      const dx = pos.x - area.position.x;
      const dz = pos.z - area.position.z;
      const newRadius = Math.max(0.5, Math.sqrt(dx * dx + dz * dz));
      updates = { radius: newRadius };
    }

    if (Object.keys(updates).length > 0) {
      store.updateArea(this.selectedAreaId!, updates);
      // Immediately sync to reflect changes
      this.syncAreas();
    }
  }

  /**
   * Finish resize/move operation.
   */
  finishAreaResize(): void {
    this.isResizingArea = false;
    this.resizeHandleType = null;
    this.resizeStartPos = null;
    this.resizeOriginalArea = null;
  }

  /**
   * Check if currently resizing an area.
   */
  isCurrentlyResizingArea(): boolean {
    return this.isResizingArea;
  }

  // ============================================
  // Selection
  // ============================================

  setSelectedAgents(agentIds: Set<string>): void {
    this.selectedAgentIds = new Set(agentIds);
  }

  setSelectedBuildings(buildingIds: Set<string>): void {
    this.selectedBuildingIds = new Set(buildingIds);
  }

  refreshSelectionVisuals(): void {
    const state = store.getState();
    this.selectedAgentIds = new Set(state.selectedAgentIds);
    this.selectedBuildingIds = new Set(state.selectedBuildingIds);
  }

  // ============================================
  // Effects
  // ============================================

  createMoveOrderEffect(worldPos: { x: number; z: number }): void {
    this.effects.addMoveOrderEffect(worldPos);
  }

  /**
   * Call subordinates to form around a boss agent
   */
  callSubordinates(bossId: string): void {
    const state = store.getState();
    const boss = state.agents.get(bossId);
    if (!boss || !(boss.isBoss || boss.class === 'boss') || !boss.subordinateIds?.length) return;

    const bossPosition = { x: boss.position.x, z: boss.position.z };
    const positions = this.calculateFormationPositions(bossPosition, boss.subordinateIds.length);
    this.effects.addMoveOrderEffect(bossPosition);

    boss.subordinateIds.forEach((subId, index) => {
      const targetPos = positions[index];
      store.moveAgent(subId, { x: targetPos.x, y: 0, z: targetPos.z });

      // Animate the movement in 2D
      const agent = this.agents.get(subId);
      if (agent) {
        const distance = Math.sqrt(
          Math.pow(targetPos.x - agent.position.x, 2) +
          Math.pow(targetPos.z - agent.position.z, 2)
        );
        const duration = (distance / 2) * 1000; // Walking speed ~2 units/sec

        this.movements.set(subId, {
          startPos: { x: agent.position.x, z: agent.position.z },
          endPos: { x: targetPos.x, z: targetPos.z },
          startTime: performance.now(),
          duration: Math.max(500, Math.min(duration, 3000)),
        });
      }
    });
  }

  /**
   * Calculate formation positions for multiple agents around a center point
   */
  private calculateFormationPositions(
    center: { x: number; z: number },
    count: number
  ): { x: number; z: number }[] {
    const positions: { x: number; z: number }[] = [];

    if (count === 1) {
      return [{ x: center.x, z: center.z }];
    }

    if (count <= 6) {
      // Circle formation
      const radius = FORMATION_SPACING * Math.max(1, count / 3);
      for (let i = 0; i < count; i++) {
        const angle = (i / count) * Math.PI * 2 - Math.PI / 2;
        positions.push({
          x: center.x + Math.cos(angle) * radius,
          z: center.z + Math.sin(angle) * radius,
        });
      }
    } else {
      // Grid formation
      const cols = Math.ceil(Math.sqrt(count));
      const rows = Math.ceil(count / cols);
      const offsetX = ((cols - 1) * FORMATION_SPACING) / 2;
      const offsetZ = ((rows - 1) * FORMATION_SPACING) / 2;

      for (let i = 0; i < count; i++) {
        const col = i % cols;
        const row = Math.floor(i / cols);
        positions.push({
          x: center.x + col * FORMATION_SPACING - offsetX,
          z: center.z + row * FORMATION_SPACING - offsetZ,
        });
      }
    }

    return positions;
  }

  showToolBubble(agentId: string, toolName: string): void {
    const agent = this.agents.get(agentId);
    if (agent) {
      this.effects.addToolBubble(agentId, agent.position, toolName);
    }
  }

  // ============================================
  // Camera
  // ============================================

  focusAgent(agentId: string, zoomLevel?: number): void {
    const agent = this.agents.get(agentId);
    if (agent) {
      // Use focusOn for smooth animated camera movement
      this.camera.focusOn(agent.position.x, agent.position.z, zoomLevel);
    }
  }

  focusBuilding(buildingId: string, zoomLevel?: number): void {
    const building = this.buildings.get(buildingId);
    if (building) {
      this.camera.focusOn(building.position.x, building.position.z, zoomLevel);
    }
  }

  /**
   * Focus on all content (fit all agents and buildings in view)
   */
  focusOnContent(): void {
    if (this.agents.size === 0 && this.buildings.size === 0) {
      // Reset to origin if no content
      this.camera.focusOn(0, 0, 30);
      return;
    }

    // Calculate bounds of all content
    let minX = Infinity, maxX = -Infinity;
    let minZ = Infinity, maxZ = -Infinity;

    for (const agent of this.agents.values()) {
      minX = Math.min(minX, agent.position.x);
      maxX = Math.max(maxX, agent.position.x);
      minZ = Math.min(minZ, agent.position.z);
      maxZ = Math.max(maxZ, agent.position.z);
    }

    for (const building of this.buildings.values()) {
      minX = Math.min(minX, building.position.x);
      maxX = Math.max(maxX, building.position.x);
      minZ = Math.min(minZ, building.position.z);
      maxZ = Math.max(maxZ, building.position.z);
    }

    // Add some padding
    this.camera.focusOnBounds(minX, maxX, minZ, maxZ, 3);
  }

  getCamera(): Scene2DCamera {
    return this.camera;
  }

  // ============================================
  // Configuration
  // ============================================

  setIndicatorScale(scale: number): void {
    this.indicatorScale = scale;
  }

  setGridVisible(visible: boolean): void {
    this.showGrid = visible;
  }

  setFpsLimit(limit: number): void {
    this.fpsLimit = limit;
    this.frameInterval = limit > 0 ? 1000 / limit : 0;
    console.log(`[Tide 2D] FPS limit set to ${limit}, frameInterval: ${this.frameInterval}ms`);
  }

  // ============================================
  // Callbacks
  // ============================================

  setCallbacks(callbacks: Scene2DCallbacks): void {
    this.callbacks = { ...this.callbacks, ...callbacks };
  }

  // Called by Scene2DInput
  handleAgentClick(agentId: string, shiftKey: boolean): void {
    this.callbacks.onAgentClick?.(agentId, shiftKey);
  }

  handleAgentDoubleClick(agentId: string): void {
    this.callbacks.onAgentDoubleClick?.(agentId);
  }

  handleAgentHover(agentId: string | null, screenPos: { x: number; y: number } | null): void {
    this.callbacks.onAgentHover?.(agentId, screenPos);
  }

  handleBuildingClick(buildingId: string, screenPos: { x: number; y: number }): void {
    this.callbacks.onBuildingClick?.(buildingId, screenPos);
  }

  handleBuildingDoubleClick(buildingId: string): void {
    this.callbacks.onBuildingDoubleClick?.(buildingId);
  }

  handleBuildingHover(_buildingId: string | null): void {
    // Optional callback - building hover state is mainly used for visual feedback
    // Store in a member variable if we want to render hover effects
  }

  handleBuildingDragStart(buildingId: string, startPos: { x: number; z: number }): void {
    this.callbacks.onBuildingDragStart?.(buildingId, startPos);
  }

  handleBuildingDragMove(buildingId: string, currentPos: { x: number; z: number }): void {
    this.callbacks.onBuildingDragMove?.(buildingId, currentPos);
  }

  handleBuildingDragEnd(buildingId: string, endPos: { x: number; z: number }): void {
    this.callbacks.onBuildingDragEnd?.(buildingId, endPos);
  }

  handleBuildingDragCancel?(buildingId: string): void {
    this.callbacks.onBuildingDragCancel?.(buildingId);
  }

  handleContextMenu(screenPos: { x: number; y: number }, worldPos: { x: number; z: number }, target: { type: string; id?: string } | null): void {
    this.callbacks.onContextMenu?.(screenPos, worldPos, target);
  }

  handleGroundClick(worldPos: { x: number; z: number }): void {
    this.callbacks.onGroundClick?.(worldPos);
  }

  handleAreaFolderClick(areaId: string): void {
    store.openFileExplorerForArea(areaId);
    this.callbacks.onAreaFolderClick?.(areaId);
  }

  handleAreaDoubleClick(areaId: string): void {
    this.callbacks.onAreaDoubleClick?.(areaId);
  }

  /**
   * Check if a screen position is on an area's folder icon.
   * Returns the area ID if a folder icon was clicked, null otherwise.
   */
  getAreaFolderIconAtScreenPos(screenX: number, screenY: number): string | null {
    const worldPos = this.camera.screenToWorld(screenX, screenY);
    const _zoom = this.camera.getZoom();

    // Check areas in reverse zIndex order (topmost first)
    const sortedAreas = Array.from(this.areas.values()).sort((a, b) => b.zIndex - a.zIndex);

    for (const area of sortedAreas) {
      if (!area.hasDirectories) continue;

      // Calculate folder icon position (top-left corner of the area)
      const iconSize = 0.5; // World units - same as in AreaRenderer
      let iconX: number;
      let iconZ: number;

      if (area.type === 'rectangle' && 'width' in area.size) {
        iconX = area.position.x - area.size.width / 2 + iconSize * 0.8;
        iconZ = area.position.z - area.size.height / 2 + iconSize * 0.8;
      } else if (area.type === 'circle' && 'radius' in area.size) {
        // Top-left of bounding box
        const offset = area.size.radius * 0.707; // cos(45deg)
        iconX = area.position.x - offset + iconSize * 0.5;
        iconZ = area.position.z - offset + iconSize * 0.5;
      } else {
        continue;
      }

      // Check if click is within icon bounds
      const hitRadius = iconSize * 0.7;
      const dx = worldPos.x - iconX;
      const dz = worldPos.z - iconZ;
      if (Math.sqrt(dx * dx + dz * dz) <= hitRadius) {
        return area.id;
      }
    }

    return null;
  }

  handleSelectionBox(start: { x: number; z: number }, end: { x: number; z: number }): void {
    this.callbacks.onSelectionBox?.(start, end);
  }

  handleMoveCommand(targetPos: { x: number; z: number }): void {
    const agentIds = Array.from(this.selectedAgentIds);
    this.callbacks.onMoveCommand?.(agentIds, targetPos);
  }

  // ============================================
  // Queries
  // ============================================

  getAgents(): Map<string, Agent2DData> {
    return this.agents;
  }

  getBuildings(): Map<string, Building2DData> {
    return this.buildings;
  }

  getAgentData(agentId: string): Agent2DData | null {
    return this.agents.get(agentId) ?? null;
  }

  /**
   * Check if an agent has an active movement animation
   */
  hasActiveMovement(agentId: string): boolean {
    return this.movements.has(agentId);
  }

  getBuildingData(buildingId: string): Building2DData | null {
    return this.buildings.get(buildingId) ?? null;
  }

  getAgentAtScreenPos(screenX: number, screenY: number): Agent2DData | null {
    const worldPos = this.camera.screenToWorld(screenX, screenY);
    return this.getAgentAtWorldPos(worldPos.x, worldPos.z);
  }

  getAgentAtWorldPos(worldX: number, worldZ: number): Agent2DData | null {
    const hitRadius = 0.8; // World units

    for (const agent of this.agents.values()) {
      const dx = worldX - agent.position.x;
      const dz = worldZ - agent.position.z;
      const dist = Math.sqrt(dx * dx + dz * dz);

      if (dist <= hitRadius) {
        return agent;
      }
    }

    return null;
  }

  getBuildingAtScreenPos(screenX: number, screenY: number): Building2DData | null {
    const worldPos = this.camera.screenToWorld(screenX, screenY);
    return this.getBuildingAtWorldPos(worldPos.x, worldPos.z);
  }

  getBuildingAtWorldPos(worldX: number, worldZ: number): Building2DData | null {
    const hitRadius = 1.5; // World units

    for (const building of this.buildings.values()) {
      const dx = worldX - building.position.x;
      const dz = worldZ - building.position.z;
      const dist = Math.sqrt(dx * dx + dz * dz);

      if (dist <= hitRadius * building.scale) {
        return building;
      }
    }

    return null;
  }

  getAreaAtScreenPos(screenX: number, screenY: number): Area2DData | null {
    const worldPos = this.camera.screenToWorld(screenX, screenY);
    return this.getAreaAtWorldPos(worldPos.x, worldPos.z);
  }

  getAreaAtWorldPos(worldX: number, worldZ: number): Area2DData | null {
    // Sort areas by zIndex descending (highest first) so we check topmost areas first
    const sortedAreas = Array.from(this.areas.values()).sort((a, b) => b.zIndex - a.zIndex);

    for (const area of sortedAreas) {
      if (area.type === 'rectangle' && 'width' in area.size) {
        const { width, height } = area.size;
        const left = area.position.x - width / 2;
        const right = area.position.x + width / 2;
        const top = area.position.z - height / 2;
        const bottom = area.position.z + height / 2;

        if (worldX >= left && worldX <= right && worldZ >= top && worldZ <= bottom) {
          return area;
        }
      } else if (area.type === 'circle' && 'radius' in area.size) {
        const { radius } = area.size;
        const dx = worldX - area.position.x;
        const dz = worldZ - area.position.z;
        const dist = Math.sqrt(dx * dx + dz * dz);

        if (dist <= radius) {
          return area;
        }
      }
    }

    return null;
  }

  // ============================================
  // Drawing Methods
  // ============================================

  setDrawingTool(tool: 'rectangle' | 'circle' | 'select' | null): void {
    this.drawingTool = tool;
    store.setActiveTool(tool);
    if (!tool || tool === 'select') {
      this.cancelDrawing();
    }
  }

  getDrawingTool(): 'rectangle' | 'circle' | 'select' | null {
    return this.drawingTool;
  }

  isInDrawingMode(): boolean {
    return this.drawingTool === 'rectangle' || this.drawingTool === 'circle';
  }

  startDrawing(pos: { x: number; z: number }): void {
    if (!this.isInDrawingMode()) return;
    this.isDrawing = true;
    this.drawStartPos = { ...pos };
    this.drawCurrentPos = { ...pos };
  }

  updateDrawing(pos: { x: number; z: number }): void {
    if (!this.isDrawing || !this.drawStartPos) return;
    this.drawCurrentPos = { ...pos };
  }

  finishDrawing(pos: { x: number; z: number }): void {
    if (!this.isDrawing || !this.drawStartPos) {
      this.cancelDrawing();
      return;
    }

    this.drawCurrentPos = { ...pos };

    // Calculate area dimensions
    const area = this.createAreaFromDraw(this.drawStartPos, pos);

    // Clean up drawing state
    this.cancelDrawing();

    if (area) {
      // Add to store - this will trigger syncAreas via store subscription
      store.addArea(area);
    }
  }

  cancelDrawing(): void {
    this.isDrawing = false;
    this.drawStartPos = null;
    this.drawCurrentPos = null;
  }

  isCurrentlyDrawing(): boolean {
    return this.isDrawing;
  }

  getDrawingPreview(): { start: { x: number; z: number }; end: { x: number; z: number }; tool: 'rectangle' | 'circle' } | null {
    if (!this.isDrawing || !this.drawStartPos || !this.drawCurrentPos || !this.drawingTool) {
      return null;
    }
    if (this.drawingTool === 'select') return null;
    return {
      start: this.drawStartPos,
      end: this.drawCurrentPos,
      tool: this.drawingTool,
    };
  }

  private createAreaFromDraw(
    start: { x: number; z: number },
    end: { x: number; z: number }
  ): DrawingArea | null {
    if (!this.drawingTool || this.drawingTool === 'select') return null;

    const id = `area-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

    if (this.drawingTool === 'rectangle') {
      const minX = Math.min(start.x, end.x);
      const maxX = Math.max(start.x, end.x);
      const minZ = Math.min(start.z, end.z);
      const maxZ = Math.max(start.z, end.z);
      const width = maxX - minX;
      const height = maxZ - minZ;

      // Minimum size check
      if (width < 0.5 || height < 0.5) return null;

      return {
        id,
        name: 'New Area',
        type: 'rectangle',
        center: { x: (minX + maxX) / 2, z: (minZ + maxZ) / 2 },
        width,
        height,
        color: '#4a9eff',
        zIndex: store.getNextZIndex(),
        assignedAgentIds: [],
        directories: [],
      };
    } else if (this.drawingTool === 'circle') {
      const dx = end.x - start.x;
      const dz = end.z - start.z;
      const radius = Math.sqrt(dx * dx + dz * dz);

      // Minimum size check
      if (radius < 0.5) return null;

      return {
        id,
        name: 'New Area',
        type: 'circle',
        center: { x: start.x, z: start.z },
        radius,
        color: '#4a9eff',
        zIndex: store.getNextZIndex(),
        assignedAgentIds: [],
        directories: [],
      };
    }

    return null;
  }
}
