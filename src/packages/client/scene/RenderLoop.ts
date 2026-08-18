import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { fpsTracker } from '../utils/profiling';
import { saveCameraState } from '../utils/camera';
import { getScenePerformanceProfile } from '../utils/devicePerformance';
import { CAMERA_SAVE_INTERVAL } from './config';
import { store } from '../store';
import type { AgentMeshData } from './characters';

// How often to re-check for a detached canvas (view switched away from 3D).
const DETACHED_CANVAS_POLL_MS = 250;

export interface RenderLoopDependencies {
  getRenderer: () => THREE.WebGLRenderer | null;
  getScene: () => THREE.Scene | null;
  getCamera: () => THREE.PerspectiveCamera | null;
  getControls: () => OrbitControls | null;
  getCanvas: () => HTMLCanvasElement;
  isReattaching: () => boolean;
  getAgentMeshes: () => Map<string, AgentMeshData>;
  render: (camera: THREE.Camera) => void;
}

export interface RenderLoopCallbacks {
  onUpdateBattlefield: (deltaTime: number, now: number) => void;
  onUpdateAnimations: (deltaTime: number) => string[]; // Returns completed movement IDs
  onUpdateProceduralAnimations: (deltaTime: number) => void;
  onHandleMovementCompletions: (completedMovements: string[]) => void;
  onUpdateIdleTimers: () => void;
  onUpdateBossSubordinateLines: () => void;
  onUpdateIndicatorScales: (camera: THREE.PerspectiveCamera, agentMeshes: Map<string, AgentMeshData>, scale3d: number) => void;
  onUpdateNotificationBadges?: () => void; // Update visual badges for unseen agents
  onUpdateCameraSmoothing?: (deltaTime: number) => void; // Smooth zoom interpolation
}

/**
 * Manages the main render loop, FPS limiting, and power saving.
 * Extracted from SceneManager for separation of concerns.
 */
export class RenderLoop {
  private deps: RenderLoopDependencies;
  private callbacks: RenderLoopCallbacks;

  // Timing state
  private lastCameraSave = 0;
  private lastTimeUpdate = 0;
  private lastFrameTime = 0;
  private lastRenderTime = Date.now();
  private lastIdleTimerUpdate = 0;

  // FPS limiting
  private fpsLimit = 0;
  private frameInterval = 0;

  // Power saving
  private powerSavingEnabled = false;
  private lastActivityTime = Date.now();
  private isIdle = false;
  private idleThreshold = 2000;
  private idleFpsLimit = 10;

  // Low power mode (mobile battery saver): hard-caps active FPS and drops
  // idle FPS below the regular power-saving floor.
  private lowPowerMode = false;
  private lowPowerMaxFps = 20;
  private lowPowerIdleFpsLimit = 5;

  // Indicator scaling
  private scale3d = 1.0;
  private performanceProfile = getScenePerformanceProfile();
  private lastCameraDistanceForScale = 0;
  private lastIndicatorScaleUpdate = 0;
  private lastNotificationBadgeUpdate = 0;

  // Animation frame
  private animationFrameId: number | null = null;
  private detachedPollTimer: ReturnType<typeof setTimeout> | null = null;

  // Movement activity checker
  private hasActiveMovements: () => boolean = () => false;

  constructor(deps: RenderLoopDependencies, callbacks: RenderLoopCallbacks) {
    this.deps = deps;
    this.callbacks = callbacks;
  }

  // ============================================
  // Configuration
  // ============================================

  setFpsLimit(limit: number): void {
    this.fpsLimit = limit;
    this.frameInterval = limit > 0 ? 1000 / limit : 0;
    console.log(`[Tide] FPS limit set to ${limit}, frameInterval: ${this.frameInterval}ms`);
  }

  setPowerSaving(enabled: boolean): void {
    this.powerSavingEnabled = enabled;
    if (!enabled && !this.lowPowerMode) {
      this.isIdle = false;
    }
    console.log(`[Tide] Power saving ${enabled ? 'enabled' : 'disabled'}`);
  }

  setLowPowerMode(enabled: boolean): void {
    this.lowPowerMode = enabled;
    if (!enabled && !this.powerSavingEnabled) {
      this.isIdle = false;
    }
    console.log(`[Tide] Low power mode ${enabled ? 'enabled' : 'disabled'}`);
  }

  setScale3D(scale: number): void {
    this.scale3d = scale;
  }

  setHasActiveMovements(checker: () => boolean): void {
    this.hasActiveMovements = checker;
  }

  // ============================================
  // Activity Tracking
  // ============================================

