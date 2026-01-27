import * as THREE from 'three';
import type { Agent, CustomAgentClass } from '../../shared/types';
import { store } from '../store';
import { memory } from '../utils/profiling';

// Import modules
import { CharacterLoader, CharacterFactory, type AgentMeshData } from './characters';
import { MovementAnimator, EffectsManager } from './animation';
import { ProceduralAnimator } from './animation/ProceduralAnimator';
import { Battlefield } from './environment';
import { InputHandler } from './input';
import { DrawingManager } from './drawing';
import { BuildingManager } from './buildings';

// Import extracted managers
import { AgentManager } from './AgentManager';
import { CallbackManager } from './CallbackManager';
import { RenderLoop } from './RenderLoop';
import { CameraManager } from './CameraManager';
import { SceneCore } from './SceneCore';
import { SelectionManager } from './SelectionManager';
import { InputEventHandlers } from './InputEventHandlers';

/**
 * Main scene orchestrator that coordinates all subsystems.
 * Delegates to specialized managers for specific concerns.
 */
export class SceneManager {
  // Core systems
  private sceneCore: SceneCore;
  private cameraManager: CameraManager;
  private renderLoop: RenderLoop;

  // Managers
  private agentManager: AgentManager;
  private selectionManager: SelectionManager;
  private callbackManager: CallbackManager;
  private inputEventHandlers!: InputEventHandlers;

  // Modules
  private characterLoader: CharacterLoader;
  private characterFactory: CharacterFactory;
  private movementAnimator: MovementAnimator;
  private proceduralAnimator: ProceduralAnimator;
  private effectsManager: EffectsManager;
  private battlefield: Battlefield;
  private inputHandler: InputHandler;
  private drawingManager: DrawingManager;
  private buildingManager: BuildingManager;

  // State
  private resizeObserver: ResizeObserver | null = null;
  private isReattaching = false;
  private proceduralBodiesCache = new Map<string, THREE.Object3D>();
  private proceduralBodiesDirty = true;
  private lastTimeUpdate = 0;

