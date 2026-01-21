import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { Agent, DrawingArea, CustomAgentClass } from '../../shared/types';
import { store } from '../store';
import { saveCameraState, loadCameraState } from '../utils/camera';
import { CAMERA_SAVE_INTERVAL } from './config';
import { perf, fpsTracker } from '../utils/profiling';

// Import modules
import { CharacterLoader, CharacterFactory, type AgentMeshData } from './characters';
import { MovementAnimator, EffectsManager, ANIMATIONS } from './animation';
import { Battlefield } from './environment';
import { InputHandler } from './input';
import { DrawingManager } from './drawing';
import { BuildingManager } from './buildings';

/**
 * Main scene orchestrator that coordinates all subsystems.
 */
export class SceneManager {
  // Core Three.js
  private canvas: HTMLCanvasElement;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private controls: OrbitControls;

  // Modules
  private characterLoader: CharacterLoader;
  private characterFactory: CharacterFactory;
  private movementAnimator: MovementAnimator;
  private effectsManager: EffectsManager;
  private battlefield: Battlefield;
  private inputHandler: InputHandler;
  private drawingManager: DrawingManager;
  private buildingManager: BuildingManager;

  // State
  private agentMeshes = new Map<string, AgentMeshData>();
  private bossSubordinateLines: THREE.Line[] = [];
  private lastCameraSave = 0;
  private lastTimeUpdate = 0;
  private lastFrameTime = 0;
  private lastRenderTime = 0; // For FPS limiting
  private lastIdleTimerUpdate = 0;
  private characterScale = 0.5;
  private indicatorScale = 1.0;
  private idleAnimation: string = ANIMATIONS.SIT;
  private workingAnimation: string = ANIMATIONS.WALK;
  private fpsLimit = 0; // 0 = unlimited
  private frameInterval = 0; // Calculated from fpsLimit
  private resizeObserver: ResizeObserver | null = null;

  // Callbacks
  private onAreaDoubleClickCallback: ((areaId: string) => void) | null = null;
  private onBuildingClickCallback: ((buildingId: string) => void) | null = null;
  private onBuildingDoubleClickCallback: ((buildingId: string) => void) | null = null;

  constructor(canvas: HTMLCanvasElement, selectionBox: HTMLDivElement) {
    this.canvas = canvas;

    // Initialize Three.js core
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0a0a12);

    this.camera = this.createCamera();
    this.renderer = this.createRenderer();
    this.controls = this.createControls();

    // Initialize modules
    this.characterLoader = new CharacterLoader();
    this.characterFactory = new CharacterFactory(this.characterLoader);
    this.movementAnimator = new MovementAnimator();
    this.effectsManager = new EffectsManager(this.scene);
    this.battlefield = new Battlefield(this.scene);
    this.drawingManager = new DrawingManager(this.scene);
    this.buildingManager = new BuildingManager(this.scene);

    this.inputHandler = new InputHandler(
      canvas,
      this.camera,
      this.controls,
      selectionBox,
      {
        onAgentClick: this.handleAgentClick.bind(this),
        onAgentDoubleClick: this.handleAgentDoubleClick.bind(this),
        onGroundClick: this.handleGroundClick.bind(this),
        onMoveCommand: this.handleMoveCommand.bind(this),
        onSelectionBox: this.handleSelectionBox.bind(this),
        onDrawStart: this.handleDrawStart.bind(this),
        onDrawMove: this.handleDrawMove.bind(this),
        onDrawEnd: this.handleDrawEnd.bind(this),
        onAreaRightClick: this.handleAreaRightClick.bind(this),
        onResizeStart: this.handleResizeStart.bind(this),
        onResizeMove: this.handleResizeMove.bind(this),
        onResizeEnd: this.handleResizeEnd.bind(this),
        onAreaDoubleClick: this.handleAreaDoubleClick.bind(this),
        onGroundClickOutsideArea: this.handleGroundClickOutsideArea.bind(this),
        onBuildingClick: this.handleBuildingClick.bind(this),
        onBuildingDoubleClick: this.handleBuildingDoubleClick.bind(this),
        onBuildingDragStart: this.handleBuildingDragStart.bind(this),
        onBuildingDragMove: this.handleBuildingDragMove.bind(this),
        onBuildingDragEnd: this.handleBuildingDragEnd.bind(this),
      }
    );

    // Set up drawing mode checker
    this.inputHandler.setDrawingModeChecker(() => this.drawingManager.isInDrawingMode());

    // Set up resize handlers
    this.inputHandler.setResizeHandlers(
      () => this.drawingManager.getResizeHandles(),
      () => this.drawingManager.isCurrentlyResizing()
    );

    // Set up area at position getter (for double-click detection)
    this.inputHandler.setAreaAtPositionGetter((pos) => this.drawingManager.getAreaAtPosition(pos));

    // Set up building at position getter (for drag/click detection)
    this.inputHandler.setBuildingAtPositionGetter((pos) => {
      const building = this.buildingManager.getBuildingAtPosition(pos);
      return building ? { id: building.id } : null;
    });

