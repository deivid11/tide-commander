import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';

/**
 * Custom color correction shader with saturation, contrast, and brightness controls.
 */
const ColorCorrectionShader = {
  name: 'ColorCorrectionShader',
  uniforms: {
    tDiffuse: { value: null },
    saturation: { value: 1.0 },
    contrast: { value: 1.0 },
    brightness: { value: 0.0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float saturation;
    uniform float contrast;
    uniform float brightness;
    varying vec2 vUv;

    void main() {
      vec4 color = texture2D(tDiffuse, vUv);

      // Convert to grayscale using luminance weights
      float luminance = dot(color.rgb, vec3(0.299, 0.587, 0.114));

      // Apply saturation (lerp between grayscale and original)
      vec3 saturated = mix(vec3(luminance), color.rgb, saturation);

      // Apply contrast (centered around 0.5)
      vec3 contrasted = (saturated - 0.5) * contrast + 0.5;

      // Apply brightness offset
      vec3 final = contrasted + brightness;

      gl_FragColor = vec4(clamp(final, 0.0, 1.0), color.a);
    }
  `,
};

/**
 * Manages post-processing effects for the scene.
 * Currently supports saturation, contrast, and brightness adjustments.
 */
export class PostProcessing {
  private composer: EffectComposer;
  private colorPass: ShaderPass;
  private enabled = false; // Disabled by default - agent style is applied per-material

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) {
    this.composer = new EffectComposer(renderer);

    // Render pass - renders the scene normally
    const renderPass = new RenderPass(scene, camera);
    this.composer.addPass(renderPass);

    // Color correction pass
    this.colorPass = new ShaderPass(ColorCorrectionShader);
    this.composer.addPass(this.colorPass);
  }

  /**
   * Set saturation level.
   * @param value 0 = grayscale, 1 = normal, 2 = highly saturated
   */
  setSaturation(value: number): void {
    this.colorPass.uniforms.saturation.value = value;
  }

  /**
   * Set contrast level.
   * @param value 0.5 = low contrast, 1 = normal, 1.5 = high contrast
   */
  setContrast(value: number): void {
    this.colorPass.uniforms.contrast.value = value;
  }

  /**
   * Set brightness offset.
   * @param value -0.5 = darker, 0 = normal, 0.5 = brighter
   */
  setBrightness(value: number): void {
    this.colorPass.uniforms.brightness.value = value;
  }

  /**
   * Get current saturation value.
   */
  getSaturation(): number {
    return this.colorPass.uniforms.saturation.value;
  }

  /**
   * Enable or disable post-processing.
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  /**
   * Check if post-processing is enabled.
   */
  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Update camera reference (needed after camera changes).
   */
  updateCamera(camera: THREE.Camera): void {
    const renderPass = this.composer.passes[0] as RenderPass;
    renderPass.camera = camera;
  }

  /**
   * Resize the composer to match new dimensions.
   */
  resize(width: number, height: number): void {
    this.composer.setSize(width, height);
  }

  /**
   * Render the scene with post-processing effects.
   */
  render(): void {
    if (this.enabled) {
      this.composer.render();
    }
  }

  /**
   * Get the composer for direct rendering when post-processing is disabled.
   */
  getComposer(): EffectComposer {
    return this.composer;
  }

  /**
   * Clean up resources.
   */
  dispose(): void {
    this.composer.dispose();
  }
}