  constructor(canvas: HTMLCanvasElement, selectionBox: HTMLDivElement) {
    // Initialize core systems
    this.sceneCore = new SceneCore(canvas);
    this.cameraManager = new CameraManager(canvas, this.sceneCore.getRenderer());

    // Initialize character modules
    this.characterLoader = new CharacterLoader();
    this.characterFactory = new CharacterFactory(this.characterLoader);
    this.movementAnimator = new MovementAnimator();
    this.proceduralAnimator = new ProceduralAnimator();
    this.effectsManager = new EffectsManager(this.sceneCore.getScene());
    this.battlefield = new Battlefield(this.sceneCore.getScene());
    this.drawingManager = new DrawingManager(this.sceneCore.getScene());
    this.buildingManager = new BuildingManager(this.sceneCore.getScene());

    // Initialize agent manager
    this.agentManager = new AgentManager(
      this.sceneCore.getScene(),
      this.characterLoader,
      this.characterFactory,
      this.movementAnimator,
      this.proceduralAnimator,
      this.effectsManager
    );
    this.agentManager.setOnAgentMeshesChanged(() => this.updateInputHandlerReferences());
    this.agentManager.setOnProceduralCacheInvalidated(() => this.proceduralBodiesDirty = true);

    // Initialize selection manager
    this.selectionManager = new SelectionManager(
      this.sceneCore.getScene(),
      this.characterFactory,
      this.proceduralAnimator,
      () => this.agentManager.getAgentMeshes(),
      (agent, meshData) => this.agentManager.updateStatusAnimation(agent, meshData),
      (status) => this.agentManager.getProceduralStateForStatus(status)
    );
    this.selectionManager.setOnProceduralCacheInvalidated(() => this.proceduralBodiesDirty = true);

    // Initialize callback manager
    this.callbackManager = new CallbackManager();

    // Initialize render loop
    this.renderLoop = new RenderLoop(
      {
        getRenderer: () => this.sceneCore.getRenderer(),
        getScene: () => this.sceneCore.getScene(),
        getCamera: () => this.cameraManager.getCamera(),
        getControls: () => this.cameraManager.getControls(),
        getCanvas: () => this.sceneCore.getCanvas(),
        isReattaching: () => this.isReattaching,
        getAgentMeshes: () => this.agentManager.getAgentMeshes(),
      },
      {
        onUpdateBattlefield: (deltaTime, now) => this.updateBattlefield(deltaTime, now),
        onUpdateAnimations: () => this.updateAnimations(),
        onUpdateProceduralAnimations: (deltaTime) => this.updateProceduralAnimations(deltaTime),
        onHandleMovementCompletions: (ids) => this.agentManager.handleMovementCompletions(ids),
        onUpdateIdleTimers: () => this.agentManager.updateIdleTimers(),
        onUpdateBossSubordinateLines: () => this.selectionManager.updateBossSubordinateLines(this.movementAnimator.hasActiveMovements()),
        onUpdateIndicatorScales: (camera, meshes, scale) => this.updateIndicatorScales(camera, meshes, scale),
      }
    );
    this.renderLoop.setHasActiveMovements(() => this.movementAnimator.hasActiveMovements());

    // Initialize input handler (need to do this before InputEventHandlers)
    this.inputHandler = new InputHandler(
      canvas,
      this.cameraManager.getCamera(),
      this.cameraManager.getControls(),
      selectionBox,
      this.createInputCallbacks()
    );

    // Initialize input event handlers
    this.inputEventHandlers = new InputEventHandlers({
      getAgentMeshes: () => this.agentManager.getAgentMeshes(),
      movementAnimator: this.movementAnimator,
      effectsManager: this.effectsManager,
      drawingManager: this.drawingManager,
      buildingManager: this.buildingManager,
      callbackManager: this.callbackManager,
      renderLoop: this.renderLoop,
      inputHandler: this.inputHandler,
      refreshSelectionVisuals: () => this.refreshSelectionVisuals(),
    });

    this.setupInputHandlerHelpers();
    this.setupEventListeners(canvas);

    // Create environment and start render loop
    this.battlefield.create();
    this.renderLoop.start();
  }

  private createInputCallbacks() {
    return {
      onAgentClick: (id: string, shift: boolean) => this.inputEventHandlers.handleAgentClick(id, shift),
      onAgentDoubleClick: (id: string) => this.inputEventHandlers.handleAgentDoubleClick(id),
      onAgentHover: (id: string | null, pos: { x: number; y: number } | null) => this.inputEventHandlers.handleAgentHover(id, pos),
      onGroundClick: () => this.inputEventHandlers.handleGroundClick(),
      onMoveCommand: (pos: THREE.Vector3, ids: string[]) => this.inputEventHandlers.handleMoveCommand(pos, ids),
      onSelectionBox: (agents: string[], buildings: string[]) => this.inputEventHandlers.handleSelectionBox(agents, buildings),
      onDrawStart: (pos: { x: number; z: number }) => this.drawingManager.startDrawing(pos),
      onDrawMove: (pos: { x: number; z: number }) => this.drawingManager.updateDrawing(pos),
      onDrawEnd: (pos: { x: number; z: number }) => this.drawingManager.finishDrawing(pos),
      onAreaRightClick: (pos: { x: number; z: number }) => this.inputEventHandlers.handleAreaRightClick(pos),
      onResizeStart: (handle: THREE.Mesh, pos: { x: number; z: number }) => this.drawingManager.startResize(handle, pos),
      onResizeMove: (pos: { x: number; z: number }) => this.drawingManager.updateResize(pos),
      onResizeEnd: () => this.drawingManager.finishResize(),
      onAreaDoubleClick: (id: string) => this.inputEventHandlers.handleAreaDoubleClick(id),
      onGroundClickOutsideArea: () => this.inputEventHandlers.handleGroundClickOutsideArea(),
      onBuildingClick: (id: string) => this.inputEventHandlers.handleBuildingClick(id),
      onBuildingDoubleClick: (id: string) => this.inputEventHandlers.handleBuildingDoubleClick(id),
      onBuildingDragStart: () => {},
      onBuildingDragMove: (id: string, pos: { x: number; z: number }) => this.buildingManager.setBuildingPosition(id, pos),
      onBuildingDragEnd: (id: string, pos: { x: number; z: number }) => store.updateBuildingPosition(id, pos),
      onContextMenu: (screenPos: { x: number; y: number }, worldPos: { x: number; z: number }, target: { type: 'ground' | 'agent' | 'area' | 'building'; id?: string }) => this.callbackManager.triggerContextMenu(screenPos, worldPos, target),
      onActivity: () => this.renderLoop.markActivity(),
    };
  }