    // Set up building positions getter (for drag selection)
    this.inputHandler.setBuildingPositionsGetter(() => {
      const positions = new Map<string, THREE.Vector3>();
      const meshData = this.buildingManager.getBuildingMeshData();
      for (const [buildingId, data] of meshData) {
        positions.set(buildingId, data.group.position.clone());
      }
      return positions;
    });

    // Create environment
    this.battlefield.create();

    // Event listeners
    window.addEventListener('resize', this.onWindowResize);

    // Use ResizeObserver for more reliable resize detection
    // This handles cases where the container resizes without window resize
    this.resizeObserver = new ResizeObserver(() => {
      this.onWindowResize();
    });
    if (this.canvas.parentElement) {
      this.resizeObserver.observe(this.canvas.parentElement);
    }

    // Start render loop
    this.animate();
  }

  // ============================================
  // Initialization
  // ============================================

  private createCamera(): THREE.PerspectiveCamera {
    const camera = new THREE.PerspectiveCamera(
      60,
      this.canvas.clientWidth / this.canvas.clientHeight,
      0.1,
      1000
    );

    const savedCamera = loadCameraState();
    if (savedCamera) {
      camera.position.set(savedCamera.position.x, savedCamera.position.y, savedCamera.position.z);
      camera.lookAt(savedCamera.target.x, savedCamera.target.y, savedCamera.target.z);
    } else {
      camera.position.set(0, 15, 15);
      camera.lookAt(0, 0, 0);
    }

    return camera;
  }

  private createRenderer(): THREE.WebGLRenderer {
    const renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true });
    renderer.setSize(this.canvas.clientWidth, this.canvas.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    return renderer;
  }

  private createControls(): OrbitControls {
    const controls = new OrbitControls(this.camera, this.renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.minDistance = 5;
    controls.maxDistance = 50;
    controls.maxPolarAngle = Math.PI / 2.2;

    const savedCamera = loadCameraState();
    if (savedCamera) {
      controls.target.set(savedCamera.target.x, savedCamera.target.y, savedCamera.target.z);
    }

    controls.mouseButtons = {
      LEFT: null as unknown as THREE.MOUSE,
      MIDDLE: THREE.MOUSE.ROTATE,
      RIGHT: null as unknown as THREE.MOUSE,
    };
    controls.enablePan = true;
    controls.screenSpacePanning = true;

    // Disable default zoom - we handle it in InputHandler for mouse-position-aware zooming
    controls.enableZoom = false;

    return controls;
  }

  // ============================================
  // Public API - Character Models
  // ============================================

  async loadCharacterModels(): Promise<void> {
    await this.characterLoader.loadAll();
  }

  upgradeAgentModels(): void {
    if (!this.characterLoader.isLoaded) return;

    const state = store.getState();
    const customClasses = state.customAgentClasses;

    for (const [agentId, meshData] of this.agentMeshes) {
      const agent = state.agents.get(agentId);
      if (!agent) continue;

      const body = meshData.group.getObjectByName('characterBody');

      // Check if agent needs upgrade:
      // 1. Using fallback capsule (CapsuleGeometry)
      // 2. Has a custom class and the model might have changed
      const isCapsule = body instanceof THREE.Mesh && body.geometry instanceof THREE.CapsuleGeometry;
      const hasCustomClass = customClasses.has(agent.class);
      const needsUpgrade = isCapsule || hasCustomClass;

      if (needsUpgrade) {
        // Preserve current mesh position (might be mid-animation)
        const currentPosition = meshData.group.position.clone();

        // Create new mesh data with proper model
        const newMeshData = this.characterFactory.createAgentMesh(agent);

        // Use current mesh position, not stored agent position (handles animation)
        newMeshData.group.position.copy(currentPosition);

        // Apply current character scale (with boss multiplier if applicable)
        const newBody = newMeshData.group.getObjectByName('characterBody');
        if (newBody) {
          const bossMultiplier = (agent.isBoss || agent.class === 'boss') ? 1.5 : 1.0;
          newBody.scale.setScalar(this.characterScale * bossMultiplier);
        }

        // Replace in scene
        this.scene.remove(meshData.group);
        this.scene.add(newMeshData.group);
        this.agentMeshes.set(agentId, newMeshData);

        // Start status-based animation (sit if idle)
        this.updateStatusAnimation(agent, newMeshData);

        console.log(`[SceneManager] Upgraded ${agent.name} to character model (isCapsule=${isCapsule}, hasCustomClass=${hasCustomClass})`);
      }
    }

    // Update input handler references
    this.inputHandler.setReferences(this.battlefield.getGround(), this.agentMeshes);
  }

  // ============================================
  // Public API - Agent Management
  // ============================================

  addAgent(agent: Agent): void {
    // Remove existing mesh if present (prevent duplicates)
    const existing = this.agentMeshes.get(agent.id);
    if (existing) {
      this.scene.remove(existing.group);
      this.agentMeshes.delete(agent.id);
    }

    const meshData = this.characterFactory.createAgentMesh(agent);
    this.scene.add(meshData.group);
    this.agentMeshes.set(agent.id, meshData);

    // Apply current character scale (with boss multiplier if applicable)
    const body = meshData.group.getObjectByName('characterBody');
    if (body) {
      const bossMultiplier = (agent.isBoss || agent.class === 'boss') ? 1.5 : 1.0;
      body.scale.setScalar(this.characterScale * bossMultiplier);
    }

    // Set animation based on agent's current status
    this.updateStatusAnimation(agent, meshData);

    // Update input handler references
    this.inputHandler.setReferences(this.battlefield.getGround(), this.agentMeshes);
  }

  removeAgent(agentId: string): void {
    const meshData = this.agentMeshes.get(agentId);
    if (meshData) {
      this.scene.remove(meshData.group);
      // Properly dispose all geometries, materials, and textures
      this.characterFactory.disposeAgentMesh(meshData);
      this.agentMeshes.delete(agentId);
    }

    // Clean up all visual effects for this agent (zzz bubble, speech bubbles, etc.)
    this.effectsManager.removeAgentEffects(agentId);

    this.inputHandler.setReferences(this.battlefield.getGround(), this.agentMeshes);
  }

  updateAgent(agent: Agent, animatePosition = false): void {
    const meshData = this.agentMeshes.get(agent.id);
    if (!meshData) return;

    const state = store.getState();
    const isSelected = state.selectedAgentIds.has(agent.id);

    if (animatePosition) {
      const currentPos = meshData.group.position;
      const posChanged =
        Math.abs(currentPos.x - agent.position.x) > 0.01 ||
        Math.abs(currentPos.z - agent.position.z) > 0.01;

      if (posChanged) {
        this.movementAnimator.startMovement(agent.id, meshData, agent.position);
      }
    } else if (!this.movementAnimator.isMoving(agent.id)) {
      meshData.group.position.set(agent.position.x, agent.position.y, agent.position.z);
    }

    // Always update animation based on status
    if (!this.movementAnimator.isMoving(agent.id)) {
      this.updateStatusAnimation(agent, meshData);
    }

    // Update visuals
    this.characterFactory.updateVisuals(meshData.group, agent, isSelected);
  }

  /**
   * Update agent animation based on status
   */
  private updateStatusAnimation(agent: Agent, meshData: AgentMeshData): void {
    // Map status to animation (using configurable idle and working animations)
    const statusAnimations: Record<string, string> = {
      idle: this.idleAnimation,       // Configurable idle animation
      working: this.workingAnimation, // Configurable working animation
      waiting: ANIMATIONS.IDLE,       // Standing when waiting
      waiting_permission: ANIMATIONS.IDLE, // Standing when waiting for permission
      error: ANIMATIONS.EMOTE_NO,     // Error shake
      offline: ANIMATIONS.STATIC,     // Static when offline
      orphaned: this.workingAnimation, // Orphaned processes appear to be working (because they are)
    };

    const animation = statusAnimations[agent.status] || ANIMATIONS.IDLE;
    const currentClipName = meshData.currentAction?.getClip()?.name?.toLowerCase();

    console.log(`[SceneManager] Agent ${agent.name} status=${agent.status}, animation=${animation}, current=${currentClipName}, hasAnimations=${meshData.animations.size}`);
    console.log(`[SceneManager] Available animations:`, Array.from(meshData.animations.keys()));

    // One-shot animations that should only play once (not for idle/working status)
    const oneShotAnimations: string[] = [ANIMATIONS.DIE, ANIMATIONS.EMOTE_NO, ANIMATIONS.EMOTE_YES];
    // Jump is only one-shot when NOT used as a configured idle/working animation
    const isConfiguredAnimation = animation === this.idleAnimation || animation === this.workingAnimation;
    const isOneShot = oneShotAnimations.includes(animation) ||
      (animation === ANIMATIONS.JUMP && !isConfiguredAnimation);

    // Don't replay one-shot animations if already playing/finished
    const shouldPlay = isOneShot
      ? currentClipName !== animation
      : agent.status === 'idle' || currentClipName !== animation;

    if (shouldPlay) {
      const options = agent.status === 'working'
        ? { timeScale: 1.5 }
        : isOneShot
          ? { loop: false }
          : {};
      console.log(`[SceneManager] Playing animation: ${animation}, oneShot: ${isOneShot}`);
      this.movementAnimator.playAnimation(meshData, animation, options);
    }

    // Update effects manager reference and status-based effects
    this.effectsManager.setAgentMeshes(this.agentMeshes);

    // Show/hide waiting permission effect based on status
    this.effectsManager.updateWaitingPermissionEffect(agent.id, agent.status === 'waiting_permission');
  }

  syncAgents(agents: Agent[]): void {
    // Clear existing
    for (const meshData of this.agentMeshes.values()) {
      this.scene.remove(meshData.group);
    }
    this.agentMeshes.clear();

    // Add new
    for (const agent of agents) {
      this.addAgent(agent);
    }
  }

  /**
   * Update the custom agent classes for model lookups.
   * Should be called when custom classes are loaded/updated from server.
   */
  setCustomAgentClasses(classes: Map<string, CustomAgentClass>): void {
    this.characterFactory.setCustomClasses(classes);
  }

  refreshSelectionVisuals(): void {
    const state = store.getState();

    // Clear existing boss-subordinate connection lines
    for (const line of this.bossSubordinateLines) {
      this.scene.remove(line);
      line.geometry.dispose();
      (line.material as THREE.Material).dispose();
    }
    this.bossSubordinateLines = [];

    // Collect all bosses whose hierarchy should be shown
    // This includes: selected bosses, and bosses of selected subordinates
    const bossesToShow = new Map<string, Agent>();
    const subordinateIdsOfSelectedBosses = new Set<string>();

    for (const selectedId of state.selectedAgentIds) {
      const selectedAgent = state.agents.get(selectedId);
      if (!selectedAgent) continue;

      // If selected agent is a boss, show their hierarchy
      if ((selectedAgent.isBoss || selectedAgent.class === 'boss') && selectedAgent.subordinateIds) {
        bossesToShow.set(selectedAgent.id, selectedAgent);
        for (const subId of selectedAgent.subordinateIds) {
          subordinateIdsOfSelectedBosses.add(subId);
        }
      }

      // If selected agent has a boss, show that boss's entire hierarchy
      if (selectedAgent.bossId) {
        const boss = state.agents.get(selectedAgent.bossId);
        if (boss && (boss.isBoss || boss.class === 'boss') && boss.subordinateIds) {
          bossesToShow.set(boss.id, boss);
          for (const subId of boss.subordinateIds) {
            subordinateIdsOfSelectedBosses.add(subId);
          }
        }
      }
    }

    // Draw connection lines from bosses to their subordinates
    for (const [, boss] of bossesToShow) {
      const bossMesh = this.agentMeshes.get(boss.id);
      if (!bossMesh || !boss.subordinateIds) continue;

      for (const subId of boss.subordinateIds) {
        const subMesh = this.agentMeshes.get(subId);
        if (!subMesh) continue;

        // Create line from boss to subordinate
        const points = [
          new THREE.Vector3(
            bossMesh.group.position.x,
            0.05, // Slightly above ground
            bossMesh.group.position.z
          ),
          new THREE.Vector3(
            subMesh.group.position.x,
            0.05,
            subMesh.group.position.z
          ),
        ];

        const geometry = new THREE.BufferGeometry().setFromPoints(points);
        const material = new THREE.LineBasicMaterial({
          color: 0xffd700, // Gold color to match subordinate highlight
          transparent: true,
          opacity: 0.3,
        });
        const line = new THREE.Line(geometry, material);
        this.scene.add(line);
        this.bossSubordinateLines.push(line);
      }
    }

    // Also track boss IDs that should be highlighted
    const bossIdsToHighlight = new Set(bossesToShow.keys());

    for (const [agentId, meshData] of this.agentMeshes) {
      const agent = state.agents.get(agentId);
      if (agent) {
        const isSelected = state.selectedAgentIds.has(agentId);
        const isPartOfSelectedHierarchy = subordinateIdsOfSelectedBosses.has(agentId) || bossIdsToHighlight.has(agentId);
        this.characterFactory.updateVisuals(meshData.group, agent, isSelected, isPartOfSelectedHierarchy && !isSelected);
      }
    }
  }

  // ============================================
  // Public API - Effects
  // ============================================

  createMoveOrderEffect(position: THREE.Vector3): void {
    this.effectsManager.createMoveOrderEffect(position);
  }

  /**
   * Show a speech bubble above an agent when using a tool.
   */
  showToolBubble(agentId: string, toolName: string, toolInput?: Record<string, unknown>): void {
    this.effectsManager.setAgentMeshes(this.agentMeshes);
    this.effectsManager.createSpeechBubble(agentId, toolName, toolInput);
  }

  /**
   * Show a delegation animation - paper flying from boss to subordinate.
   */
  showDelegationEffect(bossId: string, subordinateId: string): void {
    this.effectsManager.setAgentMeshes(this.agentMeshes);
    this.effectsManager.createDelegationEffect(bossId, subordinateId);
  }

  // ============================================
  // Public API - Camera
  // ============================================

  focusAgent(agentId: string): void {
    const state = store.getState();
    const agent = state.agents.get(agentId);
    if (!agent) return;

    const offset = this.camera.position.clone().sub(this.controls.target);
    const newTarget = new THREE.Vector3(agent.position.x, agent.position.y, agent.position.z);
    this.controls.target.copy(newTarget);
    this.camera.position.copy(newTarget).add(offset);
  }

  /**
   * Call all subordinates of a boss agent to walk to the boss's location.
   */
  callSubordinates(bossId: string): void {
    const state = store.getState();
    const boss = state.agents.get(bossId);
    if (!boss || boss.class !== 'boss' || !boss.subordinateIds?.length) return;

    const bossPosition = new THREE.Vector3(boss.position.x, boss.position.y, boss.position.z);

    // Calculate formation positions around the boss
    const positions = this.inputHandler.calculateFormationPositions(bossPosition, boss.subordinateIds.length);

    // Create move order effect at boss position
    this.effectsManager.createMoveOrderEffect(bossPosition.clone());

    // Move each subordinate to their formation position
    boss.subordinateIds.forEach((subId, index) => {
      const pos = positions[index];
      const meshData = this.agentMeshes.get(subId);

      store.moveAgent(subId, pos);

      if (meshData) {
        this.movementAnimator.startMovement(subId, meshData, pos);
      }
    });
  }

  // ============================================
  // Public API - Drawing
  // ============================================

  /**
   * Set the active drawing tool.
   */
  setDrawingTool(tool: 'rectangle' | 'circle' | 'select' | null): void {
    this.drawingManager.setTool(tool);
    store.setActiveTool(tool);
  }

  /**
   * Sync areas from store (after loading from localStorage).
   */
  syncAreas(): void {
    this.drawingManager.syncFromStore();
  }

  /**
   * Highlight an area (when selected in toolbox).
   */
  highlightArea(areaId: string | null): void {
    this.drawingManager.highlightArea(areaId);
  }

  /**
   * Clear area selection and hide resize handles.
   */
  clearAreaSelection(): void {
    this.drawingManager.highlightArea(null);
  }

  /**
   * Set callback for area double-click.
   */
  setOnAreaDoubleClick(callback: (areaId: string) => void): void {
    this.onAreaDoubleClickCallback = callback;
  }

  // ============================================
  // Public API - Buildings
  // ============================================

  /**
   * Add a building to the scene.
   */
  addBuilding(building: import('../../shared/types').Building): void {
    this.buildingManager.addBuilding(building);
  }

  /**
   * Remove a building from the scene.
   */
  removeBuilding(buildingId: string): void {
    this.buildingManager.removeBuilding(buildingId);
  }

  /**
   * Update a building in the scene.
   */
  updateBuilding(building: import('../../shared/types').Building): void {
    this.buildingManager.updateBuilding(building);
  }

  /**
   * Sync buildings from store.
   */
  syncBuildings(): void {
    this.buildingManager.syncFromStore();
  }

  /**
   * Highlight a building (when selected).
   */
  highlightBuilding(buildingId: string | null): void {
    this.buildingManager.highlightBuilding(buildingId);
  }

  /**
   * Set callback for building click.
   */
  setOnBuildingClick(callback: (buildingId: string) => void): void {
    this.onBuildingClickCallback = callback;
  }

  /**
   * Set callback for building double-click.
   */
  setOnBuildingDoubleClick(callback: (buildingId: string) => void): void {
    this.onBuildingDoubleClickCallback = callback;
  }

  // ============================================
  // Public API - Config
  // ============================================

  /**
   * Set character scale.
   */
  setCharacterScale(scale: number): void {
    this.characterScale = scale;
    // Update all existing character models (with boss multiplier if applicable)
    for (const meshData of this.agentMeshes.values()) {
      const body = meshData.group.getObjectByName('characterBody');
      if (body) {
        const isBoss = meshData.group.userData.isBoss === true;
        const bossMultiplier = isBoss ? 1.5 : 1.0;
        body.scale.setScalar(scale * bossMultiplier);
      }
    }
  }

  /**
   * Set indicator scale (status orbs, labels, bubbles).
   */
  setIndicatorScale(scale: number): void {
    this.indicatorScale = scale;
    // Also update effects manager
    this.effectsManager.setIndicatorScale(scale);
  }

  /**
   * Set FPS limit for the render loop.
   * @param limit - Maximum FPS (0 = unlimited)
   */
  setFpsLimit(limit: number): void {
    this.fpsLimit = limit;
    this.frameInterval = limit > 0 ? 1000 / limit : 0;
    console.log(`[Tide] FPS limit set to ${limit}, frameInterval: ${this.frameInterval}ms`);
  }

  /**
   * Set grid visibility.
   */
  setGridVisible(visible: boolean): void {
    this.battlefield.setGridVisible(visible);
  }

  /**
   * Set debug time override for testing day/night cycle.
   * @param hour - Hour (0-24) or null to use real time
   */
  setDebugTime(hour: number | null): void {
    this.battlefield.setDebugTime(hour);
  }

  /**
   * Set time mode for the environment.
   * @param mode - 'auto' for real time, or 'day'/'night'/'dawn'/'dusk' for fixed time
   */
  setTimeMode(mode: string): void {
    this.battlefield.setTimeMode(mode);
  }

  /**
   * Set terrain configuration (show/hide elements, fog density).
   */
  setTerrainConfig(config: {
    showTrees: boolean;
    showBushes: boolean;
    showHouse: boolean;
    showLamps: boolean;
    showGrass: boolean;
    fogDensity: number;
  }): void {
    this.battlefield.setTerrainConfig(config);
  }

  /**
   * Set floor texture style.
   */
  setFloorStyle(style: string, force = false): void {
    this.battlefield.setFloorStyle(style as import('./environment/Battlefield').FloorStyle, force);
  }

  /**
   * Set animation for idle status.
   */
  setIdleAnimation(animation: string): void {
    this.idleAnimation = animation;
    // Update all idle agents to use new animation
    const state = store.getState();
    for (const [agentId, meshData] of this.agentMeshes) {
      const agent = state.agents.get(agentId);
      if (agent && agent.status === 'idle' && !this.movementAnimator.isMoving(agentId)) {
        this.movementAnimator.playAnimation(meshData, animation);
      }
    }
  }

  /**
   * Set animation for working status.
   */
  setWorkingAnimation(animation: string): void {
    this.workingAnimation = animation;
    // Update all working agents to use new animation
    const state = store.getState();
    for (const [agentId, meshData] of this.agentMeshes) {
      const agent = state.agents.get(agentId);
      if (agent && agent.status === 'working' && !this.movementAnimator.isMoving(agentId)) {
        this.movementAnimator.playAnimation(meshData, animation, { timeScale: 1.5 });
      }
    }
  }

  // ============================================
  // Input Handlers
  // ============================================

  private handleAgentClick(agentId: string, shiftKey: boolean): void {
    if (shiftKey) {
      store.addToSelection(agentId);
    } else {
      store.selectAgent(agentId);
    }
    this.refreshSelectionVisuals();
  }

  private handleGroundClick(): void {
    store.selectAgent(null);
    this.refreshSelectionVisuals();
  }

  private handleMoveCommand(position: THREE.Vector3, agentIds: string[]): void {
    this.effectsManager.createMoveOrderEffect(position.clone());

    const positions = this.inputHandler.calculateFormationPositions(position, agentIds.length);

    agentIds.forEach((agentId, index) => {
      const pos = positions[index];
      const meshData = this.agentMeshes.get(agentId);

      store.moveAgent(agentId, pos);

      if (meshData) {
        this.movementAnimator.startMovement(agentId, meshData, pos);
      }
    });
  }

  private handleSelectionBox(agentIds: string[], buildingIds: string[]): void {
    // Handle agent selection
    if (agentIds.length > 0) {
      store.selectMultiple(agentIds);
    } else {
      store.selectAgent(null);
    }

    // Handle building selection
    if (buildingIds.length > 0) {
      store.selectMultipleBuildings(buildingIds);
      this.buildingManager.highlightBuildings(buildingIds);
    } else {
      store.selectBuilding(null);
      this.buildingManager.highlightBuilding(null);
    }

    this.refreshSelectionVisuals();
  }

  private handleAgentDoubleClick(agentId: string): void {
    // Select the agent and open terminal
    store.selectAgent(agentId);
    this.refreshSelectionVisuals();
    store.toggleTerminal(agentId);
  }

  // Drawing handlers
  private handleDrawStart(pos: { x: number; z: number }): void {
    this.drawingManager.startDrawing(pos);
  }

  private handleDrawMove(pos: { x: number; z: number }): void {
    this.drawingManager.updateDrawing(pos);
  }

  private handleDrawEnd(pos: { x: number; z: number }): void {
    this.drawingManager.finishDrawing(pos);
  }

  private handleAreaRightClick(pos: { x: number; z: number }): void {
    // Check if clicking on an area
    const area = this.drawingManager.getAreaAtPosition(pos);
    if (area) {
      // Assign selected agents to this area
      const state = store.getState();
      for (const agentId of state.selectedAgentIds) {
        store.assignAgentToArea(agentId, area.id);

        // Move agent to area center
        const agent = state.agents.get(agentId);
        if (agent) {
          const meshData = this.agentMeshes.get(agentId);
          const targetPos = { x: area.center.x, y: 0, z: area.center.z };
          store.moveAgent(agentId, targetPos);
          if (meshData) {
            this.movementAnimator.startMovement(agentId, meshData, targetPos);
          }
        }
      }
    }
  }

  // Resize handlers
  private handleResizeStart(handle: THREE.Mesh, pos: { x: number; z: number }): void {
    this.drawingManager.startResize(handle, pos);
  }

  private handleResizeMove(pos: { x: number; z: number }): void {
    this.drawingManager.updateResize(pos);
  }

  private handleResizeEnd(): void {
    this.drawingManager.finishResize();
  }

  // Area handlers
  private handleAreaDoubleClick(areaId: string): void {
    // Select the area in the store
    store.selectArea(areaId);
    // Trigger callback (to open toolbox)
    this.onAreaDoubleClickCallback?.(areaId);
  }

  private handleGroundClickOutsideArea(): void {
    // Clear area selection and hide resize handles when clicking outside
    store.selectArea(null);
    this.drawingManager.highlightArea(null);
  }

  // Building handlers
  private handleBuildingClick(buildingId: string): void {
    store.selectBuilding(buildingId);
    this.buildingManager.highlightBuilding(buildingId);
    this.onBuildingClickCallback?.(buildingId);
  }

  private handleBuildingDoubleClick(buildingId: string): void {
    store.selectBuilding(buildingId);
    this.buildingManager.highlightBuilding(buildingId);
    this.onBuildingDoubleClickCallback?.(buildingId);
  }

  private handleBuildingDragStart(_buildingId: string, _pos: { x: number; z: number }): void {
    // Drag started - nothing special to do
  }

  private handleBuildingDragMove(buildingId: string, pos: { x: number; z: number }): void {
    // Update visual position during drag
    this.buildingManager.setBuildingPosition(buildingId, pos);
  }

  private handleBuildingDragEnd(buildingId: string, pos: { x: number; z: number }): void {
    // Persist the new position to store and server
    store.updateBuildingPosition(buildingId, pos);
  }

  // ============================================
  // Animation Loop
  // ============================================

  private animate = (): void => {
    requestAnimationFrame(this.animate);

    // FPS limiting: skip frame if not enough time has passed
    const now = Date.now();
    if (this.frameInterval > 0) {
      const elapsed = now - this.lastRenderTime;
      if (elapsed < this.frameInterval) {
        return; // Skip this frame
      }
      this.lastRenderTime = now;
    }

    // Track FPS
    fpsTracker.tick();
    perf.start('scene:frame');

    this.controls.update();

    // Calculate delta time
    const deltaTime = this.lastFrameTime ? (now - this.lastFrameTime) / 1000 : 0.016;
    this.lastFrameTime = now;

    // Save camera periodically
    if (now - this.lastCameraSave > CAMERA_SAVE_INTERVAL) {
      saveCameraState(
        { x: this.camera.position.x, y: this.camera.position.y, z: this.camera.position.z },
        { x: this.controls.target.x, y: this.controls.target.y, z: this.controls.target.z }
      );
      this.lastCameraSave = now;
    }

    // Update time of day every minute
    if (now - this.lastTimeUpdate > 60000) {
      this.battlefield.updateTimeOfDay();
      this.lastTimeUpdate = now;
    }

    // Update galactic floor animation
    this.battlefield.updateGalacticAnimation(deltaTime);

    // Update animations
    const completedMovements = this.movementAnimator.update(this.agentMeshes);
    this.effectsManager.update();
    this.buildingManager.update(deltaTime);

    // Re-apply status animations for agents that just finished moving
    if (completedMovements.length > 0) {
      const state = store.getState();
      for (const agentId of completedMovements) {
        const agent = state.agents.get(agentId);
        const meshData = this.agentMeshes.get(agentId);
        if (agent && meshData) {
          this.updateStatusAnimation(agent, meshData);
        }
      }
    }

    // Animate working agents
    this.animateWorkingAgents(now);

    // Update idle timers every second
    if (now - this.lastIdleTimerUpdate > 1000) {
      this.updateIdleTimers();
      this.lastIdleTimerUpdate = now;
    }

    // Update boss-subordinate connection lines to follow moving agents
    this.updateBossSubordinateLines();

    perf.start('scene:render');
    this.renderer.render(this.scene, this.camera);
    perf.end('scene:render');

    perf.end('scene:frame');
  };

  private updateBossSubordinateLines(): void {
    if (this.bossSubordinateLines.length === 0) return;

    const state = store.getState();
    let lineIndex = 0;

    // Collect all bosses whose hierarchy is being shown
    // (same logic as refreshSelectionVisuals)
    const bossesToShow = new Map<string, Agent>();

    for (const selectedId of state.selectedAgentIds) {
      const selectedAgent = state.agents.get(selectedId);
      if (!selectedAgent) continue;

      // If selected agent is a boss
      if ((selectedAgent.isBoss || selectedAgent.class === 'boss') && selectedAgent.subordinateIds) {
        bossesToShow.set(selectedAgent.id, selectedAgent);
      }

      // If selected agent has a boss
      if (selectedAgent.bossId) {
        const boss = state.agents.get(selectedAgent.bossId);
        if (boss && (boss.isBoss || boss.class === 'boss') && boss.subordinateIds) {
          bossesToShow.set(boss.id, boss);
        }
      }
    }

    // Update line positions for each boss's subordinates
    for (const [, boss] of bossesToShow) {
      const bossMesh = this.agentMeshes.get(boss.id);
      if (!bossMesh || !boss.subordinateIds) continue;

      for (const subId of boss.subordinateIds) {
        const subMesh = this.agentMeshes.get(subId);
        if (!subMesh || lineIndex >= this.bossSubordinateLines.length) continue;

        const line = this.bossSubordinateLines[lineIndex];
        const positions = line.geometry.attributes.position as THREE.BufferAttribute;

        // Update start point (boss position)
        positions.setXYZ(0, bossMesh.group.position.x, 0.05, bossMesh.group.position.z);
        // Update end point (subordinate position)
        positions.setXYZ(1, subMesh.group.position.x, 0.05, subMesh.group.position.z);
        positions.needsUpdate = true;

        lineIndex++;
      }
    }
  }

  private updateIdleTimers(): void {
    const state = store.getState();
    for (const [agentId, meshData] of this.agentMeshes) {
      const agent = state.agents.get(agentId);
      if (agent && agent.status === 'idle') {
        // Update idle timer display
        this.characterFactory.updateIdleTimer(meshData.group, agent.status, agent.lastActivity);
      }
    }
  }

  private animateWorkingAgents(now: number): void {
    const state = store.getState();
    const time = now * 0.001;

    for (const [id, agent] of state.agents) {
      const meshData = this.agentMeshes.get(id);
      if (!meshData) continue;

      const isMoving = this.movementAnimator.isMoving(id);

      // Calculate zoom-based scale for indicators
      const indicatorScale = this.calculateIndicatorScale(meshData.group.position);

      // Scale name label - preserve aspect ratio to avoid text distortion
      const nameLabel = meshData.group.getObjectByName('nameLabel') as THREE.Sprite;
      if (nameLabel) {
        const baseHeight = 0.3 * indicatorScale;
        const aspectRatio = nameLabel.userData.aspectRatio || 2; // default 2:1 for backwards compat
        nameLabel.scale.set(baseHeight * aspectRatio, baseHeight, 1);
      }

      // Scale mana bar
      const manaBar = meshData.group.getObjectByName('manaBar') as THREE.Sprite;
      if (manaBar) {
        manaBar.scale.set(0.9 * indicatorScale, 0.14 * indicatorScale, 1);
      }

      // Scale idle timer (same as mana bar for alignment)
      const idleTimer = meshData.group.getObjectByName('idleTimer') as THREE.Sprite;
      if (idleTimer) {
        idleTimer.scale.set(0.9 * indicatorScale, 0.14 * indicatorScale, 1);
      }
    }

    // Update effects manager with camera for zoom-based scaling
    this.effectsManager.updateWithCamera(this.camera);
  }

  /**
   * Calculate scale factor for indicators based on camera distance and user config.
   * Closer = smaller indicators, farther = larger indicators (to remain visible).
   */
  private calculateIndicatorScale(objectPosition: THREE.Vector3): number {
    const distance = this.camera.position.distanceTo(objectPosition);

    // Base distance where scale is 1.0 (comfortable viewing distance)
    const baseDistance = 15;

    // Scale factor: at baseDistance = 1.0, farther = larger, closer = smaller
    // Clamp between 0.5 and 2.5 to avoid extreme sizes
    const zoomScale = Math.max(0.5, Math.min(2.5, distance / baseDistance));

    // Apply user's indicator scale setting
    return zoomScale * this.indicatorScale;
  }

  // ============================================
  // Event Handlers
  // ============================================

  private onWindowResize = (): void => {
    this.camera.aspect = this.canvas.clientWidth / this.canvas.clientHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(this.canvas.clientWidth, this.canvas.clientHeight);
  };

  // ============================================
  // HMR Support
  // ============================================

  reattach(canvas: HTMLCanvasElement, selectionBox: HTMLDivElement): void {
    // Disconnect old observer
    this.resizeObserver?.disconnect();

    // Remove old event listeners
    this.canvas = canvas;

    // Update renderer
    this.renderer.dispose();
    this.renderer = this.createRenderer();

    // Reconnect controls
    this.controls.dispose();
    this.controls = this.createControls();

    // Reattach input handler with new controls
    this.inputHandler.reattach(canvas, selectionBox, this.controls);
    this.inputHandler.setReferences(this.battlefield.getGround(), this.agentMeshes);

    // Reattach resize observer
    if (this.canvas.parentElement) {
      this.resizeObserver?.observe(this.canvas.parentElement);
    }

    // Trigger resize
    this.onWindowResize();
  }

  // ============================================
  // Cleanup
  // ============================================

  dispose(): void {
    window.removeEventListener('resize', this.onWindowResize);
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.inputHandler.dispose();
    this.drawingManager.dispose();
    this.buildingManager.dispose();
    // Use dispose() instead of clear() to fully clean up cached resources
    this.effectsManager.dispose();

    // Dispose all agent meshes
    for (const meshData of this.agentMeshes.values()) {
      this.scene.remove(meshData.group);
      this.characterFactory.disposeAgentMesh(meshData);
    }
    this.agentMeshes.clear();

    // Dispose boss-subordinate lines
    for (const line of this.bossSubordinateLines) {
      this.scene.remove(line);
      line.geometry.dispose();
      (line.material as THREE.Material).dispose();
    }
    this.bossSubordinateLines = [];

    // Dispose battlefield
    this.battlefield.dispose();

    this.renderer.dispose();
    this.controls.dispose();
  }
}