  markActivity(): void {
    this.lastActivityTime = Date.now();
    this.isIdle = false;
  }

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
      return false;
    }
  }

  // ============================================
  // Loop Control
  // ============================================

  start(): void {
    if (this.animationFrameId === null) {
      this.animate();
    }
  }

  stop(): void {
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
    if (this.detachedPollTimer !== null) {
      clearTimeout(this.detachedPollTimer);
      this.detachedPollTimer = null;
    }
  }

  isRunning(): boolean {
    return this.animationFrameId !== null;
  }

  // ============================================
  // Main Loop
  // ============================================

  private animate = (): void => {
    if (this.deps.isReattaching()) {
      this.animationFrameId = requestAnimationFrame(this.animate);
      return;
    }

    const renderer = this.deps.getRenderer();
    const scene = this.deps.getScene();
    const camera = this.deps.getCamera();
    const controls = this.deps.getControls();

    if (!renderer || !scene || !camera || !controls) {
      console.warn('[RenderLoop] Skipping frame - renderer/scene/camera/controls is null');
      this.animationFrameId = null;
      return;
    }

    const canvas = this.deps.getCanvas();
    if (!canvas.isConnected) {
      // Canvas temporarily detached (React reconciliation, StrictMode remount, view switch).
      // Keep the loop alive so rendering resumes automatically once the canvas reattaches —
      // but poll gently: in flat/2D/dashboard mode the canvas stays detached for the whole
      // session, and a 60 Hz rAF here was a permanent (if small) tick with nothing to draw.
      this.animationFrameId = requestAnimationFrame(() => {
        // Placeholder id keeps isRunning() true; the timer re-enters the loop.
        this.detachedPollTimer = setTimeout(() => {
          this.detachedPollTimer = null;
          if (this.animationFrameId !== null) this.animate();
        }, DETACHED_CANVAS_POLL_MS);
      });
      return;
    }

    this.animationFrameId = requestAnimationFrame(this.animate);

    const now = Date.now();

    // Check idle state
    const hasWorkingAgents = this.hasWorkingAgents();

    const powerSavingActive = this.powerSavingEnabled || this.lowPowerMode;
    if (powerSavingActive && !hasWorkingAgents && !this.isIdle && now - this.lastActivityTime > this.idleThreshold) {
      this.isIdle = true;
    } else if (hasWorkingAgents && this.isIdle) {
      this.isIdle = false;
    }

    // FPS limiting
    let effectiveFpsLimit = (powerSavingActive && this.isIdle)
      ? (this.lowPowerMode ? this.lowPowerIdleFpsLimit : this.idleFpsLimit)
      : this.fpsLimit;
    if (this.lowPowerMode) {
      effectiveFpsLimit = effectiveFpsLimit > 0
        ? Math.min(effectiveFpsLimit, this.lowPowerMaxFps)
        : this.lowPowerMaxFps;
    }
    if (this.performanceProfile.maxFps > 0) {
      effectiveFpsLimit = effectiveFpsLimit > 0
        ? Math.min(effectiveFpsLimit, this.performanceProfile.maxFps)
        : this.performanceProfile.maxFps;
    }
    const effectiveFrameInterval = effectiveFpsLimit > 0 ? 1000 / effectiveFpsLimit : this.frameInterval;

    if (effectiveFrameInterval > 0) {
      const elapsed = now - this.lastRenderTime;
      if (elapsed < effectiveFrameInterval) {
        controls.update();
        return;
      }
      this.lastRenderTime = now;
    }

    // Track FPS
    fpsTracker.tick();

    controls.update();

    // Calculate delta time
    const rawDelta = this.lastFrameTime ? (now - this.lastFrameTime) / 1000 : 0.016;
    const deltaTime = Math.min(rawDelta, 0.1);
    this.lastFrameTime = now;

    // Advance smooth zoom interpolation
    this.callbacks.onUpdateCameraSmoothing?.(deltaTime);

    // Save camera periodically
    if (now - this.lastCameraSave > CAMERA_SAVE_INTERVAL) {
      saveCameraState(
        { x: camera.position.x, y: camera.position.y, z: camera.position.z },
        { x: controls.target.x, y: controls.target.y, z: controls.target.z }
      );
      this.lastCameraSave = now;
    }

    // Update battlefield (time of day, galactic animation)
    this.callbacks.onUpdateBattlefield(deltaTime, now);

    // Update time of day tracking
    // Periodic time update placeholder (for future use)
    if (now - this.lastTimeUpdate > 60000) {
      this.lastTimeUpdate = now;
    }
    // Suppress unused variable warning for 'id' parameter in frame timing

    // Update animations
    const completedMovements = this.callbacks.onUpdateAnimations(deltaTime);

    // Check for active movements
    if (this.hasActiveMovements()) {
      this.lastActivityTime = now;
      this.isIdle = false;
    }

    // Update procedural animations
    this.callbacks.onUpdateProceduralAnimations(deltaTime);

    // Handle completed movements
    this.callbacks.onHandleMovementCompletions(completedMovements);

    // Update idle timers every second
    if (now - this.lastIdleTimerUpdate > 1000) {
      this.callbacks.onUpdateIdleTimers();
      this.lastIdleTimerUpdate = now;
    }

    // Update notification badges
    const badgeInterval = this.performanceProfile.notificationBadgeUpdateInterval;
    if (badgeInterval === 0 || now - this.lastNotificationBadgeUpdate >= badgeInterval) {
      this.callbacks.onUpdateNotificationBadges?.();
      this.lastNotificationBadgeUpdate = now;
    }

    // Update boss-subordinate lines
    this.callbacks.onUpdateBossSubordinateLines();

    // Update indicator scales
    const cameraDistance = camera.position.length();
    const cameraMoved = Math.abs(cameraDistance - this.lastCameraDistanceForScale) > 0.5;
    const shouldUpdateScales = cameraMoved ||
      (now - this.lastIndicatorScaleUpdate > this.performanceProfile.indicatorUpdateInterval);

    if (shouldUpdateScales) {
      this.lastCameraDistanceForScale = cameraDistance;
      this.lastIndicatorScaleUpdate = now;
      this.callbacks.onUpdateIndicatorScales(camera, this.deps.getAgentMeshes(), this.scale3d);
    }

    // Render (uses post-processing if enabled)
    this.deps.render(camera);
  };
}
