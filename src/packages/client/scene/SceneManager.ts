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

    // Initialize post-processing (must be done after camera is created)
    this.sceneCore.initPostProcessing(this.cameraManager.getCamera());

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
        render: (camera) => this.sceneCore.render(camera),
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
    this.createEnvironmentMap();
    this.renderLoop.start();
  }

  /**
   * Create environment map for better model reflections.
   */
  private createEnvironmentMap(): void {
    const renderer = this.sceneCore.getRenderer();
    const scene = this.sceneCore.getScene();

    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    pmremGenerator.compileEquirectangularShader();

    // Create a simple sky-colored environment for reflections
    const envScene = new THREE.Scene();

    // Create gradient sky sphere
    const skyGeo = new THREE.SphereGeometry(100, 32, 32);
    const skyMat = new THREE.ShaderMaterial({
      uniforms: {
        topColor: { value: new THREE.Color(0x88bbff) },    // Light blue sky
        bottomColor: { value: new THREE.Color(0x446688) }, // Darker horizon
        offset: { value: 10 },
        exponent: { value: 0.6 },
      },
      vertexShader: `
        varying vec3 vWorldPosition;
        void main() {
          vec4 worldPosition = modelMatrix * vec4(position, 1.0);
          vWorldPosition = worldPosition.xyz;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 topColor;
        uniform vec3 bottomColor;
        uniform float offset;
        uniform float exponent;
        varying vec3 vWorldPosition;
        void main() {
          float h = normalize(vWorldPosition + offset).y;
          gl_FragColor = vec4(mix(bottomColor, topColor, max(pow(max(h, 0.0), exponent), 0.0)), 1.0);
        }
      `,
      side: THREE.BackSide,
    });
    envScene.add(new THREE.Mesh(skyGeo, skyMat));

    // Add bright ambient light to the env scene
    envScene.add(new THREE.AmbientLight(0xffffff, 1.0));

    // Generate environment map
    const envMap = pmremGenerator.fromScene(envScene, 0.04).texture;
    scene.environment = envMap;

    // Clean up
    pmremGenerator.dispose();
    skyGeo.dispose();
    skyMat.dispose();
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
      onGroundClickOutsideArea: () => this.inputEventHandlers.handleGroundClickOutsideArea(),
      onBuildingClick: (id: string, screenPos: { x: number; y: number }) => this.inputEventHandlers.handleBuildingClick(id, screenPos),
      onBuildingDoubleClick: (id: string) => this.inputEventHandlers.handleBuildingDoubleClick(id),
      onBuildingHover: (id: string | null, pos: { x: number; y: number } | null) => this.inputEventHandlers.handleBuildingHover(id, pos),
      onBuildingDragStart: () => {},
      onBuildingDragMove: (id: string, pos: { x: number; z: number }) => this.buildingManager.setBuildingPosition(id, pos),
      onBuildingDragEnd: (id: string, pos: { x: number; z: number }) => store.updateBuildingPosition(id, pos),
      onContextMenu: (screenPos: { x: number; y: number }, worldPos: { x: number; z: number }, target: { type: 'ground' | 'agent' | 'area' | 'building'; id?: string }) => this.callbackManager.triggerContextMenu(screenPos, worldPos, target),
      onActivity: () => this.renderLoop.markActivity(),
      onToggleTerminal: () => store.toggleTerminal(),
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
    // Scale agent indicators
    for (const [, meshData] of agentMeshes) {
      const distance = camera.position.distanceTo(meshData.group.position);
      const scale = Math.max(0.5, Math.min(2.5, distance / 15)) * indicatorScale;
      const isBoss = meshData.group.userData.isBoss === true;

      // New separate sprites (statusBar + nameLabelSprite)
      const statusBar = meshData.group.getObjectByName('statusBar') as THREE.Sprite;
      const nameLabelSprite = meshData.group.getObjectByName('nameLabelSprite') as THREE.Sprite;

      if (statusBar) {
        const baseScale = isBoss ? 2.8 : 2.2;
        const aspectRatio = 2560 / 4096; // canvas height / width (0.625)
        statusBar.scale.set(baseScale * scale, baseScale * aspectRatio * scale, 1);
      }

      if (nameLabelSprite) {
        const baseScale = isBoss ? 3.5 : 2.8;
        const aspectRatio = 1024 / 8192; // canvas height / width (0.125)
        nameLabelSprite.scale.set(baseScale * scale, baseScale * aspectRatio * scale, 1);
      }

      // Combined UI sprite (legacy - single sprite for all UI elements)
      const combinedUI = meshData.group.getObjectByName('combinedUI') as THREE.Sprite;
      if (combinedUI) {
        const baseScale = isBoss ? 2.0 : 1.6;
        const aspectRatio = 1024 / 2048; // canvas height / width (0.5)
        combinedUI.scale.set(baseScale * scale, baseScale * aspectRatio * scale, 1);
      }

      // Very old legacy sprites (fallback for oldest agents)
      if (!statusBar && !combinedUI) {
        const nameLabel = meshData.group.getObjectByName('nameLabel') as THREE.Sprite;
        if (nameLabel) {
          const baseHeight = 0.3 * scale;
          nameLabel.scale.set(baseHeight * (nameLabel.userData.aspectRatio || 2), baseHeight, 1);
        }

        const manaBar = meshData.group.getObjectByName('manaBar') as THREE.Sprite;
        if (manaBar) manaBar.scale.set(0.9, 0.14, 1); // Fixed size, no scaling

        const idleTimer = meshData.group.getObjectByName('idleTimer') as THREE.Sprite;
        if (idleTimer) idleTimer.scale.set(0.9 * scale, 0.14 * scale, 1);
      }
    }

    // Scale building labels (same behavior as agent labels)
    for (const [, meshData] of this.buildingManager.getBuildingMeshData()) {
      const distance = camera.position.distanceTo(meshData.group.position);
      const scale = Math.max(0.5, Math.min(2.5, distance / 15)) * indicatorScale;

      const buildingLabel = meshData.group.getObjectByName('buildingLabel') as THREE.Sprite;
      if (buildingLabel) {
        const baseHeight = 0.3 * scale;
        buildingLabel.scale.set(baseHeight * (buildingLabel.userData.aspectRatio || 2), baseHeight, 1);
      }
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

  // ============================================
  // Public API - Buildings
  // ============================================

  addBuilding(building: import('../../shared/types').Building): void { this.buildingManager.addBuilding(building); }
  removeBuilding(buildingId: string): void { this.buildingManager.removeBuilding(buildingId); }
  updateBuilding(building: import('../../shared/types').Building): void { this.buildingManager.updateBuilding(building); }
  syncBuildings(): void { this.buildingManager.syncFromStore(); }
  highlightBuilding(buildingId: string | null): void { this.buildingManager.highlightBuilding(buildingId); }
  setOnBuildingClick(callback: (buildingId: string, screenPos: { x: number; y: number }) => void): void { this.callbackManager.setOnBuildingClick(callback); }
  setOnBuildingDoubleClick(callback: (buildingId: string) => void): void { this.callbackManager.setOnBuildingDoubleClick(callback); }

  setOnContextMenu(callback: (screenPos: { x: number; y: number }, worldPos: { x: number; z: number }, target: { type: 'ground' | 'agent' | 'area' | 'building'; id?: string }) => void): void {
    this.callbackManager.setOnContextMenu(callback);
  }

  setOnAgentHover(callback: (agentId: string | null, screenPos: { x: number; y: number } | null) => void): void {
    this.callbackManager.setOnAgentHover(callback);
  }

  setOnBuildingHover(callback: (buildingId: string | null, screenPos: { x: number; y: number } | null) => void): void {
    this.callbackManager.setOnBuildingHover(callback);
  }

  setOnGroundClick(callback: () => void): void {
    this.callbackManager.setOnGroundClick(callback);
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

  setTerrainConfig(config: { showTrees: boolean; showBushes: boolean; showHouse: boolean; showLamps: boolean; showGrass: boolean; fogDensity: number; brightness?: number; skyColor?: string | null }): void {
    this.battlefield.setTerrainConfig(config);
    // Propagate brightness to all managers for materials that don't respond to lighting
    if (config.brightness !== undefined) {
      this.drawingManager.setBrightness(config.brightness);
      this.buildingManager.setBrightness(config.brightness);
      this.agentManager.setBrightness(config.brightness);
    }
  }

  setFloorStyle(style: string, force = false): void { this.battlefield.setFloorStyle(style as import('./environment/Battlefield').FloorStyle, force); }
  setIdleAnimation(animation: string): void { this.agentManager.setIdleAnimation(animation); }
  setWorkingAnimation(animation: string): void { this.agentManager.setWorkingAnimation(animation); }

  // ============================================
  // Public API - Agent Model Style
  // ============================================

  /**
   * Set agent model style settings (saturation, roughness, metalness, etc.)
   * Saturation is applied via shader injection on agent materials only.
   */
  setAgentModelStyle(style: { saturation?: number; roughness?: number; metalness?: number; emissiveBoost?: number; envMapIntensity?: number; wireframe?: boolean; colorMode?: string }): void {
    this.agentManager.setModelStyle(style);
  }

  /**
   * Get current agent model style settings.
   */
  getAgentModelStyle(): { saturation: number; roughness: number; metalness: number; emissiveBoost: number; envMapIntensity: number; wireframe: boolean; colorMode: string } {
    return this.agentManager.getModelStyle();
  }

  // ============================================
  // Public API - Post-Processing (Global Effects)
  // ============================================

  setGlobalSaturation(value: number): void { this.sceneCore.setSaturation(value); }
  getGlobalSaturation(): number { return this.sceneCore.getSaturation(); }
  setPostProcessingEnabled(enabled: boolean): void { this.sceneCore.setPostProcessingEnabled(enabled); }

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
    // Update camera reference for post-processing
    this.sceneCore.updateCamera(this.cameraManager.getCamera());

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

  getRenderStats(): { calls: number; triangles: number; points: number; lines: number } | null {
    const info = this.sceneCore.getRenderer()?.info?.render;
    return info ? { calls: info.calls, triangles: info.triangles, points: info.points, lines: info.lines } : null;
  }

  get renderer(): THREE.WebGLRenderer {
    return this.sceneCore.getRenderer();
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

// HMR: Accept updates to this module and its dependencies without full reload
// Changes are marked as pending for manual refresh via the UI button
if (import.meta.hot) {
  import.meta.hot.accept(() => {
    console.log('[Tide HMR] SceneManager updated - pending refresh available');
    window.__tideHmrPendingSceneChanges = true;
  });
}
