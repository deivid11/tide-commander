import * as THREE from 'three';
import { MOVE_SPEED } from '../config';
import type { AgentMeshData } from '../characters/CharacterFactory';
import type { AnimationMapping } from '../../../shared/types';

/**
 * Movement animation state.
 */
interface MovementState {
  agentId: string;
  startPos: THREE.Vector3;
  endPos: THREE.Vector3;
  startTime: number;
  duration: number;
}

/**
 * Available animation names from Kenney Mini Characters.
 */
export const ANIMATIONS = {
  STATIC: 'static',
  IDLE: 'idle',
  WALK: 'walk',
  SPRINT: 'sprint',
  JUMP: 'jump',
  FALL: 'fall',
  CROUCH: 'crouch',
  SIT: 'sit',
  DIE: 'die',
  EMOTE_YES: 'emote-yes',
  EMOTE_NO: 'emote-no',
} as const;

/**
 * Animation state types used for custom animation mapping.
 */
export type AnimationState = 'idle' | 'walk' | 'working';

/**
 * Bounce animation config for jump.
 */
const JUMP_BOUNCE = {
  height: 0.5,      // Max height of bounce
  speed: 1.5,       // Bounces per second
};

/**
 * Handles agent movement and GLTF animation playback.
 */
export class MovementAnimator {
  private movements = new Map<string, MovementState>();
  private clock = new THREE.Clock();
  private jumpingAgents = new Set<string>(); // Track agents playing jump animation
  private animatingAgents = new Set<string>(); // Track agents with active mixer animations

  /**
   * Check if an agent is currently moving.
   */
  isMoving(agentId: string): boolean {
    return this.movements.has(agentId);
  }

  /**
   * Check if any agents are currently moving.
   */
  hasActiveMovements(): boolean {
    return this.movements.size > 0;
  }

  /**
   * Resolve the actual animation name based on custom mapping.
   * Falls back to built-in animation names if no custom mapping exists.
   *
   * @param meshData - The agent mesh data
   * @param state - The animation state (idle, walk, working)
   * @returns The resolved animation name to use
   */
  private resolveAnimationName(meshData: AgentMeshData, state: AnimationState): string {
    const characterBody = meshData.group.getObjectByName('characterBody');
    const mapping = characterBody?.userData?.animationMapping as AnimationMapping | undefined;

    if (mapping) {
      const customName = mapping[state];
      if (customName && meshData.animations.has(customName)) {
        return customName;
      }
      // Also try lowercase version
      if (customName && meshData.animations.has(customName.toLowerCase())) {
        return customName.toLowerCase();
      }
    }

    // Fall back to built-in names
    switch (state) {
      case 'idle':
        return ANIMATIONS.IDLE;
      case 'walk':
        return ANIMATIONS.WALK;
      case 'working':
        return ANIMATIONS.JUMP; // Default working animation is jump
      default:
        return ANIMATIONS.IDLE;
    }
  }

  /**
   * Play an animation based on state, respecting custom animation mappings.
   *
   * @param meshData - The agent mesh data
   * @param state - The animation state (idle, walk, working)
   * @param options - Animation options
   */
  playAnimationForState(meshData: AgentMeshData, state: AnimationState, options?: {
    loop?: boolean;
    fadeTime?: number;
    timeScale?: number;
  }): void {
    const animationName = this.resolveAnimationName(meshData, state);
    this.playAnimation(meshData, animationName, options);
  }

  /**
   * Start a movement animation for an agent.
   */
  startMovement(
    agentId: string,
    meshData: AgentMeshData,
    targetPos: { x: number; y: number; z: number }
  ): void {
    const startPos = meshData.group.position.clone();
    const endPos = new THREE.Vector3(targetPos.x, targetPos.y, targetPos.z);

    const distance = startPos.distanceTo(endPos);
    const duration = (distance / MOVE_SPEED) * 1000;

    // Cancel existing movement
    this.movements.delete(agentId);

    // Store movement state
    this.movements.set(agentId, {
      agentId,
      startPos,
      endPos,
      startTime: performance.now(),
      duration: Math.max(duration, 200),
    });

    // Play walk animation
    this.playAnimation(meshData, ANIMATIONS.WALK);

    // Rotate character to face direction
    this.faceDirection(meshData, startPos, endPos);
  }

  /**
   * Cancel an agent's movement.
   */
  cancelMovement(agentId: string, meshData: AgentMeshData): void {
    this.movements.delete(agentId);
    this.playAnimation(meshData, ANIMATIONS.IDLE);
  }

