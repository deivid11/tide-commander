import * as THREE from 'three';
import type { Agent, CustomAgentClass, BuiltInAgentClass } from '../../../shared/types';
import { AGENT_CLASS_CONFIG, AGENT_CLASS_MODELS } from '../config';
import { CharacterLoader } from './CharacterLoader';

const DEFAULT_CUSTOM_CLASS_MODEL = 'character-male-a.glb';

/**
 * Agent mesh data including animations.
 */
export interface AgentMeshData {
  group: THREE.Group;
  mixer: THREE.AnimationMixer | null;
  animations: Map<string, THREE.AnimationClip>;
  currentAction: THREE.AnimationAction | null;
}

export interface ModelInfo {
  file: string;
  isCustomModel: boolean;
  customClassId?: string;
  scale?: number;
  offset?: { x: number; y: number; z: number };
}

/**
 * Handles 3D model resolution, body creation, model upgrades, and disposal.
 */
export class ModelLoader {
  private customClasses: Map<string, CustomAgentClass> = new Map();

  constructor(private characterLoader: CharacterLoader) {}

  setCustomClasses(classes: Map<string, CustomAgentClass>): void {
    this.customClasses = classes;
  }

  /**
   * Get class config (icon, color) for an agent class (built-in or custom).
   */
  getClassConfig(agentClass: string): { icon: string; color: number; description: string } {
    const builtIn = AGENT_CLASS_CONFIG[agentClass as BuiltInAgentClass];
    if (builtIn) return builtIn;

    const custom = this.customClasses.get(agentClass);
    if (custom) {
      const colorNum = parseInt(custom.color.replace('#', ''), 16);
      return {
        icon: custom.icon,
        color: isNaN(colorNum) ? 0x888888 : colorNum,
        description: custom.description,
      };
    }

    return { icon: '❓', color: 0x888888, description: 'Unknown class' };
  }

  /**
   * Get the model file and metadata for an agent class (built-in or custom).
   */
  getModelInfo(agentClass: string): ModelInfo {
    const builtIn = AGENT_CLASS_MODELS[agentClass as keyof typeof AGENT_CLASS_MODELS];
    if (builtIn) return { file: builtIn, isCustomModel: false };

    const custom = this.customClasses.get(agentClass);
    if (custom) {
      if (custom.customModelPath) {
        return {
          file: custom.customModelPath,
          isCustomModel: true,
          customClassId: custom.id,
          scale: custom.modelScale,
          offset: custom.modelOffset,
        };
      }
      if (custom.model) {
        return { file: custom.model, isCustomModel: false, scale: custom.modelScale, offset: custom.modelOffset };
      }
    }

    return { file: DEFAULT_CUSTOM_CLASS_MODEL, isCustomModel: false };
  }

  /**
   * Create the character body - either loaded model or fallback capsule.
   */
  createCharacterBody(
    agent: Agent,
    fallbackColor: number
  ): {
    body: THREE.Object3D;
    mixer: THREE.AnimationMixer | null;
    animations: Map<string, THREE.AnimationClip>;
  } {
    const modelInfo = this.getModelInfo(agent.class);

    let cloneResult: { mesh: THREE.Group; animations: THREE.AnimationClip[] } | null = null;

    if (modelInfo.isCustomModel && modelInfo.customClassId) {
      cloneResult = this.characterLoader.cloneCustomModel(modelInfo.customClassId);
    }

    if (!cloneResult) {
      cloneResult = this.characterLoader.cloneByModelFile(modelInfo.file);
    }

    if (cloneResult) {
      cloneResult.mesh.name = 'characterBody';

      const customModelScale = modelInfo.scale ?? 1.0;
      cloneResult.mesh.userData.customModelScale = customModelScale;
      cloneResult.mesh.userData.isCustomModel = modelInfo.isCustomModel;

      if (modelInfo.offset && (modelInfo.offset.x !== 0 || modelInfo.offset.y !== 0 || modelInfo.offset.z !== 0)) {
        cloneResult.mesh.position.set(modelInfo.offset.x, modelInfo.offset.z, modelInfo.offset.y);
      }

      const customClass = this.customClasses.get(agent.class);
      if (customClass?.animationMapping) {
        cloneResult.mesh.userData.animationMapping = customClass.animationMapping;
      }

      const mixer = new THREE.AnimationMixer(cloneResult.mesh);
      const animations = new Map<string, THREE.AnimationClip>();
      for (const clip of cloneResult.animations) {
        const normalizedName = clip.name.toLowerCase();
        animations.set(normalizedName, clip);
        animations.set(clip.name, clip);
      }

      return { body: cloneResult.mesh, mixer, animations };
    }

    // Fallback to capsule if model not loaded
    const geometry = new THREE.CapsuleGeometry(0.5, 1.0, 4, 16);
    const material = new THREE.MeshStandardMaterial({
      color: fallbackColor,
      roughness: 0.4,
      metalness: 0.3,
    });

    const body = new THREE.Mesh(geometry, material);
    body.position.y = 1.0;
    body.castShadow = true;
    body.receiveShadow = true;
    body.name = 'characterBody';

    return { body, mixer: null, animations: new Map() };
  }

  /**
   * Calculate the height of the model for UI positioning.
   * The real position update happens in AgentManager.addAgentInternal().
   */
  calculateModelHeight(_body: THREE.Object3D, isBoss: boolean): number {
    return isBoss ? 2.0 : 1.5;
  }