  private setupInputHandlerHelpers(): void {
    this.inputHandler.setDrawingModeChecker(() => this.drawingManager.isInDrawingMode());
    this.inputHandler.setResizeHandlers(
      () => this.drawingManager.getResizeHandles(),
      () => this.drawingManager.isCurrentlyResizing()
    );
    this.inputHandler.setAreaAtPositionGetter((pos) => this.drawingManager.getAreaAtPosition(pos));
    this.inputHandler.setBuildingAtPositionGetter((pos) => {
      const building = this.buildingManager.getBuildingAtPosition(pos);
      return building ? { id: building.id } : null;
    });
    this.inputHandler.setBuildingPositionsGetter(() => {
      const positions = new Map<string, THREE.Vector3>();
      for (const [id, data] of this.buildingManager.getBuildingMeshData()) {
        positions.set(id, data.group.position.clone());
      }
      return positions;
    });
  }

  private setupEventListeners(canvas: HTMLCanvasElement): void {
    window.addEventListener('resize', this.onWindowResize);
    this.resizeObserver = new ResizeObserver(() => this.onWindowResize());
    if (canvas.parentElement) {
      this.resizeObserver.observe(canvas.parentElement);
    }
    canvas.addEventListener('webglcontextlost', this.onContextLost);
    canvas.addEventListener('webglcontextrestored', this.onContextRestored);
  }

  private updateInputHandlerReferences(): void {
    this.inputHandler.setReferences(this.battlefield.getGround(), this.agentManager.getAgentMeshes());
  }

  private onContextLost = (event: Event): void => {
    event.preventDefault();
    console.error('[SceneManager] WebGL context lost! Stopping animation.');
    this.renderLoop.stop();
  };

  private onContextRestored = (): void => {
    console.log('[SceneManager] WebGL context restored! Restarting animation.');
    this.renderLoop.start();
  };

  private updateBattlefield(deltaTime: number, now: number): void {
    if (now - this.lastTimeUpdate > 60000) {
      this.battlefield.updateTimeOfDay();
      this.lastTimeUpdate = now;
    }
    this.battlefield.updateGalacticAnimation(deltaTime);
    this.battlefield.updateCloudAnimation(deltaTime);
  }

  private updateAnimations(): string[] {
    const completedMovements = this.movementAnimator.update(this.agentManager.getAgentMeshes());
    this.effectsManager.update();
    this.buildingManager.update(0.016);
    return completedMovements;
  }

  private updateProceduralAnimations(deltaTime: number): void {
    if (this.proceduralBodiesDirty) {
      this.proceduralBodiesCache.clear();
      for (const [agentId, meshData] of this.agentManager.getAgentMeshes()) {
        if (this.proceduralAnimator.has(agentId) && meshData.animations.size === 0) {
          const body = meshData.group.getObjectByName('characterBody');
          if (body) this.proceduralBodiesCache.set(agentId, body);
        }
      }
      this.proceduralBodiesDirty = false;
    }
    if (this.proceduralBodiesCache.size > 0) {
      this.proceduralAnimator.update(deltaTime, this.proceduralBodiesCache);
    }
  }

