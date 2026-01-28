import * as THREE from 'three';
import { PostProcessing } from './PostProcessing';

/**
 * Manages Three.js scene and renderer initialization.
 * Extracted from SceneManager for separation of concerns.
 */
export class SceneCore {
  private scene: THREE.Scene;
  private renderer: THREE.WebGLRenderer;
  private canvas: HTMLCanvasElement;
  private postProcessing: PostProcessing | null = null;
  private camera: THREE.Camera | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.scene = this.createScene();
    this.renderer = this.createRenderer();
  }

  // ============================================
  // Getters
  // ============================================

  getScene(): THREE.Scene {
    return this.scene;
  }

  getRenderer(): THREE.WebGLRenderer {
    return this.renderer;
  }

  getCanvas(): HTMLCanvasElement {
    return this.canvas;
  }

  getPostProcessing(): PostProcessing | null {
    return this.postProcessing;
  }

  // ============================================
  // Post-Processing
  // ============================================

  /**
   * Initialize post-processing with the given camera.
   * Must be called after camera is created.
   */
  initPostProcessing(camera: THREE.Camera): void {
    this.camera = camera;
    this.postProcessing = new PostProcessing(this.renderer, this.scene, camera);
  }

  /**
   * Set saturation level for post-processing.
   * @param value 0 = grayscale, 1 = normal, 2 = highly saturated
   */
  setSaturation(value: number): void {
    this.postProcessing?.setSaturation(value);
  }

  /**
   * Get current saturation value.
   */
  getSaturation(): number {
    return this.postProcessing?.getSaturation() ?? 1.0;
  }

  /**
   * Enable or disable post-processing.
   */
  setPostProcessingEnabled(enabled: boolean): void {
    this.postProcessing?.setEnabled(enabled);
  }

  /**
   * Check if post-processing is enabled.
   */
  isPostProcessingEnabled(): boolean {
    return this.postProcessing?.isEnabled() ?? false;
  }

  /**
   * Render the scene (with post-processing if enabled).
   */
  render(camera: THREE.Camera): void {
    if (this.postProcessing?.isEnabled()) {
      this.postProcessing.render();
    } else {
      this.renderer.render(this.scene, camera);
    }
  }

  // ============================================
  // Initialization
  // ============================================

  private createScene(): THREE.Scene {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a1a2a); // Dark blue
    return scene;
  }

  private createRenderer(): THREE.WebGLRenderer {
    // Verify canvas is valid and attached to DOM
    if (!this.canvas || !this.canvas.parentElement) {
      throw new Error('[SceneCore] Canvas is not attached to DOM');
    }

    // Priority for dimensions: parent container > canvas CSS > canvas attributes > window
    const container = this.canvas.parentElement;
    let width = container.clientWidth || this.canvas.clientWidth || this.canvas.width;
    let height = container.clientHeight || this.canvas.clientHeight || this.canvas.height;

    // If dimensions are still 0, use window as final fallback
    if (!width || !height) {
      width = window.innerWidth;
      height = window.innerHeight;
      console.log('[SceneCore] Using window fallback dimensions:', width, height);
    }

    // Ensure canvas has explicit dimensions (required for WebGL context)
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }

    console.log('[SceneCore] Creating WebGLRenderer with canvas:', {
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

  // ============================================
  // Resize
  // ============================================

  resize(width: number, height: number): void {
    this.renderer.setSize(width, height);
    this.postProcessing?.resize(width, height);
  }

  // ============================================
  // HMR Support
  // ============================================

  reattach(canvas: HTMLCanvasElement): void {
    console.log('[SceneCore] Reattaching to new canvas:', {
      isConnected: canvas.isConnected,
      parentElement: !!canvas.parentElement,
    });
    this.canvas = canvas;
    this.postProcessing?.dispose();
    this.renderer.dispose();
    this.renderer = this.createRenderer();
    // Re-initialize post-processing with new renderer
    if (this.camera) {
      this.postProcessing = new PostProcessing(this.renderer, this.scene, this.camera);
    }
  }

  /**
   * Update camera reference for post-processing.
   */
  updateCamera(camera: THREE.Camera): void {
    this.camera = camera;
    this.postProcessing?.updateCamera(camera);
  }

  // ============================================
  // Cleanup
  // ============================================

  dispose(): void {
    // Dispose post-processing first
    this.postProcessing?.dispose();
    this.postProcessing = null;

    // Force WebGL context loss BEFORE renderer dispose
    try {
      const gl = this.renderer.getContext();
      const loseContext = gl.getExtension('WEBGL_lose_context');
      if (loseContext) {
        console.log('[SceneCore] Forcing WebGL context loss to release GPU memory');
        loseContext.loseContext();
      }
    } catch {
      console.log('[SceneCore] WebGL context already lost or unavailable');
    }

    this.scene.clear();
    this.renderer.dispose();

    // Null references for GC
    // @ts-expect-error - nulling for GC
    this.scene = null;
    // @ts-expect-error - nulling for GC
    this.renderer = null;
  }
}