  /**
   * Upgrade an agent's capsule body to a character model.
   * Returns the new AgentMeshData if upgrade was performed, null otherwise.
   */
  upgradeToCharacterModel(group: THREE.Group, agent: Agent): AgentMeshData | null {
    const existingBody = group.getObjectByName('characterBody');

    if (!(existingBody instanceof THREE.Mesh)) return null;
    if (!(existingBody.geometry instanceof THREE.CapsuleGeometry)) return null;

    const cloneResult = this.characterLoader.clone(agent.class);
    if (!cloneResult) return null;

    group.remove(existingBody);
    existingBody.geometry.dispose();
    (existingBody.material as THREE.Material).dispose();

    cloneResult.mesh.name = 'characterBody';
    group.add(cloneResult.mesh);

    const mixer = new THREE.AnimationMixer(cloneResult.mesh);
    const animations = new Map<string, THREE.AnimationClip>();
    for (const clip of cloneResult.animations) {
      const normalizedName = clip.name.toLowerCase();
      animations.set(normalizedName, clip);
    }

    return { group, mixer, animations, currentAction: null };
  }

  /**
   * Replace an agent's 3D model when its class changes.
   * Returns updated AgentMeshData if model was replaced, null otherwise.
   */
  replaceAgentModel(meshData: AgentMeshData, agent: Agent): AgentMeshData | null {
    const { group } = meshData;
    const modelInfo = this.getModelInfo(agent.class);

    let cloneResult: { mesh: THREE.Group; animations: THREE.AnimationClip[] } | null = null;

    if (modelInfo.isCustomModel && modelInfo.customClassId) {
      cloneResult = this.characterLoader.cloneCustomModel(modelInfo.customClassId);
    }

    if (!cloneResult) {
      cloneResult = this.characterLoader.cloneByModelFile(modelInfo.file);
    }

    if (!cloneResult) {
      console.warn(`[ModelLoader] Could not load model for class ${agent.class}, keeping current model`);
      group.userData.agentClass = agent.class;
      return null;
    }

    // Remove and dispose old body
    const oldBody = group.getObjectByName('characterBody');
    if (oldBody) {
      group.remove(oldBody);
      oldBody.traverse((child) => {
        if (child instanceof THREE.Mesh || child instanceof THREE.SkinnedMesh) {
          child.geometry?.dispose();
          if (Array.isArray(child.material)) {
            child.material.forEach(mat => this.disposeMaterial(mat));
          } else if (child.material) {
            this.disposeMaterial(child.material);
          }
        }
      });
    }

    // Stop old mixer
    if (meshData.mixer) {
      meshData.mixer.stopAllAction();
      meshData.mixer.uncacheRoot(group);
    }

    // Add new character body
    cloneResult.mesh.name = 'characterBody';
    const customModelScale = modelInfo.scale ?? 1.0;
    cloneResult.mesh.userData.customModelScale = customModelScale;
    cloneResult.mesh.userData.isCustomModel = modelInfo.isCustomModel;

    if (modelInfo.offset && (modelInfo.offset.x !== 0 || modelInfo.offset.y !== 0 || modelInfo.offset.z !== 0)) {
      cloneResult.mesh.position.set(modelInfo.offset.x, modelInfo.offset.z, modelInfo.offset.y);
    }

    const customClass = this.customClasses.get(agent.class);
    if (customClass?.animationMapping) {
      cloneResult.mesh.userData.animationMapping = customClass.animationMapping;
    }

    group.add(cloneResult.mesh);

    // Create new mixer and animations
    const mixer = new THREE.AnimationMixer(cloneResult.mesh);
    const animations = new Map<string, THREE.AnimationClip>();
    for (const clip of cloneResult.animations) {
      const normalizedName = clip.name.toLowerCase();
      animations.set(normalizedName, clip);
      animations.set(clip.name, clip);
    }

    group.userData.agentClass = agent.class;

    console.log(`[ModelLoader] Agent ${agent.name} model updated to ${modelInfo.file}`);

    return { group, mixer, animations, currentAction: null };
  }

  /**
   * Dispose of an agent mesh and all its resources.
   */
  disposeAgentMesh(meshData: AgentMeshData): void {
    if (meshData.mixer) {
      meshData.mixer.stopAllAction();
      meshData.mixer.uncacheRoot(meshData.group);
    }

    meshData.group.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.geometry?.dispose();
        if (Array.isArray(child.material)) {
          child.material.forEach(mat => this.disposeMaterial(mat));
        } else if (child.material) {
          this.disposeMaterial(child.material);
        }
      } else if (child instanceof THREE.Sprite) {
        this.disposeMaterial(child.material);
      } else if (child instanceof THREE.SkinnedMesh) {
        child.geometry?.dispose();
        if (Array.isArray(child.material)) {
          child.material.forEach(mat => this.disposeMaterial(mat));
        } else if (child.material) {
          this.disposeMaterial(child.material);
        }
      }
    });

    while (meshData.group.children.length > 0) {
      meshData.group.remove(meshData.group.children[0]);
    }

    meshData.animations.clear();
  }

  /**
   * Dispose a material and its textures.
   */
  disposeMaterial(material: THREE.Material): void {
    if (material instanceof THREE.MeshStandardMaterial ||
        material instanceof THREE.MeshBasicMaterial ||
        material instanceof THREE.SpriteMaterial) {
      material.map?.dispose();
      if ('normalMap' in material) material.normalMap?.dispose();
      if ('roughnessMap' in material) material.roughnessMap?.dispose();
      if ('metalnessMap' in material) material.metalnessMap?.dispose();
      if ('emissiveMap' in material) material.emissiveMap?.dispose();
    }
    material.dispose();
  }
}

// HMR
if (import.meta.hot) {
  import.meta.hot.accept(() => {
    console.log('[Tide HMR] ModelLoader updated - pending refresh available');
    window.__tideHmrPendingSceneChanges = true;
  });
}