  private updateIndicatorScales(camera: THREE.PerspectiveCamera, agentMeshes: Map<string, AgentMeshData>, indicatorScale: number): void {
    for (const [, meshData] of agentMeshes) {
      const distance = camera.position.distanceTo(meshData.group.position);
      const scale = Math.max(0.5, Math.min(2.5, distance / 15)) * indicatorScale;

      const nameLabel = meshData.group.getObjectByName('nameLabel') as THREE.Sprite;
      if (nameLabel) {
        const baseHeight = 0.3 * scale;
        nameLabel.scale.set(baseHeight * (nameLabel.userData.aspectRatio || 2), baseHeight, 1);
      }

      const manaBar = meshData.group.getObjectByName('manaBar') as THREE.Sprite;
      if (manaBar) manaBar.scale.set(0.9 * scale, 0.14 * scale, 1);

      const idleTimer = meshData.group.getObjectByName('idleTimer') as THREE.Sprite;
      if (idleTimer) idleTimer.scale.set(0.9 * scale, 0.14 * scale, 1);
    }
    this.effectsManager.updateWithCamera(camera);
  }

  private onWindowResize = (): void => {
    const container = this.sceneCore.getCanvas().parentElement;
    if (!container) return;
    const { clientWidth: width, clientHeight: height } = container;
    if (width <= 0 || height <= 0) return;
    this.cameraManager.updateAspect(width, height);
    this.sceneCore.resize(width, height);
  };

  // ============================================
  // Public API - Character Models
  // ============================================

  async loadCharacterModels(): Promise<void> {
    await this.agentManager.loadCharacterModels();
  }

  upgradeAgentModels(): void {
    this.agentManager.upgradeAgentModels();
    this.updateInputHandlerReferences();
  }

  // ============================================
  // Public API - Agent Management
  // ============================================

  addAgent(agent: Agent): void { this.agentManager.addAgent(agent); }
  removeAgent(agentId: string): void { this.agentManager.removeAgent(agentId); this.updateInputHandlerReferences(); }
  updateAgent(agent: Agent, animatePosition = false): void { this.agentManager.updateAgent(agent, animatePosition); }
  syncAgents(agents: Agent[]): void { this.agentManager.syncAgents(agents); }
  setCustomAgentClasses(classes: Map<string, CustomAgentClass>): void { this.agentManager.setCustomAgentClasses(classes); }
  refreshSelectionVisuals(): void { this.selectionManager.refreshSelectionVisuals(); }

  // ============================================
  // Public API - Effects
  // ============================================

  createMoveOrderEffect(position: THREE.Vector3): void { this.effectsManager.createMoveOrderEffect(position); }

  showToolBubble(agentId: string, toolName: string, toolInput?: Record<string, unknown>): void {
    this.effectsManager.setAgentMeshes(this.agentManager.getAgentMeshes());
    this.effectsManager.createSpeechBubble(agentId, toolName, toolInput);
  }

  showDelegationEffect(bossId: string, subordinateId: string): void {
    this.effectsManager.setAgentMeshes(this.agentManager.getAgentMeshes());
    this.effectsManager.createDelegationEffect(bossId, subordinateId);
  }

  // ============================================
  // Public API - Camera
  // ============================================

  focusAgent(agentId: string): void { this.cameraManager.focusAgent(agentId); }

  callSubordinates(bossId: string): void {
    const state = store.getState();
    const boss = state.agents.get(bossId);
    if (!boss || !(boss.isBoss || boss.class === 'boss') || !boss.subordinateIds?.length) return;

    const bossPosition = new THREE.Vector3(boss.position.x, boss.position.y, boss.position.z);
    const positions = this.inputHandler.calculateFormationPositions(bossPosition, boss.subordinateIds.length);
    this.effectsManager.createMoveOrderEffect(bossPosition.clone());

    boss.subordinateIds.forEach((subId, index) => {
      const meshData = this.agentManager.getAgentMeshes().get(subId);
      store.moveAgent(subId, positions[index]);
      if (meshData) this.movementAnimator.startMovement(subId, meshData, positions[index]);
    });
  }

