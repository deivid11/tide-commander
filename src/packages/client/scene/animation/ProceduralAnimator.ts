import * as THREE from 'three';

/**
 * Procedural animation states for models without built-in animations.
 * Provides simple bobbing, swaying, and pulsing effects.
 */
export type ProceduralAnimationState = 'idle' | 'working' | 'waiting' | 'error' | 'static';

interface ProceduralAnimationData {
  state: ProceduralAnimationState;
  time: number;
  basePosition: THREE.Vector3;
  baseRotation: THREE.Euler;
  baseScale: THREE.Vector3;
}

/**
 * Manages procedural animations for 3D models that don't have built-in animations.
 * Provides subtle movement effects to make static models feel more alive.
 */
export class ProceduralAnimator {
  private animations: Map<string, ProceduralAnimationData> = new Map();

  /**
   * Register a model for procedural animation.
   * Call this when adding a model that has no built-in animations.
   */
  register(id: string, body: THREE.Object3D, initialState: ProceduralAnimationState = 'idle'): void {
    this.animations.set(id, {
      state: initialState,
      time: Math.random() * Math.PI * 2, // Random phase offset so not all sync
      basePosition: body.position.clone(),
      baseRotation: body.rotation.clone(),
      baseScale: body.scale.clone(),
    });
  }

  /**
   * Unregister a model from procedural animation.
   */
  unregister(id: string): void {
    this.animations.delete(id);
  }

  /**
   * Check if a model is registered for procedural animation.
   */
  has(id: string): boolean {
    return this.animations.has(id);
  }

  /**
   * Set the animation state for a model.
   * Resets animation time to 0 on state change so the new animation
   * starts cleanly instead of snapping to an arbitrary phase.
   */
  setState(id: string, state: ProceduralAnimationState): void {
    const data = this.animations.get(id);
    if (data && data.state !== state) {
      data.state = state;
      data.time = 0;
    }
  }

  /**
   * Update the base position (called when model moves).
   */
  updateBasePosition(id: string, position: THREE.Vector3): void {
    const data = this.animations.get(id);
    if (data) {
      data.basePosition.copy(position);
    }
  }

  /**
   * Update all procedural animations. Call this in the render loop.
   * @param deltaTime Time since last frame in seconds
   * @param bodies Map of agent ID to their characterBody object
   */
  update(deltaTime: number, bodies: Map<string, THREE.Object3D>): void {
    for (const [id, data] of this.animations) {
      const body = bodies.get(id);
      if (!body) continue;

      data.time += deltaTime;

      switch (data.state) {
        case 'idle':
          this.applyIdleAnimation(body, data);
          break;
        case 'working':
          this.applyWorkingAnimation(body, data);
          break;
        case 'waiting':
          this.applyWaitingAnimation(body, data);
          break;
        case 'error':
          this.applyErrorAnimation(body, data);
          break;
        case 'static':
          // No animation - reset to base
          this.resetToBase(body, data);
          break;
      }
    }
  }

  /**
   * Idle: Gentle breathing-like bob and subtle sway.
   */
  private applyIdleAnimation(body: THREE.Object3D, data: ProceduralAnimationData): void {
    const t = data.time;

    // Gentle vertical bob (breathing effect)
    const bobAmount = 0.02;
    const bobSpeed = 1.5;
    const yOffset = Math.sin(t * bobSpeed) * bobAmount;

    // Very subtle side-to-side sway
    const swayAmount = 0.01;
    const swaySpeed = 0.8;
    const xOffset = Math.sin(t * swaySpeed) * swayAmount;

    body.position.set(
      data.basePosition.x + xOffset,
      data.basePosition.y + yOffset,
      data.basePosition.z
    );
  }

  /**
   * Working: Energetic movement - pronounced bob, sway, and rotation.
   * Made highly visible so users can clearly see when agents are working.
   */
  private applyWorkingAnimation(body: THREE.Object3D, data: ProceduralAnimationData): void {
    const t = data.time;

    // Strong bouncy bob - very noticeable up/down movement
    const bobAmount = 0.25;
    const bobSpeed = 6.0;
    const yOffset = Math.abs(Math.sin(t * bobSpeed)) * bobAmount;

    // Pronounced side-to-side movement
    const swayAmount = 0.15;
    const swaySpeed = 3.0;
    const xOffset = Math.sin(t * swaySpeed) * swayAmount;

    // Forward/back lean for "working hard" feel
    const leanAmount = 0.22;
    const leanSpeed = 3.0;
    const lean = Math.sin(t * leanSpeed) * leanAmount;

    // Z movement for dynamic depth
    const zSwayAmount = 0.1;
    const zOffset = Math.sin(t * swaySpeed * 0.7) * zSwayAmount;

    // Add subtle rotation wiggle on Y axis for extra liveliness
    const wiggleAmount = 0.12;
    const wiggleSpeed = 4.0;
    const yRotWiggle = Math.sin(t * wiggleSpeed) * wiggleAmount;

    body.position.set(
      data.basePosition.x + xOffset,
      data.basePosition.y + yOffset,
      data.basePosition.z + zOffset
    );
    body.rotation.set(
      data.baseRotation.x + lean,
      data.baseRotation.y + yRotWiggle,
      data.baseRotation.z
    );
  }

  /**
   * Waiting: Impatient shifting weight side to side.
   */
  private applyWaitingAnimation(body: THREE.Object3D, data: ProceduralAnimationData): void {
    const t = data.time;

    // Slow weight shift
    const swayAmount = 0.02;
    const swaySpeed = 1.2;
    const xOffset = Math.sin(t * swaySpeed) * swayAmount;

    // Slight tilt with weight shift
    const tiltAmount = 0.03;
    const tilt = Math.sin(t * swaySpeed) * tiltAmount;

    // Occasional small bob
    const bobAmount = 0.01;
    const bobSpeed = 2.0;
    const yOffset = Math.sin(t * bobSpeed) * bobAmount;

    body.position.set(
      data.basePosition.x + xOffset,
      data.basePosition.y + yOffset,
      data.basePosition.z
    );
    body.rotation.set(
      data.baseRotation.x,
      data.baseRotation.y,
      data.baseRotation.z + tilt
    );
  }

  /**
   * Error: Shake/vibrate effect.
   */
  private applyErrorAnimation(body: THREE.Object3D, data: ProceduralAnimationData): void {
    const t = data.time;

    // Quick shake
    const shakeAmount = 0.015;
    const shakeSpeed = 15.0;
    const xOffset = Math.sin(t * shakeSpeed) * shakeAmount;
    const zOffset = Math.cos(t * shakeSpeed * 1.3) * shakeAmount * 0.5;

    body.position.set(
      data.basePosition.x + xOffset,
      data.basePosition.y,
      data.basePosition.z + zOffset
    );
  }

  /**
   * Reset model to base transform.
   */
  private resetToBase(body: THREE.Object3D, data: ProceduralAnimationData): void {
    body.position.copy(data.basePosition);
    body.rotation.copy(data.baseRotation);
    body.scale.copy(data.baseScale);
  }

  /**
   * Clear all registered animations.
   */
  clear(): void {
    this.animations.clear();
  }
}
