import * as THREE from 'three';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { ScreenPosition } from './types';
import { store } from '../../store';

/**
 * Interface for raycasting to ground/plane.
 */
export interface RaycastProvider {
  raycastToPlane(normalizedX: number, normalizedY: number): THREE.Vector3 | null;
  getNormalizedMouseFromEvent(event: MouseEvent): THREE.Vector2;
}

/**
 * Handles camera movement: wheel zoom, pan, and orbit controls.
 */
export class CameraController {
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private canvas: HTMLCanvasElement;
  private raycastProvider: RaycastProvider | null = null;

  // Smooth zoom interpolation state
  private goalCameraPos: THREE.Vector3 | null = null;
  private goalOrbitTarget: THREE.Vector3 | null = null;

  constructor(
    camera: THREE.PerspectiveCamera,
    controls: OrbitControls,
    canvas: HTMLCanvasElement
  ) {
    this.camera = camera;
    this.controls = controls;
    this.canvas = canvas;
  }

  /**
   * Set the raycast provider for zoom targeting.
   */
  setRaycastProvider(provider: RaycastProvider): void {
    this.raycastProvider = provider;
  }

  /**
   * Update controls reference.
   */
  setControls(controls: OrbitControls): void {
    this.controls = controls;
  }

  /**
   * Update canvas reference.
   */
  setCanvas(canvas: HTMLCanvasElement): void {
    this.canvas = canvas;
  }

  /**
   * Handle wheel zoom towards mouse position with smooth interpolation.
   * @param event - The wheel event
   * @param speedMultiplier - Optional sensitivity multiplier (default 1.0)
   */
  handleWheelZoom(event: WheelEvent, speedMultiplier: number = 1.0): void {
    event.preventDefault();

    // Normalize deltaY: mice typically send ~100-120 per notch, trackpads send smaller values
    // We want consistent behavior regardless of device
    const normalizedDelta = Math.sign(event.deltaY) * Math.min(Math.abs(event.deltaY), 100) / 100;
    const zoomIn = normalizedDelta < 0;

    // Base zoom factor: 8% per normalized scroll unit, multiplied by sensitivity
    const zoomFactor = 0.08 * Math.abs(normalizedDelta) * speedMultiplier;

    // Use goal state if mid-animation, otherwise use current camera state.
    // This lets rapid scroll ticks accumulate on the target rather than the
    // current (still-interpolating) position, so the camera keeps up.
    const startTarget = this.goalOrbitTarget?.clone() ?? this.controls.target.clone();
    const startCamPos = this.goalCameraPos?.clone() ?? this.camera.position.clone();

    const cameraToTarget = startCamPos.clone().sub(startTarget);
    const currentDistance = cameraToTarget.length();

    const minDistance = this.controls.minDistance;
    const maxDistance = this.controls.maxDistance;
    const newDistance = zoomIn
      ? Math.max(minDistance, currentDistance * (1 - zoomFactor))
      : Math.min(maxDistance, currentDistance * (1 + zoomFactor));

    if (newDistance === currentDistance) return;

    // Raycast from the CURRENT camera (what the user sees) for accurate cursor targeting
    let targetPoint: THREE.Vector3 | null = null;
    if (this.raycastProvider) {
      const mouse = this.raycastProvider.getNormalizedMouseFromEvent(event);
      targetPoint = this.raycastProvider.raycastToPlane(mouse.x, mouse.y);
    }

    if (!targetPoint) {
      // Fallback: just zoom without moving target
      const direction = cameraToTarget.normalize();
      this.goalCameraPos = startTarget.clone().add(direction.multiplyScalar(newDistance));
      this.goalOrbitTarget = startTarget.clone();
      return;
    }

    // Move orbit target towards mouse position proportionally
    const zoomRatio = newDistance / currentDistance;
    const targetToMouse = targetPoint.clone().sub(startTarget);
    const moveAmount = 1 - zoomRatio;

    const newTarget = startTarget.clone().add(targetToMouse.multiplyScalar(moveAmount));
    newTarget.y = Math.max(0, newTarget.y);

    const newCameraDirection = cameraToTarget.normalize();
    this.goalCameraPos = newTarget.clone().add(newCameraDirection.multiplyScalar(newDistance));
    this.goalOrbitTarget = newTarget;
  }

  /**
   * Handle pinch-to-zoom gesture.
   */
  handlePinchZoom(scale: number, center: ScreenPosition): void {
    // Cancel smooth zoom — pinch is a continuous gesture that needs instant response
    this.goalCameraPos = null;
    this.goalOrbitTarget = null;
    const cameraToTarget = this.camera.position.clone().sub(this.controls.target);
    const currentDistance = cameraToTarget.length();

    const minDistance = this.controls.minDistance;
    const maxDistance = this.controls.maxDistance;
    const newDistance = Math.max(minDistance, Math.min(maxDistance, currentDistance * scale));

    if (newDistance === currentDistance) return;

    // Get normalized coordinates from center
    const rect = this.canvas.getBoundingClientRect();
    const normalizedX = ((center.x - rect.left) / rect.width) * 2 - 1;
    const normalizedY = -((center.y - rect.top) / rect.height) * 2 + 1;

    let targetPoint: THREE.Vector3 | null = null;
    if (this.raycastProvider) {
      targetPoint = this.raycastProvider.raycastToPlane(normalizedX, normalizedY);
    }

    if (!targetPoint) {
      const direction = cameraToTarget.normalize();
      this.camera.position.copy(this.controls.target).add(direction.multiplyScalar(newDistance));
      return;
    }

    const zoomRatio = newDistance / currentDistance;
    const targetToCenter = targetPoint.clone().sub(this.controls.target);
    const moveAmount = 1 - zoomRatio;

    const newTarget = this.controls.target.clone().add(targetToCenter.multiplyScalar(moveAmount));
    newTarget.y = Math.max(0, newTarget.y);

    this.controls.target.copy(newTarget);

    const newCameraDirection = cameraToTarget.normalize();
    this.camera.position.copy(newTarget).add(newCameraDirection.multiplyScalar(newDistance));
  }