  // ============================================
  // Public API - Drawing
  // ============================================

  setDrawingTool(tool: 'rectangle' | 'circle' | 'select' | null): void { this.drawingManager.setTool(tool); store.setActiveTool(tool); }
  syncAreas(): void { this.drawingManager.syncFromStore(); }
  highlightArea(areaId: string | null): void { this.drawingManager.highlightArea(areaId); }
  clearAreaSelection(): void { this.drawingManager.highlightArea(null); }
  setOnAreaDoubleClick(callback: (areaId: string) => void): void { this.callbackManager.setOnAreaDoubleClick(callback); }

  // ============================================
  // Public API - Buildings
  // ============================================

  addBuilding(building: import('../../shared/types').Building): void { this.buildingManager.addBuilding(building); }
  removeBuilding(buildingId: string): void { this.buildingManager.removeBuilding(buildingId); }
  updateBuilding(building: import('../../shared/types').Building): void { this.buildingManager.updateBuilding(building); }
  syncBuildings(): void { this.buildingManager.syncFromStore(); }
  highlightBuilding(buildingId: string | null): void { this.buildingManager.highlightBuilding(buildingId); }
  setOnBuildingClick(callback: (buildingId: string) => void): void { this.callbackManager.setOnBuildingClick(callback); }
  setOnBuildingDoubleClick(callback: (buildingId: string) => void): void { this.callbackManager.setOnBuildingDoubleClick(callback); }

  setOnContextMenu(callback: (screenPos: { x: number; y: number }, worldPos: { x: number; z: number }, target: { type: 'ground' | 'agent' | 'area' | 'building'; id?: string }) => void): void {
    this.callbackManager.setOnContextMenu(callback);
  }

  setOnAgentHover(callback: (agentId: string | null, screenPos: { x: number; y: number } | null) => void): void {
    this.callbackManager.setOnAgentHover(callback);
  }

  // ============================================
  // Public API - Config
  // ============================================

  setCharacterScale(scale: number): void { this.agentManager.setCharacterScale(scale); this.selectionManager.setCharacterScale(scale); }
  setIndicatorScale(scale: number): void { this.renderLoop.setIndicatorScale(scale); this.effectsManager.setIndicatorScale(scale); }
  setFpsLimit(limit: number): void { this.renderLoop.setFpsLimit(limit); }
  setPowerSaving(enabled: boolean): void { this.renderLoop.setPowerSaving(enabled); }
  setGridVisible(visible: boolean): void { this.battlefield.setGridVisible(visible); }
  setDebugTime(hour: number | null): void { this.battlefield.setDebugTime(hour); }
  setTimeMode(mode: string): void { this.battlefield.setTimeMode(mode); }

  setTerrainConfig(config: { showTrees: boolean; showBushes: boolean; showHouse: boolean; showLamps: boolean; showGrass: boolean; fogDensity: number }): void {
    this.battlefield.setTerrainConfig(config);
  }

  setFloorStyle(style: string, force = false): void { this.battlefield.setFloorStyle(style as import('./environment/Battlefield').FloorStyle, force); }
  setIdleAnimation(animation: string): void { this.agentManager.setIdleAnimation(animation); }
  setWorkingAnimation(animation: string): void { this.agentManager.setWorkingAnimation(animation); }

  // ============================================
  // HMR Support
  // ============================================

