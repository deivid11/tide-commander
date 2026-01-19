import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { AgentClass } from '../../../shared/types';
import { AGENT_CLASS_MODELS, ALL_CHARACTER_MODELS } from '../config';

/**
 * Cached model data including mesh and animations.
 */
interface CachedModel {
  scene: THREE.Group;
  animations: THREE.AnimationClip[];
}

/**
 * Handles loading and caching of character GLTF models.
 * Provides cloning functionality for creating agent instances.
 */
export class CharacterLoader {
  private models = new Map<string, CachedModel>();
  private loaded = false;
  private loadingPromise: Promise<void> | null = null;
  private loader = new GLTFLoader();

  get isLoaded(): boolean {
    return this.loaded;
  }

  /**
   * Load all character models defined in config.
   * Safe to call multiple times - will return cached promise.
   */
  async loadAll(): Promise<void> {
    if (this.loaded) return;
    if (this.loadingPromise) return this.loadingPromise;

    // Load all available character models (not just built-in class models)
    // This ensures custom classes can use any model
    const modelNames = [...new Set([
      ...Object.values(AGENT_CLASS_MODELS),
      ...ALL_CHARACTER_MODELS.map(m => m.file),
    ])];
    console.log('[CharacterLoader] Loading models...', modelNames);

    this.loadingPromise = Promise.all(
      modelNames.map((name) => this.loadModel(name))
    ).then(() => {
      this.loaded = true;
      console.log('[CharacterLoader] All models loaded:', this.models.size);
    });

    return this.loadingPromise;
  }

  /**
   * Load a single model by filename.
   */
  private loadModel(modelName: string): Promise<void> {
    return new Promise((resolve) => {
      this.loader.load(
        `/assets/characters/${modelName}`,
        (gltf: GLTF) => {
          const scene = this.prepareModel(gltf.scene);
          this.models.set(modelName, {
            scene,
            animations: gltf.animations,
          });
          console.log(
            `[CharacterLoader] Loaded: ${modelName} with ${gltf.animations.length} animations`
          );
          resolve();
        },
        undefined,
        (error) => {
          console.error(`[CharacterLoader] Failed to load ${modelName}:`, error);
          resolve(); // Don't reject - continue with other models
        }
      );
    });
  }

  /**
   * Prepare a loaded model as a template (hidden, shadows enabled, etc.)
   */
  private prepareModel(model: THREE.Group): THREE.Group {
    model.scale.setScalar(1.0);
    model.position.set(0, 0, 0);
    model.rotation.set(0, 0, 0);
    model.visible = false; // Template should never be rendered directly

    model.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.castShadow = true;
        child.receiveShadow = true;

        if (child.material) {
          const mat = child.material as THREE.MeshStandardMaterial;
          if (mat.map) {
            mat.map.colorSpace = THREE.SRGBColorSpace;
          }
        }
      }
    });

    return model;
  }

  /**
   * Clone result including mesh and animations by agent class.
   * For built-in classes only - use cloneByModelFile for custom classes.
   */
  clone(agentClass: AgentClass): { mesh: THREE.Group; animations: THREE.AnimationClip[] } | null {
    const modelName = AGENT_CLASS_MODELS[agentClass];
    return this.cloneByModelFile(modelName);
  }

  /**
   * Clone result including mesh and animations by model filename.
   * Use this for custom agent classes that specify their own model file.
   */
  cloneByModelFile(modelFile: string): { mesh: THREE.Group; animations: THREE.AnimationClip[] } | null {
    const cached = this.models.get(modelFile);

    if (!cached) {
      console.warn(`[CharacterLoader] Model not found: ${modelFile}`);
      return null;
    }

    // Use SkeletonUtils for proper cloning of skinned meshes
    const mesh = SkeletonUtils.clone(cached.scene) as THREE.Group;

    // Make clone visible and reset transforms
    mesh.visible = true;
    mesh.position.set(0, 0, 0);
    mesh.rotation.set(0, 0, 0);

    // Clone materials for independent control
    mesh.traverse((child) => {
      child.visible = true;
      if (child instanceof THREE.Mesh && child.material) {
        if (Array.isArray(child.material)) {
          child.material = child.material.map((m) => m.clone());
        } else {
          child.material = child.material.clone();
        }
      }
    });

    return {
      mesh,
      animations: cached.animations, // Animations can be shared
    };
  }

  /**
   * Get animations for an agent class (without cloning mesh).
   */
  getAnimations(agentClass: AgentClass): THREE.AnimationClip[] | null {
    const modelName = AGENT_CLASS_MODELS[agentClass];
    const cached = this.models.get(modelName);
    return cached?.animations ?? null;
  }

  /**
   * Check if a specific model is available.
   */
  hasModel(agentClass: AgentClass): boolean {
    const modelName = AGENT_CLASS_MODELS[agentClass];
    return this.models.has(modelName);
  }
}
