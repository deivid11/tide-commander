import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { Agent, DrawingArea, CustomAgentClass, AnimationMapping } from '../../shared/types';
import { store } from '../store';
import { saveCameraState, loadCameraState } from '../utils/camera';
import { CAMERA_SAVE_INTERVAL } from './config';
import { perf, fpsTracker, memory } from '../utils/profiling';

// Import modules
import { CharacterLoader, CharacterFactory, type AgentMeshData } from './characters';
import { MovementAnimator, EffectsManager, ANIMATIONS } from './animation';
import { ProceduralAnimator, type ProceduralAnimationState } from './animation/ProceduralAnimator';
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
  private proceduralAnimator: ProceduralAnimator;
  private effectsManager: EffectsManager;
  private battlefield: Battlefield;
  private inputHandler: InputHandler;
  private drawingManager: DrawingManager;
  private buildingManager: BuildingManager;

  // State
  private agentMeshes = new Map<string, AgentMeshData>();
  private bossSubordinateLines: THREE.Line[] = [];
  private pendingAgents: Agent[] = []; // Queue for agents that arrive before models load
  private modelsReady = false;
  private lastCameraSave = 0;
  private lastTimeUpdate = 0;
  private lastFrameTime = 0;
  private lastRenderTime = Date.now(); // For FPS limiting
  private lastIdleTimerUpdate = 0;
  private characterScale = 0.5;
  private indicatorScale = 1.0;
  private idleAnimation: string = ANIMATIONS.SIT;
  private workingAnimation: string = ANIMATIONS.WALK;
  private fpsLimit = 0; // 0 = unlimited
  private frameInterval = 0; // Calculated from fpsLimit
  private resizeObserver: ResizeObserver | null = null;
  private animationFrameId: number | null = null;

  // Idle detection for power saving (experimental feature)
  private powerSavingEnabled = false; // Controlled by settings
  private lastActivityTime = Date.now();
  private isIdle = false;
  private idleThreshold = 2000; // 2 seconds of no activity = idle
  private idleFpsLimit = 10; // Limit to 10 FPS when idle
  private lastIdleRenderTime = 0;

  // Callbacks
  private onAreaDoubleClickCallback: ((areaId: string) => void) | null = null;
  private onBuildingClickCallback: ((buildingId: string) => void) | null = null;
  private onBuildingDoubleClickCallback: ((buildingId: string) => void) | null = null;
  private onContextMenuCallback: ((
    screenPos: { x: number; y: number },
    worldPos: { x: number; z: number },
    target: { type: 'ground' | 'agent' | 'area' | 'building'; id?: string }
  ) => void) | null = null;
  private onAgentHoverCallback: ((
    agentId: string | null,
    screenPos: { x: number; y: number } | null
  ) => void) | null = null;

  constructor(canvas: HTMLCanvasElement, selectionBox: HTMLDivElement) {
    this.canvas = canvas;

    // Initialize Three.js core
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0a1a2a); // Dark blue

    this.camera = this.createCamera();
    this.renderer = this.createRenderer();
    this.controls = this.createControls();

    // Initialize modules
    this.characterLoader = new CharacterLoader();
    this.characterFactory = new CharacterFactory(this.characterLoader);
    this.movementAnimator = new MovementAnimator();
    this.proceduralAnimator = new ProceduralAnimator();
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
        onAgentHover: this.handleAgentHover.bind(this),
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
        onContextMenu: this.handleContextMenu.bind(this),
        onActivity: this.markActivity.bind(this),
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

    // Listen for WebGL context loss/restore
    this.canvas.addEventListener('webglcontextlost', this.onContextLost);
    this.canvas.addEventListener('webglcontextrestored', this.onContextRestored);

    // Start render loop
    this.animate();
  }

  private onContextLost = (event: Event): void => {
    event.preventDefault();
    console.error('[SceneManager] WebGL context lost! Stopping animation.');
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
  };

  private onContextRestored = (): void => {
    console.log('[SceneManager] WebGL context restored! Restarting animation.');
    this.animate();
  };

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
    // Verify canvas is valid and attached to DOM
    if (!this.canvas || !this.canvas.parentElement) {
      throw new Error('[SceneManager] Canvas is not attached to DOM');
    }

    // Check if canvas has dimensions (can happen if CSS hasn't applied yet)
    let width = this.canvas.clientWidth || this.canvas.width;
    let height = this.canvas.clientHeight || this.canvas.height;

    // If dimensions are still 0, use fallback and set explicit canvas size
    if (!width || !height) {
      width = window.innerWidth;
      height = window.innerHeight;
      // Set explicit canvas dimensions - required for WebGL context creation
      this.canvas.width = width;
      this.canvas.height = height;
      console.log('[SceneManager] Set explicit canvas dimensions:', width, height);
    }

    console.log('[SceneManager] Creating WebGLRenderer with canvas:', {
      width,
      height,
      parentElement: !!this.canvas.parentElement,
      isConnected: this.canvas.isConnected,
    });

    const renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
    });
    renderer.setSize(width, height);
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

    // Disable OrbitControls touch handling - we use custom touch handlers in InputHandler
    controls.touches = {
      ONE: null as unknown as THREE.TOUCH,
      TWO: null as unknown as THREE.TOUCH,
    };

    return controls;
  }

  // ============================================
  // Public API - Character Models
  // ============================================

  async loadCharacterModels(): Promise<void> {
    console.log('[SceneManager] loadCharacterModels called, modelsReady:', this.modelsReady);
    await this.characterLoader.loadAll();
    this.modelsReady = true;
    console.log('[SceneManager] Models ready, pending agents:', this.pendingAgents.length);

    // Process any agents that were queued while models were loading
    if (this.pendingAgents.length > 0) {
      console.log(`[SceneManager] Processing ${this.pendingAgents.length} pending agents`);
      const agents = this.pendingAgents;
      this.pendingAgents = [];
      for (const agent of agents) {
        this.addAgent(agent);
      }
    }
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

        // Apply character scale: customModelScale × characterScale × bossMultiplier
        const newBody = newMeshData.group.getObjectByName('characterBody');
        if (newBody) {
          const customModelScale = newBody.userData.customModelScale ?? 1.0;
          const bossMultiplier = (agent.isBoss || agent.class === 'boss') ? 1.5 : 1.0;
          newBody.scale.setScalar(customModelScale * this.characterScale * bossMultiplier);

          // Update procedural animator registration based on new model
          this.proceduralAnimator.unregister(agentId);
          if (newMeshData.animations.size === 0) {
            const state = this.getProceduralStateForStatus(agent.status);
            this.proceduralAnimator.register(agentId, newBody, state);
          }
        }

        // Replace in scene
        this.scene.remove(meshData.group);
        // CRITICAL: Dispose old mesh resources to prevent memory leak
        this.characterFactory.disposeAgentMesh(meshData);
        this.scene.add(newMeshData.group);
        this.agentMeshes.set(agentId, newMeshData);

        // Start status-based animation (sit if idle)
        this.updateStatusAnimation(agent, newMeshData);
      }
    }

    // Update input handler references
    this.inputHandler.setReferences(this.battlefield.getGround(), this.agentMeshes);
  }

  // ============================================
  // Public API - Agent Management
  // ============================================

  addAgent(agent: Agent): void {
    // Queue if models aren't loaded yet
    if (!this.modelsReady) {
      console.log(`[SceneManager] Queueing agent ${agent.name} (models not ready)`);
      // Update existing pending agent or add new one
      const existingIdx = this.pendingAgents.findIndex(a => a.id === agent.id);
      if (existingIdx >= 0) {
        this.pendingAgents[existingIdx] = agent;
      } else {
        this.pendingAgents.push(agent);
      }
      return;
    }

    // Remove existing mesh if present (prevent duplicates)
    const existing = this.agentMeshes.get(agent.id);
    if (existing) {
      this.scene.remove(existing.group);
      // CRITICAL: Dispose resources to prevent memory leak
      this.characterFactory.disposeAgentMesh(existing);
      this.proceduralAnimator.unregister(agent.id);
      this.effectsManager.removeAgentEffects(agent.id);
      this.agentMeshes.delete(agent.id);
    }

    // Check if this agent's class uses a custom model that needs loading
    const customClasses = store.getState().customAgentClasses;
    const customClass = customClasses.get(agent.class);
    if (customClass?.customModelPath && !this.characterLoader.hasCustomModel(customClass.id)) {
      // Load custom model first, then add agent
      this.characterLoader.loadCustomModel(customClass.id).then(() => {
        this.addAgentInternal(agent);
      }).catch(err => {
        console.warn(`[SceneManager] Failed to load custom model for ${agent.class}, using fallback:`, err);
        this.addAgentInternal(agent);
      });
      return;
    }

    this.addAgentInternal(agent);
  }

  /**
   * Internal method to add an agent mesh after model is ready.
   */
  private addAgentInternal(agent: Agent): void {
    // CRITICAL: Check for existing mesh and remove it to prevent ghost duplicates
    // This can happen when async model loading completes after another code path
    // (like upgradeAgentModels or syncAgents) has already added a mesh
    const existing = this.agentMeshes.get(agent.id);
    if (existing) {
      this.scene.remove(existing.group);
      this.characterFactory.disposeAgentMesh(existing);
      this.proceduralAnimator.unregister(agent.id);
      this.effectsManager.removeAgentEffects(agent.id);
      this.agentMeshes.delete(agent.id);
    }

    const meshData = this.characterFactory.createAgentMesh(agent);
    this.scene.add(meshData.group);
    this.agentMeshes.set(agent.id, meshData);

    // Apply character scale: customModelScale × characterScale × bossMultiplier
    const body = meshData.group.getObjectByName('characterBody');
    if (body) {
      const customModelScale = body.userData.customModelScale ?? 1.0;
      const bossMultiplier = (agent.isBoss || agent.class === 'boss') ? 1.5 : 1.0;
      body.scale.setScalar(customModelScale * this.characterScale * bossMultiplier);

      // Register for procedural animation if model has no built-in animations
      if (meshData.animations.size === 0) {
        const state = this.getProceduralStateForStatus(agent.status);
        this.proceduralAnimator.register(agent.id, body, state);
        this.invalidateProceduralBodiesCache();
      }
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

    // Unregister from procedural animator
    this.proceduralAnimator.unregister(agentId);
    this.invalidateProceduralBodiesCache();

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
   * Get the animation name to use for a specific status, considering per-class custom mappings.
   */
  private getAnimationForStatus(agent: Agent, meshData: AgentMeshData, status: string): string {
    // Get custom animation mapping from the character body if available
    const characterBody = meshData.group.getObjectByName('characterBody');
    const customMapping = characterBody?.userData?.animationMapping as AnimationMapping | undefined;

    // Check custom mapping first for idle/working/orphaned statuses
    if (customMapping) {
      if ((status === 'idle') && customMapping.idle) {
        // Verify the animation exists in this model
        if (meshData.animations.has(customMapping.idle) || meshData.animations.has(customMapping.idle.toLowerCase())) {
          return customMapping.idle;
        }
      }
      if ((status === 'working' || status === 'orphaned') && customMapping.working) {
        if (meshData.animations.has(customMapping.working) || meshData.animations.has(customMapping.working.toLowerCase())) {
          return customMapping.working;
        }
      }
    }

    // Fall back to global configured animations
    const statusAnimations: Record<string, string> = {
      idle: this.idleAnimation,       // Configurable idle animation
      working: this.workingAnimation, // Configurable working animation
      waiting: ANIMATIONS.IDLE,       // Standing when waiting
      waiting_permission: ANIMATIONS.IDLE, // Standing when waiting for permission
      error: ANIMATIONS.EMOTE_NO,     // Error shake
      offline: ANIMATIONS.STATIC,     // Static when offline
      orphaned: this.workingAnimation, // Orphaned processes appear to be working (because they are)
    };

    return statusAnimations[status] || ANIMATIONS.IDLE;
  }

  /**
   * Update agent animation based on status
   */
  private updateStatusAnimation(agent: Agent, meshData: AgentMeshData): void {
    // If model has no animations, update procedural animator state instead
    if (meshData.animations.size === 0) {
      if (this.proceduralAnimator.has(agent.id)) {
        const state = this.getProceduralStateForStatus(agent.status);
        this.proceduralAnimator.setState(agent.id, state);
      }
      // Still update effects
      this.effectsManager.setAgentMeshes(this.agentMeshes);
      this.effectsManager.updateWaitingPermissionEffect(agent.id, agent.status === 'waiting_permission');
      return;
    }

    // Get the appropriate animation for this agent's status
    const animation = this.getAnimationForStatus(agent, meshData, agent.status);
    const currentClipName = meshData.currentAction?.getClip()?.name?.toLowerCase();

    // One-shot animations that should only play once (not for idle/working status)
    const oneShotAnimations: string[] = [ANIMATIONS.DIE, ANIMATIONS.EMOTE_NO, ANIMATIONS.EMOTE_YES];
    // Jump is only one-shot when NOT used as a configured idle/working animation
    const isConfiguredAnimation = animation === this.idleAnimation || animation === this.workingAnimation;
    const isOneShot = oneShotAnimations.includes(animation) ||
      (animation === ANIMATIONS.JUMP && !isConfiguredAnimation);

    // Don't replay one-shot animations if already playing/finished
    const shouldPlay = isOneShot
      ? currentClipName !== animation && currentClipName !== animation.toLowerCase()
      : agent.status === 'idle' || (currentClipName !== animation && currentClipName !== animation.toLowerCase());

    if (shouldPlay) {
      const options = agent.status === 'working'
        ? { timeScale: 1.5 }
        : isOneShot
          ? { loop: false }
          : {};
      this.movementAnimator.playAnimation(meshData, animation, options);
    }

    // Update effects manager reference and status-based effects
    this.effectsManager.setAgentMeshes(this.agentMeshes);

    // Show/hide waiting permission effect based on status
    this.effectsManager.updateWaitingPermissionEffect(agent.id, agent.status === 'waiting_permission');
  }

  syncAgents(agents: Agent[]): void {
    console.log(`[SceneManager] syncAgents called with ${agents.length} agents, modelsReady: ${this.modelsReady}`);
    const previousCount = this.agentMeshes.size;

    // Clear pending agents queue since this is a full sync
    this.pendingAgents = [];

    // Clear existing - MUST dispose resources to prevent memory leak
    for (const meshData of this.agentMeshes.values()) {
      this.scene.remove(meshData.group);
      // Properly dispose all geometries, materials, and textures
      this.characterFactory.disposeAgentMesh(meshData);
    }
    this.agentMeshes.clear();

    // Clear procedural animator registrations
    this.proceduralAnimator.clear();

    // Clear effects manager
    this.effectsManager.clear();

    // Add new (will be queued if models not ready)
    for (const agent of agents) {
      this.addAgent(agent);
    }

    // Debug logging for memory leak investigation
    console.log(`[SceneManager] syncAgents: disposed ${previousCount} agents, added ${agents.length} new agents`);
  }

  /**
   * Update the custom agent classes for model lookups.
   * Should be called when custom classes are loaded/updated from server.
   * Also preloads any custom models associated with these classes.
   */
  setCustomAgentClasses(classes: Map<string, CustomAgentClass>): void {
    this.characterFactory.setCustomClasses(classes);

    // Preload custom models for classes that have them
    for (const customClass of classes.values()) {
      if (customClass.customModelPath) {
        // Load custom model asynchronously (fire and forget)
        this.characterLoader.loadCustomModel(customClass.id).catch(err => {
          console.warn(`[SceneManager] Failed to preload custom model for class ${customClass.id}:`, err);
        });
      }
    }
  }

  // Pool of reusable line objects for boss-subordinate connections
  private linePool: THREE.Line[] = [];
  private activeLineCount = 0;

  refreshSelectionVisuals(): void {
    const state = store.getState();

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

    // Count how many lines we need
    let neededLines = 0;
    for (const [, boss] of bossesToShow) {
      if (boss.subordinateIds) {
        neededLines += boss.subordinateIds.length;
      }
    }

    // Clear and rebuild cached line connections
    this.cachedLineConnections = [];

    // Reuse existing lines from pool or create new ones as needed
    let lineIndex = 0;
    for (const [, boss] of bossesToShow) {
      const bossMesh = this.agentMeshes.get(boss.id);
      if (!bossMesh || !boss.subordinateIds) continue;

      for (const subId of boss.subordinateIds) {
        const subMesh = this.agentMeshes.get(subId);
        if (!subMesh) continue;

        // Cache the connection for efficient frame updates
        this.cachedLineConnections.push({ bossId: boss.id, subId });

        let line: THREE.Line;
        if (lineIndex < this.linePool.length) {
          // Reuse existing line from pool
          line = this.linePool[lineIndex];
          line.visible = true;
        } else {
          // Create new line and add to pool
          const geometry = new THREE.BufferGeometry();
          geometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0], 3));
          const material = new THREE.LineBasicMaterial({
            color: 0xffd700, // Gold color to match subordinate highlight
            transparent: true,
            opacity: 0.3,
          });
          line = new THREE.Line(geometry, material);
          this.scene.add(line);
          this.linePool.push(line);
        }

        // Update line positions
        const positions = line.geometry.attributes.position as THREE.BufferAttribute;
        positions.setXYZ(0, bossMesh.group.position.x, 0.05, bossMesh.group.position.z);
        positions.setXYZ(1, subMesh.group.position.x, 0.05, subMesh.group.position.z);
        positions.needsUpdate = true;

        lineIndex++;
      }
    }

    // Hide unused lines (don't dispose, keep in pool for reuse)
    for (let i = lineIndex; i < this.linePool.length; i++) {
      this.linePool[i].visible = false;
    }

    // Update bossSubordinateLines to reference active lines (for updateBossSubordinateLines)
    this.bossSubordinateLines = this.linePool.slice(0, lineIndex);
    this.activeLineCount = lineIndex;

    // Also track boss IDs that should be highlighted
    const bossIdsToHighlight = new Set(bossesToShow.keys());

    for (const [agentId, meshData] of this.agentMeshes) {
      const agent = state.agents.get(agentId);
      if (agent) {
        // Check if class changed and update model if needed
        const updatedMeshData = this.characterFactory.updateAgentClass(meshData, agent);
        if (updatedMeshData) {
          // Model was replaced, update the stored meshData
          this.agentMeshes.set(agentId, updatedMeshData);

          // Apply character scale: customModelScale × characterScale × bossMultiplier
          const newBody = updatedMeshData.group.getObjectByName('characterBody');
          if (newBody) {
            const customModelScale = newBody.userData.customModelScale ?? 1.0;
            const bossMultiplier = (agent.isBoss || agent.class === 'boss') ? 1.5 : 1.0;
            newBody.scale.setScalar(customModelScale * this.characterScale * bossMultiplier);

            // Update procedural animator registration based on new model
            this.proceduralAnimator.unregister(agentId);
            if (updatedMeshData.animations.size === 0) {
              const proceduralState = this.getProceduralStateForStatus(agent.status);
              this.proceduralAnimator.register(agentId, newBody, proceduralState);
            }
            this.invalidateProceduralBodiesCache();
          }

          // Start animation based on agent's current status
          this.updateStatusAnimation(agent, updatedMeshData);

          // Use the new meshData for visual updates
          const isSelected = state.selectedAgentIds.has(agentId);
          const isPartOfSelectedHierarchy = subordinateIdsOfSelectedBosses.has(agentId) || bossIdsToHighlight.has(agentId);
          this.characterFactory.updateVisuals(updatedMeshData.group, agent, isSelected, isPartOfSelectedHierarchy && !isSelected);
        } else {
          const isSelected = state.selectedAgentIds.has(agentId);
          const isPartOfSelectedHierarchy = subordinateIdsOfSelectedBosses.has(agentId) || bossIdsToHighlight.has(agentId);
          this.characterFactory.updateVisuals(meshData.group, agent, isSelected, isPartOfSelectedHierarchy && !isSelected);
        }
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

  /**
   * Set callback for context menu (right-click on ground, agent, area, or building).
   */
  setOnContextMenu(
    callback: (
      screenPos: { x: number; y: number },
      worldPos: { x: number; z: number },
      target: { type: 'ground' | 'agent' | 'area' | 'building'; id?: string }
    ) => void
  ): void {
    this.onContextMenuCallback = callback;
  }

  /**
   * Set callback for agent hover (for battlefield tooltip).
   */
  setOnAgentHover(
    callback: (
      agentId: string | null,
      screenPos: { x: number; y: number } | null
    ) => void
  ): void {
    this.onAgentHoverCallback = callback;
  }

  // ============================================
  // Public API - Config
  // ============================================

  /**
   * Set character scale.
   */
  setCharacterScale(scale: number): void {
    this.characterScale = scale;
    // Update all existing character models: customModelScale × characterScale × bossMultiplier
    for (const meshData of this.agentMeshes.values()) {
      const body = meshData.group.getObjectByName('characterBody');
      if (body) {
        const customModelScale = body.userData.customModelScale ?? 1.0;
        const isBoss = meshData.group.userData.isBoss === true;
        const bossMultiplier = isBoss ? 1.5 : 1.0;
        body.scale.setScalar(customModelScale * scale * bossMultiplier);
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
   * Enable or disable power saving mode (experimental).
   * When enabled, reduces FPS when the scene is idle.
   */
  setPowerSaving(enabled: boolean): void {
    this.powerSavingEnabled = enabled;
    if (!enabled) {
      this.isIdle = false; // Exit idle mode immediately when disabled
    }
    console.log(`[Tide] Power saving ${enabled ? 'enabled' : 'disabled'}`);
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
    // Mark activity since agents will be moving
    this.markActivity();

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
    // Select the agent and force-open terminal
    store.selectAgent(agentId);
    this.refreshSelectionVisuals();
    store.setTerminalOpen(true);
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

  // Context menu handler (right-click on ground, agent, area, or building)
  private handleContextMenu(
    screenPos: { x: number; y: number },
    worldPos: { x: number; z: number },
    target: { type: 'ground' | 'agent' | 'area' | 'building'; id?: string }
  ): void {
    this.onContextMenuCallback?.(screenPos, worldPos, target);
  }

  // Agent hover handler (for battlefield tooltip)
  private handleAgentHover(
    agentId: string | null,
    screenPos: { x: number; y: number } | null
  ): void {
    this.onAgentHoverCallback?.(agentId, screenPos);
  }

  // ============================================
  // Activity Tracking for Power Saving
  // ============================================

  /**
   * Mark scene as active - call this when user interacts or content changes.
   * This prevents idle throttling for a short period.
   */
  markActivity(): void {
    this.lastActivityTime = Date.now();
    this.isIdle = false;
  }

  /**
   * Check if any agent is currently working.
   * Used to prevent power saving mode while agents are active.
   */
  private hasWorkingAgents(): boolean {
    try {
      const agents = store.getState().agents;
      for (const agent of agents.values()) {
        if (agent.status === 'working') {
          return true;
        }
      }
      return false;
    } catch {
      // If store access fails, assume no working agents
      return false;
    }
  }

  // ============================================
  // Animation Loop
  // ============================================

  private animate = (): void => {
    this.animationFrameId = requestAnimationFrame(this.animate);

    // Safety check - don't render if disposed
    if (!this.renderer || !this.scene || !this.camera) {
      console.warn('[SceneManager] Skipping frame - renderer/scene/camera is null');
      return;
    }

    const now = Date.now();

    // Check if any agent is working - if so, don't allow idle mode
    const hasWorkingAgents = this.hasWorkingAgents();

    // Check if we're idle (no activity for idleThreshold ms) - only when power saving is enabled
    // and no agents are actively working
    if (this.powerSavingEnabled && !hasWorkingAgents && !this.isIdle && now - this.lastActivityTime > this.idleThreshold) {
      this.isIdle = true;
    } else if (hasWorkingAgents && this.isIdle) {
      // Exit idle if agents start working
      this.isIdle = false;
    }

    // FPS limiting: use idle FPS limit when idle (and power saving enabled), otherwise user-set limit
    const effectiveFpsLimit = (this.powerSavingEnabled && this.isIdle) ? this.idleFpsLimit : this.fpsLimit;
    const effectiveFrameInterval = effectiveFpsLimit > 0 ? 1000 / effectiveFpsLimit : this.frameInterval;

    if (effectiveFrameInterval > 0) {
      const elapsed = now - this.lastRenderTime;
      if (elapsed < effectiveFrameInterval) {
        // Still update controls for smooth damping even when skipping render
        this.controls.update();
        return; // Skip this frame
      }
      this.lastRenderTime = now;
    }

    // Track FPS
    fpsTracker.tick();
    perf.start('scene:frame');

    this.controls.update();

    // Calculate delta time with a cap to prevent huge jumps after throttling
    const rawDelta = this.lastFrameTime ? (now - this.lastFrameTime) / 1000 : 0.016;
    const deltaTime = Math.min(rawDelta, 0.1); // Cap at 100ms to prevent animation jumps
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

    // If there are active movements, stay out of idle mode
    if (this.movementAnimator.hasActiveMovements()) {
      this.lastActivityTime = now;
      this.isIdle = false;
    }

    // Update procedural animations for models without built-in animations
    this.updateProceduralAnimations(deltaTime);

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

  // Cached boss-subordinate line mappings (updated only when selection changes)
  private cachedLineConnections: Array<{ bossId: string; subId: string }> = [];

  private updateBossSubordinateLines(): void {
    if (this.bossSubordinateLines.length === 0) return;

    // Only update positions if there are active movements (agents are moving)
    // Otherwise the lines don't need updating since agents are stationary
    if (!this.movementAnimator.hasActiveMovements()) return;

    // Use cached connections - these are set up in refreshSelectionVisuals
    for (let i = 0; i < this.cachedLineConnections.length && i < this.bossSubordinateLines.length; i++) {
      const { bossId, subId } = this.cachedLineConnections[i];
      const bossMesh = this.agentMeshes.get(bossId);
      const subMesh = this.agentMeshes.get(subId);

      if (!bossMesh || !subMesh) continue;

      const line = this.bossSubordinateLines[i];
      const positions = line.geometry.attributes.position as THREE.BufferAttribute;

      // Update start point (boss position)
      positions.setXYZ(0, bossMesh.group.position.x, 0.05, bossMesh.group.position.z);
      // Update end point (subordinate position)
      positions.setXYZ(1, subMesh.group.position.x, 0.05, subMesh.group.position.z);
      positions.needsUpdate = true;
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

  // Track camera position for indicator scale updates
  private lastCameraDistanceForScale = 0;
  private lastIndicatorScaleUpdate = 0;
  private static readonly INDICATOR_SCALE_UPDATE_INTERVAL = 100; // Update scales every 100ms max

  private animateWorkingAgents(now: number): void {
    // Only update indicator scales when camera moves significantly or periodically
    // This avoids recalculating for all agents every frame
    const cameraDistance = this.camera.position.length();
    const cameraMoved = Math.abs(cameraDistance - this.lastCameraDistanceForScale) > 0.5;
    const shouldUpdateScales = cameraMoved || (now - this.lastIndicatorScaleUpdate > SceneManager.INDICATOR_SCALE_UPDATE_INTERVAL);

    if (shouldUpdateScales) {
      this.lastCameraDistanceForScale = cameraDistance;
      this.lastIndicatorScaleUpdate = now;

      // Only update scales, skip the store access since we don't need agent data
      for (const [id, meshData] of this.agentMeshes) {
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
  // Procedural Animation Helpers
  // ============================================

  /**
   * Convert agent status to procedural animation state.
   */
  private getProceduralStateForStatus(status: string): ProceduralAnimationState {
    switch (status) {
      case 'idle':
        return 'idle';
      case 'working':
      case 'orphaned':
        return 'working';
      case 'waiting':
      case 'waiting_permission':
        return 'waiting';
      case 'error':
        return 'error';
      case 'offline':
      default:
        return 'static';
    }
  }

  // Cache for procedural animation bodies (updated when agents added/removed)
  private proceduralBodiesCache = new Map<string, THREE.Object3D>();
  private proceduralBodiesDirty = true;

  /**
   * Mark procedural bodies cache as dirty (call when agents added/removed).
   */
  private invalidateProceduralBodiesCache(): void {
    this.proceduralBodiesDirty = true;
  }

  /**
   * Update procedural animations for all registered models.
   */
  private updateProceduralAnimations(deltaTime: number): void {
    // Only rebuild cache when dirty (agents added/removed/changed)
    if (this.proceduralBodiesDirty) {
      this.proceduralBodiesCache.clear();
      for (const [agentId, meshData] of this.agentMeshes) {
        // Only include agents that have no animations (procedurally animated)
        if (this.proceduralAnimator.has(agentId) && meshData.animations.size === 0) {
          const body = meshData.group.getObjectByName('characterBody');
          if (body) {
            this.proceduralBodiesCache.set(agentId, body);
          }
        }
      }
      this.proceduralBodiesDirty = false;
    }

    // Skip update if no procedural animations
    if (this.proceduralBodiesCache.size === 0) return;

    this.proceduralAnimator.update(deltaTime, this.proceduralBodiesCache);
  }

  // ============================================
  // Event Handlers
  // ============================================

  private onWindowResize = (): void => {
    // Always use parent container dimensions - the container has the correct size
    // The canvas itself may have stale dimensions
    const container = this.canvas.parentElement;
    if (!container) return;

    const width = container.clientWidth;
    const height = container.clientHeight;

    // Skip resize if dimensions are invalid
    if (width <= 0 || height <= 0) return;

    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  };

  // ============================================
  // HMR Support
  // ============================================

  reattach(canvas: HTMLCanvasElement, selectionBox: HTMLDivElement): void {
    // Disconnect old observer
    this.resizeObserver?.disconnect();

    // Remove old WebGL context listeners from old canvas
    this.canvas.removeEventListener('webglcontextlost', this.onContextLost);
    this.canvas.removeEventListener('webglcontextrestored', this.onContextRestored);

    // Update canvas reference
    this.canvas = canvas;

    // Add WebGL context listeners to new canvas
    this.canvas.addEventListener('webglcontextlost', this.onContextLost);
    this.canvas.addEventListener('webglcontextrestored', this.onContextRestored);

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
  // Memory Diagnostics
  // ============================================

  /**
   * Get memory diagnostics for debugging.
   * Includes Three.js renderer info and heap usage.
   */
  getMemoryDiagnostics(): {
    threeJs: { geometries: number; textures: number; programs: number } | null;
    heap: { usedMB: number; totalMB: number; limitMB: number } | null;
    agentMeshCount: number;
    bossLineCount: number;
  } {
    const rendererInfo = this.renderer.info;
    return {
      threeJs: rendererInfo?.memory ? {
        geometries: rendererInfo.memory.geometries,
        textures: rendererInfo.memory.textures,
        programs: rendererInfo.programs?.length ?? 0,
      } : null,
      heap: memory.getUsage(),
      agentMeshCount: this.agentMeshes.size,
      bossLineCount: this.bossSubordinateLines.length,
    };
  }

  /**
   * Log memory diagnostics to console.
   */
  logMemoryDiagnostics(): void {
    const diag = this.getMemoryDiagnostics();
    const cacheStats = this.characterLoader.getCacheStats();

    console.group('%c[SceneManager Memory]', 'color: #ff6600; font-weight: bold');
    if (diag.threeJs) {
      console.log(`Three.js: ${diag.threeJs.geometries} geometries, ${diag.threeJs.textures} textures, ${diag.threeJs.programs} programs`);
    }
    if (diag.heap) {
      console.log(`Heap: ${diag.heap.usedMB}MB / ${diag.heap.totalMB}MB (limit: ${diag.heap.limitMB}MB)`);
    }
    console.log(`Agent meshes: ${diag.agentMeshCount}, Boss lines: ${diag.bossLineCount}`);
    console.log(`CharacterLoader cache: ${cacheStats.builtInModels} built-in, ${cacheStats.customModels} custom`);
    if (cacheStats.modelNames.length > 0) {
      console.log(`  Built-in models: ${cacheStats.modelNames.join(', ')}`);
    }
    if (cacheStats.customModelIds.length > 0) {
      console.log(`  Custom models: ${cacheStats.customModelIds.join(', ')}`);
    }
    console.groupEnd();
  }

  // ============================================
  // Cleanup
  // ============================================

  dispose(): void {
    console.log('%c[SceneManager] dispose() called - starting cleanup', 'color: #ff0000; font-weight: bold');

    // Log pre-dispose state
    const preStats = this.characterLoader.getCacheStats();
    console.log(`[SceneManager] Pre-dispose: ${preStats.builtInModels} built-in models, ${preStats.customModels} custom models`);

    // Cancel animation frame first to stop the render loop
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }

    window.removeEventListener('resize', this.onWindowResize);
    this.canvas.removeEventListener('webglcontextlost', this.onContextLost);
    this.canvas.removeEventListener('webglcontextrestored', this.onContextRestored);
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.inputHandler.dispose();
    this.drawingManager.dispose();
    this.buildingManager.dispose();
    // Use dispose() instead of clear() to fully clean up cached resources
    this.effectsManager.dispose();

    // Dispose all agent meshes
    const agentCount = this.agentMeshes.size;
    for (const meshData of this.agentMeshes.values()) {
      this.scene.remove(meshData.group);
      this.characterFactory.disposeAgentMesh(meshData);
    }
    this.agentMeshes.clear();
    console.log(`[SceneManager] Disposed ${agentCount} agent meshes`);

    // Dispose boss-subordinate lines
    for (const line of this.bossSubordinateLines) {
      this.scene.remove(line);
      line.geometry.dispose();
      (line.material as THREE.Material).dispose();
    }
    this.bossSubordinateLines = [];

    // Dispose battlefield
    this.battlefield.dispose();
    console.log('[SceneManager] Disposed battlefield');

    // Dispose character loader template caches (critical for memory leak prevention)
    this.characterLoader.dispose();

    // Clear scene references to help GC BEFORE disposing renderer
    this.scene.clear();

    // Force WebGL context loss BEFORE renderer dispose to ensure GPU memory is released
    // This is especially important for browsers like Brave/Firefox that may retain WebGL resources
    // Getting the context and extension BEFORE dispose ensures we have valid references
    try {
      const gl = this.renderer.getContext();
      const loseContext = gl.getExtension('WEBGL_lose_context');
      if (loseContext) {
        console.log('[SceneManager] Forcing WebGL context loss to release GPU memory');
        loseContext.loseContext();
      }
    } catch (e) {
      // Context may already be lost, which is fine
      console.log('[SceneManager] WebGL context already lost or unavailable');
    }

    // Now dispose renderer and controls after context is lost
    this.renderer.dispose();
    this.controls.dispose();

    // Explicitly null out references to help GC
    // @ts-expect-error - nulling for GC
    this.scene = null;
    // @ts-expect-error - nulling for GC
    this.renderer = null;
    // @ts-expect-error - nulling for GC
    this.controls = null;
    // @ts-expect-error - nulling for GC
    this.camera = null;

    console.log('%c[SceneManager] dispose() complete - all resources freed', 'color: #00ff00; font-weight: bold');
  }
}