  reattach(canvas: HTMLCanvasElement, selectionBox: HTMLDivElement): void {
    console.log('[SceneManager] Reattaching to new canvas (HMR)');
    this.isReattaching = true;
    this.renderLoop.stop();
    this.resizeObserver?.disconnect();

    const oldCanvas = this.sceneCore.getCanvas();
    oldCanvas.removeEventListener('webglcontextlost', this.onContextLost);
    oldCanvas.removeEventListener('webglcontextrestored', this.onContextRestored);

    this.sceneCore.reattach(canvas);
    this.cameraManager.recreateControls(this.sceneCore.getRenderer());

    canvas.addEventListener('webglcontextlost', this.onContextLost);
    canvas.addEventListener('webglcontextrestored', this.onContextRestored);

    this.inputHandler.reattach(canvas, selectionBox, this.cameraManager.getControls());
    this.updateInputHandlerReferences();

    if (canvas.parentElement) this.resizeObserver?.observe(canvas.parentElement);
    this.onWindowResize();

    // Use a retry mechanism to ensure canvas is connected before restarting
    const tryRestartLoop = (attempts = 0): void => {
      this.isReattaching = false;
      if (canvas.isConnected && this.sceneCore.getRenderer()) {
        console.log('[SceneManager] Restarting animation loop after HMR reattach');
        this.renderLoop.start();
      } else if (attempts < 10) {
        // Canvas not connected yet, retry after a frame
        console.log(`[SceneManager] Canvas not connected, retrying... (attempt ${attempts + 1})`);
        this.isReattaching = true;
        requestAnimationFrame(() => tryRestartLoop(attempts + 1));
      } else {
        console.warn('[SceneManager] Failed to restart animation loop - canvas never connected');
      }
    };
    requestAnimationFrame(() => tryRestartLoop());
  }

  // ============================================
  // Memory Diagnostics
  // ============================================

  getMemoryDiagnostics(): { threeJs: { geometries: number; textures: number; programs: number } | null; heap: { usedMB: number; totalMB: number; limitMB: number } | null; agentMeshCount: number; bossLineCount: number } {
    const info = this.sceneCore.getRenderer().info;
    return {
      threeJs: info?.memory ? { geometries: info.memory.geometries, textures: info.memory.textures, programs: info.programs?.length ?? 0 } : null,
      heap: memory.getUsage(),
      agentMeshCount: this.agentManager.getAgentMeshes().size,
      bossLineCount: 0,
    };
  }

  logMemoryDiagnostics(): void {
    const diag = this.getMemoryDiagnostics();
    const cache = this.characterLoader.getCacheStats();
    console.group('%c[SceneManager Memory]', 'color: #ff6600; font-weight: bold');
    if (diag.threeJs) console.log(`Three.js: ${diag.threeJs.geometries} geometries, ${diag.threeJs.textures} textures, ${diag.threeJs.programs} programs`);
    if (diag.heap) console.log(`Heap: ${diag.heap.usedMB}MB / ${diag.heap.totalMB}MB (limit: ${diag.heap.limitMB}MB)`);
    console.log(`Agent meshes: ${diag.agentMeshCount}`);
    console.log(`CharacterLoader cache: ${cache.builtInModels} built-in, ${cache.customModels} custom`);
    if (cache.modelNames.length > 0) console.log(`  Built-in models: ${cache.modelNames.join(', ')}`);
    if (cache.customModelIds.length > 0) console.log(`  Custom models: ${cache.customModelIds.join(', ')}`);
    console.groupEnd();
  }

  // ============================================
  // Cleanup
  // ============================================

  dispose(): void {
    console.log('%c[SceneManager] dispose() called - starting cleanup', 'color: #ff0000; font-weight: bold');
    const preStats = this.characterLoader.getCacheStats();
    console.log(`[SceneManager] Pre-dispose: ${preStats.builtInModels} built-in models, ${preStats.customModels} custom models`);

    this.renderLoop.stop();
    window.removeEventListener('resize', this.onWindowResize);
    const canvas = this.sceneCore.getCanvas();
    canvas.removeEventListener('webglcontextlost', this.onContextLost);
    canvas.removeEventListener('webglcontextrestored', this.onContextRestored);
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;

    this.inputHandler.dispose();
    this.drawingManager.dispose();
    this.buildingManager.dispose();
    this.effectsManager.dispose();
    this.agentManager.dispose();
    this.selectionManager.dispose();
    this.battlefield.dispose();
    this.characterLoader.dispose();
    this.cameraManager.dispose();
    this.sceneCore.dispose();

    console.log('%c[SceneManager] dispose() complete - all resources freed', 'color: #00ff00; font-weight: bold');
  }
}
