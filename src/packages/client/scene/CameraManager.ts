import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { loadCameraState } from '../utils/camera';
import { store } from '../store';

/**
 * Manages camera creation, controls setup, and camera operations.
 * Extracted from SceneManager for separation of concerns.
 */
export class CameraManager {
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;

  constructor(canvas: HTMLCanvasElement, renderer: THREE.WebGLRenderer) {
    this.camera = this.createCamera(canvas);
    this.controls = this.createControls(renderer);
  }

  // ============================================
  // Getters
  // ============================================

  getCamera(): THREE.PerspectiveCamera {
    return this.camera;
  }

  getControls(): OrbitControls {
    return this.controls;
  }

  // ============================================
  // Initialization
  // ============================================

  private createCamera(canvas: HTMLCanvasElement): THREE.PerspectiveCamera {
    const camera = new THREE.PerspectiveCamera(
      60,
      canvas.clientWidth / canvas.clientHeight,
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

  private createControls(renderer: THREE.WebGLRenderer): OrbitControls {
    const controls = new OrbitControls(this.camera, renderer.domElement);
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

    // Disable default zoom - handled in InputHandler for mouse-position-aware zooming
    controls.enableZoom = false;

    // Disable OrbitControls touch handling - custom touch handlers in InputHandler
    controls.touches = {
      ONE: null as unknown as THREE.TOUCH,
      TWO: null as unknown as THREE.TOUCH,
    };

    return controls;
  }

  // ============================================
  // Operations
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

  updateAspect(width: number, height: number): void {
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  // ============================================
  // HMR Support
  // ============================================

  recreateControls(renderer: THREE.WebGLRenderer): void {
    this.controls.dispose();
    this.controls = this.createControls(renderer);
  }

  // ============================================
  // Cleanup
  // ============================================

  dispose(): void {
    this.controls.dispose();
  }
}
