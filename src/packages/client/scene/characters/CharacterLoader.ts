import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { AgentClass } from '../../../shared/types';
import { AGENT_CLASS_MODELS, ALL_CHARACTER_MODELS } from '../config';
import { apiUrl } from '../../utils/storage';

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
  private customModels = new Map<string, CachedModel>(); // Custom models keyed by classId
  private loaded = false;
  private loadingPromise: Promise<void> | null = null;
  private loader: GLTFLoader;
  private dracoLoader: DRACOLoader;
  private loadingCustomModels = new Map<string, Promise<void>>(); // Track in-flight custom model loads

  constructor() {
    this.loader = new GLTFLoader();
    // Configure DRACOLoader for Draco-compressed models
    this.dracoLoader = new DRACOLoader();
    this.dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.7/');
    this.loader.setDRACOLoader(this.dracoLoader);
    // Configure MeshoptDecoder for meshopt-compressed models
    this.loader.setMeshoptDecoder(MeshoptDecoder);
  }

  get isLoaded(): boolean {
    return this.loaded;
  }

  /**
   * Load all character models defined in config.
   * Safe to call multiple times - will return cached promise.
   */
  async loadAll(): Promise<void> {
    if (this.loaded) {
      console.log('[CharacterLoader] Already loaded, skipping');
      return;
    }
    if (this.loadingPromise) {
      console.log('[CharacterLoader] Already loading, waiting for existing promise');
      return this.loadingPromise;
    }

    // Load all available character models (not just built-in class models)
    // This ensures custom classes can use any model
    const modelNames = [...new Set([
      ...Object.values(AGENT_CLASS_MODELS),
      ...ALL_CHARACTER_MODELS.map(m => m.file),
    ])];

    console.log(`[CharacterLoader] Starting to load ${modelNames.length} models`);

    this.loadingPromise = Promise.all(
      modelNames.map((name) => this.loadModel(name))
    ).then(() => {
      this.loaded = true;
      console.log(`[CharacterLoader] All models loaded. Cache size: ${this.models.size}`);
    });

    return this.loadingPromise;
  }

  /**
   * Load a single model by filename.
   */
  private loadModel(modelName: string): Promise<void> {
    return new Promise((resolve) => {
      const assetUrl = `/assets/characters/${modelName}`;
      console.log(`[CharacterLoader] Loading model: ${assetUrl}`);
      this.loader.load(
        assetUrl,
        (gltf: GLTF) => {
          console.log(`[CharacterLoader] Successfully loaded: ${modelName}`);
          const scene = this.prepareModel(gltf.scene);
          this.models.set(modelName, {
            scene,
            animations: gltf.animations,
          });
          resolve();
        },
        (_progress) => {
          // Progress callback
        },
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
          // Preserve original material colors with subtle environment lighting
          if (mat.isMeshStandardMaterial) {
            // Keep original roughness (or default to slightly rough for natural look)
            mat.roughness = mat.roughness ?? 0.6;
            // Preserve original metalness (most character models should be non-metallic)
            mat.metalness = mat.metalness ?? 0.0;
            // Subtle environment map intensity to preserve base color
            mat.envMapIntensity = 0.8;
            // Ensure material updates
            mat.needsUpdate = true;
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

  /**
   * Load a custom model from the server by class ID.
   * Custom models are stored separately from built-in models.
   *
   * @param classId - The custom class ID
   * @returns Promise that resolves when loaded
   */
  async loadCustomModel(classId: string): Promise<void> {
    // Already loaded?
    if (this.customModels.has(classId)) return;

    // Already loading?
    const existingPromise = this.loadingCustomModels.get(classId);
    if (existingPromise) return existingPromise;

    const loadPromise = new Promise<void>((resolve) => {
      this.loader.load(
        apiUrl(`/api/custom-models/${classId}`),
        (gltf: GLTF) => {
          const scene = this.prepareModel(gltf.scene);
          this.customModels.set(classId, {
            scene,
            animations: gltf.animations,
          });
          console.log(`[CharacterLoader] Loaded custom model for class: ${classId} (${gltf.animations.length} animations)`);
          resolve();
        },
        undefined,
        (error) => {
          console.error(`[CharacterLoader] Failed to load custom model for ${classId}:`, error);
          resolve(); // Don't reject - allow fallback to default model
        }
      );
    });

    this.loadingCustomModels.set(classId, loadPromise);

    try {
      await loadPromise;
    } finally {
      this.loadingCustomModels.delete(classId);
    }
  }

  /**
   * Check if a custom model is loaded for a class.
   */
  hasCustomModel(classId: string): boolean {
    return this.customModels.has(classId);
  }

  /**
   * Clone a custom model by class ID.
   * Returns null if the custom model isn't loaded.
   */
  cloneCustomModel(classId: string): { mesh: THREE.Group; animations: THREE.AnimationClip[] } | null {
    const cached = this.customModels.get(classId);

    if (!cached) {
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
      animations: cached.animations,
    };
  }

  /**
   * Get animations for a custom model by class ID.
   */
  getCustomModelAnimations(classId: string): THREE.AnimationClip[] | null {
    const cached = this.customModels.get(classId);
    return cached?.animations ?? null;
  }

  /**
   * Unload a custom model to free memory.
   */
  unloadCustomModel(classId: string): void {
    const cached = this.customModels.get(classId);
    if (cached) {
      this.disposeCachedModel(cached);
      this.customModels.delete(classId);
      console.log(`[CharacterLoader] Unloaded custom model for class: ${classId}`);
    }
  }

  /**
   * Dispose of a cached model's resources (geometries, materials, textures).
   */
  private disposeCachedModel(cached: CachedModel): void {
    cached.scene.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.geometry?.dispose();
        if (Array.isArray(child.material)) {
          child.material.forEach(m => this.disposeMaterial(m));
        } else if (child.material) {
          this.disposeMaterial(child.material);
        }
      }
    });
  }

  /**
   * Dispose a material and all its textures.
   */
  private disposeMaterial(material: THREE.Material): void {
    if (material instanceof THREE.MeshStandardMaterial ||
        material instanceof THREE.MeshBasicMaterial ||
        material instanceof THREE.MeshPhongMaterial) {
      material.map?.dispose();
      if ('normalMap' in material) material.normalMap?.dispose();
      if ('roughnessMap' in material) material.roughnessMap?.dispose();
      if ('metalnessMap' in material) material.metalnessMap?.dispose();
      if ('emissiveMap' in material) material.emissiveMap?.dispose();
      if ('aoMap' in material) material.aoMap?.dispose();
      if ('lightMap' in material) material.lightMap?.dispose();
      if ('bumpMap' in material) material.bumpMap?.dispose();
      if ('displacementMap' in material) material.displacementMap?.dispose();
      if ('alphaMap' in material) material.alphaMap?.dispose();
      if ('envMap' in material) material.envMap?.dispose();
    }
    material.dispose();
  }

  /**
   * Dispose all cached models and resources.
   * Call this on page unload to prevent memory leaks.
   */
  dispose(): void {
    // Dispose built-in model templates
    for (const [name, cached] of this.models) {
      this.disposeCachedModel(cached);
      console.log(`[CharacterLoader] Disposed model template: ${name}`);
    }
    this.models.clear();

    // Dispose custom model templates
    for (const [classId, cached] of this.customModels) {
      this.disposeCachedModel(cached);
      console.log(`[CharacterLoader] Disposed custom model: ${classId}`);
    }
    this.customModels.clear();

    // Dispose DRACOLoader
    this.dracoLoader.dispose();

    // Reset state
    this.loaded = false;
    this.loadingPromise = null;
    this.loadingCustomModels.clear();

    console.log('[CharacterLoader] All model caches disposed');
  }

  /**
   * Get cache statistics for debugging memory issues.
   */
  getCacheStats(): {
    builtInModels: number;
    customModels: number;
    modelNames: string[];
    customModelIds: string[];
  } {
    return {
      builtInModels: this.models.size,
      customModels: this.customModels.size,
      modelNames: Array.from(this.models.keys()),
      customModelIds: Array.from(this.customModels.keys()),
    };
  }
}