  /**
   * Play a specific animation on an agent.
   */
  playAnimation(meshData: AgentMeshData, animationName: string, options?: {
    loop?: boolean;
    fadeTime?: number;
    timeScale?: number;
  }): void {
    if (!meshData.mixer) return;

    const agentId = meshData.group.userData.agentId as string;

    const clip = meshData.animations.get(animationName);
    if (!clip) {
      console.warn(`[MovementAnimator] Animation not found: ${animationName}, available:`, Array.from(meshData.animations.keys()));
      // Stop jump bounce if switching to non-existent animation
      this.jumpingAgents.delete(agentId);
      return;
    }
    console.log(`[MovementAnimator] Playing: ${animationName}`);

    const {
      loop = true,
      fadeTime = 0.2,
      timeScale = 1,
    } = options ?? {};

    const newAction = meshData.mixer.clipAction(clip);
    newAction.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
    newAction.clampWhenFinished = !loop;
    newAction.timeScale = timeScale;

    // Crossfade from current action
    if (meshData.currentAction && meshData.currentAction !== newAction) {
      meshData.currentAction.fadeOut(fadeTime);
      newAction.reset().fadeIn(fadeTime).play();
    } else {
      newAction.reset().play();
    }

    meshData.currentAction = newAction;

    // Track agents with active animations for efficient mixer updates
    this.animatingAgents.add(agentId);

    // Track jump animation for bounce effect
    if (animationName === ANIMATIONS.JUMP && loop) {
      this.jumpingAgents.add(agentId);
    } else {
      this.jumpingAgents.delete(agentId);
      // Reset character body Y position when stopping jump
      const characterBody = meshData.group.getObjectByName('characterBody');
      if (characterBody) {
        characterBody.position.y = 0;
      }
    }
  }

  /**
   * Stop animation for an agent (removes from active tracking).
   */
  stopAnimation(agentId: string): void {
    this.animatingAgents.delete(agentId);
    this.jumpingAgents.delete(agentId);
  }

  /**
   * Rotate character to face movement direction.
   */
  private faceDirection(
    meshData: AgentMeshData,
    from: THREE.Vector3,
    to: THREE.Vector3
  ): void {
    const direction = new THREE.Vector3().subVectors(to, from).normalize();

    if (direction.x !== 0 || direction.z !== 0) {
      const characterBody = meshData.group.getObjectByName('characterBody');
      if (characterBody) {
        const angle = Math.atan2(direction.x, direction.z);
        characterBody.rotation.y = angle;
      }
    }
  }

  /**
   * Update all animations and movements.
   * @param agentMeshes Map of agent IDs to mesh data
   * @returns List of agent IDs that completed their movements
   */
  update(agentMeshes: Map<string, AgentMeshData>): string[] {
    const deltaTime = this.clock.getDelta();
    const now = performance.now();
    const completed: string[] = [];

    // Only update mixers for agents with active animations (much more efficient)
    for (const agentId of this.animatingAgents) {
      const meshData = agentMeshes.get(agentId);
      meshData?.mixer?.update(deltaTime);
    }

    // Apply jump bounce effect to jumping agents
    for (const agentId of this.jumpingAgents) {
      const meshData = agentMeshes.get(agentId);
      if (!meshData) continue;

      const characterBody = meshData.group.getObjectByName('characterBody');
      if (characterBody) {
        // Use absolute sine wave for bounce (always positive, 0 to height)
        const bounceY = Math.abs(Math.sin(now * 0.001 * JUMP_BOUNCE.speed * Math.PI * 2)) * JUMP_BOUNCE.height;
        characterBody.position.y = bounceY;
      }
    }

    // Update movement positions
    for (const [agentId, movement] of this.movements) {
      const meshData = agentMeshes.get(agentId);

      if (!meshData) {
        completed.push(agentId);
        continue;
      }

      const elapsed = now - movement.startTime;
      let t = Math.min(elapsed / movement.duration, 1);
      t = this.easeOutCubic(t);

      // Update position along path
      meshData.group.position.lerpVectors(movement.startPos, movement.endPos, t);

      // Smoothly rotate towards direction
      this.smoothRotateToDirection(meshData, movement.startPos, movement.endPos, deltaTime);

      if (t >= 1) {
        completed.push(agentId);
        meshData.group.position.copy(movement.endPos);
        // Note: Status-based animation is handled by SceneManager using the completed list
      }
    }

    // Clean up completed movements
    for (const agentId of completed) {
      this.movements.delete(agentId);
    }

    return completed;
  }

  /**
   * Smoothly rotate character towards movement direction.
   */
  private smoothRotateToDirection(
    meshData: AgentMeshData,
    from: THREE.Vector3,
    to: THREE.Vector3,
    deltaTime: number
  ): void {
    const direction = new THREE.Vector3().subVectors(to, from).normalize();

    if (direction.x === 0 && direction.z === 0) return;

    const characterBody = meshData.group.getObjectByName('characterBody');
    if (!characterBody) return;

    const targetAngle = Math.atan2(direction.x, direction.z);
    const currentAngle = characterBody.rotation.y;
    const delta = targetAngle - currentAngle;

    // Handle angle wrapping
    const wrappedDelta = Math.atan2(Math.sin(delta), Math.cos(delta));

    // Smooth rotation
    const rotationSpeed = 10;
    characterBody.rotation.y += wrappedDelta * Math.min(1, rotationSpeed * deltaTime);
  }

  /**
   * Ease out cubic function.
   */
  private easeOutCubic(t: number): number {
    return 1 - Math.pow(1 - t, 3);
  }

  /**
   * Get number of active movements.
   */
  get activeCount(): number {
    return this.movements.size;
  }

  /**
   * Clear all movements and effects.
   */
  clear(): void {
    this.movements.clear();
    this.jumpingAgents.clear();
  }
}