  /**
   * Handle single-finger pan gesture.
   */
  handlePan(dx: number, dy: number): void {
    this.goalCameraPos = null;
    this.goalOrbitTarget = null;
    const cameraDirection = new THREE.Vector3();
    this.camera.getWorldDirection(cameraDirection);

    // Right vector perpendicular to camera on XZ plane
    const right = new THREE.Vector3(-cameraDirection.z, 0, cameraDirection.x).normalize();

    // Forward vector projected onto XZ plane
    const forward = new THREE.Vector3(cameraDirection.x, 0, cameraDirection.z).normalize();

    // Pan sensitivity based on camera distance
    const distance = this.camera.position.distanceTo(this.controls.target);
    const panSpeed = distance * 0.005;

    const panDelta = new THREE.Vector3();
    panDelta.add(right.multiplyScalar(-dx * panSpeed));
    panDelta.add(forward.multiplyScalar(dy * panSpeed));

    this.controls.target.add(panDelta);
    this.camera.position.add(panDelta);
  }

  /**
   * Handle orbit gesture (rotate camera around target).
   */
  handleOrbit(dx: number, dy: number): void {
    this.goalCameraPos = null;
    this.goalOrbitTarget = null;
    const rotateSpeed = 0.005;

    const angleX = -dx * rotateSpeed;
    const angleY = -dy * rotateSpeed;

    const offset = this.camera.position.clone().sub(this.controls.target);

    const spherical = new THREE.Spherical();
    spherical.setFromVector3(offset);

    spherical.theta += angleX;
    spherical.phi += angleY;

    // Clamp phi to avoid flipping
    spherical.phi = Math.max(0.1, Math.min(Math.PI - 0.1, spherical.phi));

    offset.setFromSpherical(spherical);

    this.camera.position.copy(this.controls.target).add(offset);
    this.camera.lookAt(this.controls.target);
  }

  /**
   * Handle two-finger rotation (twist gesture).
   */
  handleTwistRotation(angleDelta: number): void {
    this.goalCameraPos = null;
    this.goalOrbitTarget = null;
    const offset = this.camera.position.clone().sub(this.controls.target);

    const spherical = new THREE.Spherical();
    spherical.setFromVector3(offset);

    spherical.theta += angleDelta;
    spherical.phi = Math.max(0.1, Math.min(Math.PI - 0.1, spherical.phi));

    offset.setFromSpherical(spherical);

    this.camera.position.copy(this.controls.target).add(offset);
    this.camera.lookAt(this.controls.target);
  }

  /**
   * Advance smooth zoom interpolation. Call once per frame from the render loop.
   */
  updateSmoothZoom(deltaTime: number): void {
    if (!this.goalCameraPos || !this.goalOrbitTarget) return;

    const smoothing = store.getMouseControls().sensitivity.smoothing;

    // smoothing=0 means instant — snap directly to goal
    if (smoothing <= 0) {
      this.camera.position.copy(this.goalCameraPos);
      this.controls.target.copy(this.goalOrbitTarget);
      this.goalCameraPos = null;
      this.goalOrbitTarget = null;
      return;
    }

    // Map smoothing (0–1) to exponential decay rate.
    // Lower smoothing → faster convergence, higher → more gradual.
    //   smoothing 0.3 (default) → factor ≈ 15 → reaches 95% in ~0.2 s
    //   smoothing 1.0            → factor ≈ 3  → reaches 95% in ~1.0 s
    const factor = THREE.MathUtils.lerp(20, 3, smoothing);
    const t = 1 - Math.exp(-factor * deltaTime);

    this.camera.position.lerp(this.goalCameraPos, t);
    this.controls.target.lerp(this.goalOrbitTarget, t);

    // Snap when close enough to avoid lingering micro-movements
    if (
      this.camera.position.distanceTo(this.goalCameraPos) < 0.005 &&
      this.controls.target.distanceTo(this.goalOrbitTarget) < 0.005
    ) {
      this.camera.position.copy(this.goalCameraPos);
      this.controls.target.copy(this.goalOrbitTarget);
      this.goalCameraPos = null;
      this.goalOrbitTarget = null;
    }
  }

  /**
   * Whether a smooth zoom animation is currently in progress.
   */
  get isZoomAnimating(): boolean {
    return this.goalCameraPos !== null;
  }
}
