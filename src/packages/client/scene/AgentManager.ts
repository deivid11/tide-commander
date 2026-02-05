import * as THREE from 'three';
import type { Agent, CustomAgentClass, AnimationMapping } from '../../shared/types';
import { store } from '../store';
import { CharacterLoader, CharacterFactory, type AgentMeshData } from './characters';
import { MovementAnimator, EffectsManager, ANIMATIONS } from './animation';
import { ProceduralAnimator, type ProceduralAnimationState } from './animation/ProceduralAnimator';

/**
 * Manages agent lifecycle: adding, removing, updating, and syncing agents.
 * Extracted from SceneManager for separation of concerns.
 */
export class AgentManager {
  private scene: THREE.Scene;
  private characterLoader: CharacterLoader;
  private characterFactory: CharacterFactory;
  private movementAnimator: MovementAnimator;
  private proceduralAnimator: ProceduralAnimator;
  private effectsManager: EffectsManager;

  // State
  private agentMeshes = new Map<string, AgentMeshData>();
  private pendingAgents: Agent[] = [];
  private modelsReady = false;
  private characterScale = 0.5;
  private brightness = 1;
  private idleAnimation: string = ANIMATIONS.SIT;
  private workingAnimation: string = ANIMATIONS.WALK;
  private previousAgentStatuses = new Map<string, string>(); // Track previous status for each agent

  // Agent model style settings
  private modelStyle = {
    saturation: 1.0,      // 0 = grayscale, 1 = normal, 2 = vivid
    roughness: -1,        // -1 = use original, 0-1 = override
    metalness: -1,        // -1 = use original, 0-1 = override
    emissiveBoost: 0,     // 0 = normal, positive = add glow
    envMapIntensity: -1,  // -1 = use original, 0-2 = override
    wireframe: false,     // true = wireframe rendering mode
    colorMode: 'normal' as string, // normal, bw, sepia, cool, warm, neon
  };

  // Callbacks for external updates
  private onAgentMeshesChanged: (() => void) | null = null;
  private onProceduralCacheInvalidated: (() => void) | null = null;

  constructor(
    scene: THREE.Scene,
    characterLoader: CharacterLoader,
    characterFactory: CharacterFactory,
    movementAnimator: MovementAnimator,
    proceduralAnimator: ProceduralAnimator,
    effectsManager: EffectsManager
  ) {
    this.scene = scene;
    this.characterLoader = characterLoader;
    this.characterFactory = characterFactory;
    this.movementAnimator = movementAnimator;
    this.proceduralAnimator = proceduralAnimator;
    this.effectsManager = effectsManager;
  }

  // ============================================
  // Callbacks
  // ============================================

  setOnAgentMeshesChanged(callback: () => void): void {
    this.onAgentMeshesChanged = callback;
  }

  setOnProceduralCacheInvalidated(callback: () => void): void {
    this.onProceduralCacheInvalidated = callback;
  }

  // ============================================
  // Getters
  // ============================================

  getAgentMeshes(): Map<string, AgentMeshData> {
    return this.agentMeshes;
  }

  isModelsReady(): boolean {
    return this.modelsReady;
  }

  // ============================================
  // Configuration
  // ============================================

  setCharacterScale(scale: number): void {
    this.characterScale = scale;
    for (const meshData of this.agentMeshes.values()) {
      const body = meshData.group.getObjectByName('characterBody');
      if (body) {
        const customModelScale = body.userData.customModelScale ?? 1.0;
        const isBoss = meshData.group.userData.isBoss === true;
        const bossMultiplier = isBoss ? 1.5 : 1.0;
        body.scale.setScalar(customModelScale * scale * bossMultiplier);

        // Update status bar position based on new model height
        const statusBar = meshData.group.getObjectByName('statusBar') as THREE.Sprite;
        if (statusBar) {
          // Box3.setFromObject already accounts for the object's current scale
          const box = new THREE.Box3().setFromObject(body);
          const modelTop = box.max.y;
          const padding = isBoss ? 0.2 : 0.3;
          // Cap the height to prevent mana bar going too high
          const maxHeight = isBoss ? 3.0 : 2.2;
          statusBar.position.y = Math.min(Math.max(modelTop, 1.0) + padding, maxHeight);
        }
      }
    }
  }

  /**
   * Set brightness multiplier for agent materials.
   * Affects MeshBasicMaterial (custom models) by adjusting color intensity.
   */
  setBrightness(brightness: number): void {
    this.brightness = brightness;
    for (const meshData of this.agentMeshes.values()) {
      this.applyStyleToMesh(meshData.group);
    }
  }

  /**
   * Set agent model style settings.
   * @param style Partial style config to merge with current settings
   */
  setModelStyle(style: Partial<typeof this.modelStyle>): void {
    Object.assign(this.modelStyle, style);
    for (const meshData of this.agentMeshes.values()) {
      this.applyStyleToMesh(meshData.group);
    }
  }

  /**
   * Get current model style settings.
   */
  getModelStyle(): typeof this.modelStyle {
    return { ...this.modelStyle };
  }

  // Color mode index mapping
  private static readonly COLOR_MODE_INDEX: Record<string, number> = {
    normal: 0,
    bw: 1,
    sepia: 2,
    cool: 3,
    warm: 4,
    neon: 5,
  };

  /**
   * Inject color effects into a material's shader.
   * This modifies the fragment shader to apply saturation and color modes after texture sampling.
   * Only affects the specific material, not the whole scene.
   */
  private injectColorShader(mat: THREE.Material): void {
    const saturation = this.modelStyle.saturation;
    const colorModeIndex = AgentManager.COLOR_MODE_INDEX[this.modelStyle.colorMode] ?? 0;

    // Mark that this material has color shader injection
    if (!mat.userData.hasColorShader) {
      mat.userData.hasColorShader = true;

      // Store reference to this AgentManager for the closure
      const self = this;

      mat.onBeforeCompile = (shader) => {
        // Add uniforms - read from current modelStyle, not captured value
        shader.uniforms.uSaturation = { value: self.modelStyle.saturation };
        shader.uniforms.uColorMode = { value: AgentManager.COLOR_MODE_INDEX[self.modelStyle.colorMode] ?? 0 };

        // Inject color functions into fragment shader
        shader.fragmentShader = shader.fragmentShader.replace(
          '#include <common>',
          `#include <common>
          uniform float uSaturation;
          uniform int uColorMode;

          vec3 applySaturation(vec3 color, float sat) {
            float luma = dot(color, vec3(0.299, 0.587, 0.114));
            return clamp(mix(vec3(luma), color, sat), 0.0, 1.0);
          }

          vec3 applyColorMode(vec3 color, int mode) {
            if (mode == 1) {
              // B&W - grayscale
              float gray = dot(color, vec3(0.299, 0.587, 0.114));
              return vec3(gray);
            } else if (mode == 2) {
              // Sepia
              float gray = dot(color, vec3(0.299, 0.587, 0.114));
              return vec3(gray * 1.2, gray * 1.0, gray * 0.8);
            } else if (mode == 3) {
              // Cool - blue tint
              return vec3(color.r * 0.9, color.g * 0.95, color.b * 1.1);
            } else if (mode == 4) {
              // Warm - orange/yellow tint
              return vec3(color.r * 1.1, color.g * 1.0, color.b * 0.85);
            } else if (mode == 5) {
              // Neon - high contrast, vibrant
              vec3 boosted = pow(color, vec3(0.8));
              return clamp(boosted * 1.3, 0.0, 1.0);
            }
            // Normal - no change
            return color;
          }`
        );

        // Apply color effects to final color (before tonemapping)
        shader.fragmentShader = shader.fragmentShader.replace(
          '#include <tonemapping_fragment>',
          `gl_FragColor.rgb = applySaturation(gl_FragColor.rgb, uSaturation);
          gl_FragColor.rgb = applyColorMode(gl_FragColor.rgb, uColorMode);
          #include <tonemapping_fragment>`
        );

        // Store shader reference for uniform updates
        mat.userData.shader = shader;
      };

      // Force shader recompilation
      mat.needsUpdate = true;
    } else if (mat.userData.shader) {
      // Update existing uniforms
      mat.userData.shader.uniforms.uSaturation.value = saturation;
      mat.userData.shader.uniforms.uColorMode.value = colorModeIndex;
    }
  }

  /**
   * Apply style settings to a mesh group.
   * Handles brightness, saturation, roughness, metalness, emissive boost, and envMapIntensity.
   * For MeshBasicMaterial: adjusts color intensity and saturation.
   * For MeshStandardMaterial/MeshPhysicalMaterial: adjusts all material properties.
   * For SpriteMaterial (name labels, mana bars): adjusts opacity.
   * Custom GLB models get a stronger brightness multiplier.
   */
  private applyStyleToMesh(group: THREE.Group): void {
    // Check if this is a custom model (GLB uploaded by user)
    const characterBody = group.getObjectByName('characterBody');
    const isCustomModel = characterBody?.userData?.isCustomModel === true;

    // Custom models get a stronger brightness effect (2.2x vs 1.4x for built-in models)
    const multiplier = isCustomModel ? 2.2 : 1.4;
    const effectiveBrightness = 1 + (this.brightness - 1) * multiplier;

    group.traverse((child) => {
      if (child instanceof THREE.Mesh && child.material) {
        const materials = Array.isArray(child.material) ? child.material : [child.material];
        for (const mat of materials) {
          // Handle any material with a color property
          if ('color' in mat && mat.color instanceof THREE.Color) {
            // Store original color if not stored yet
            if (!mat.userData.originalColor) {
              mat.userData.originalColor = mat.color.clone();
            }

            // Start with original color
            const original = mat.userData.originalColor as THREE.Color;
            const adjusted = original.clone();

            // Apply color effects via shader injection (works for both textured and non-textured)
            this.injectColorShader(mat);

            // Apply brightness by adjusting the color
            // For custom models, apply more aggressive color darkening
            const colorMultiplier = isCustomModel
              ? Math.min(effectiveBrightness, 1) * 0.55 // Extra 45% darker for custom models
              : Math.min(effectiveBrightness, 1);
            mat.color.copy(adjusted).multiplyScalar(colorMultiplier);
          }

          // For standard/physical materials (common in GLB models like mewtoo.glb)
          if (mat instanceof THREE.MeshStandardMaterial) {
            // Store original values
            if (mat.userData.baseEmissiveIntensity === undefined) {
              mat.userData.baseEmissiveIntensity = mat.emissiveIntensity || 0;
            }
            if (mat.userData.baseEmissive === undefined) {
              mat.userData.baseEmissive = mat.emissive.clone();
            }
            if (mat.userData.baseEnvMapIntensity === undefined) {
              mat.userData.baseEnvMapIntensity = mat.envMapIntensity ?? 1;
            }
            if (mat.userData.baseMetalness === undefined) {
              mat.userData.baseMetalness = mat.metalness ?? 0;
            }
            if (mat.userData.baseRoughness === undefined) {
              mat.userData.baseRoughness = mat.roughness ?? 0.5;
            }

            // Apply emissive boost - if boost > 0, use the base color as emissive color
            if (this.modelStyle.emissiveBoost > 0) {
              // Use the original diffuse color as emissive base for glow effect
              const originalColor = mat.userData.originalColor as THREE.Color | undefined;
              if (originalColor) {
                mat.emissive.copy(originalColor);
              } else {
                mat.emissive.setHex(0xffffff); // Fallback to white glow
              }
              mat.emissiveIntensity = this.modelStyle.emissiveBoost * effectiveBrightness;
            } else {
              // Restore original emissive
              mat.emissive.copy(mat.userData.baseEmissive as THREE.Color);
              mat.emissiveIntensity = (mat.userData.baseEmissiveIntensity as number) * effectiveBrightness;
            }

            // Apply roughness FIRST (override or original)
            if (this.modelStyle.roughness >= 0) {
              mat.roughness = this.modelStyle.roughness;
            } else {
              mat.roughness = mat.userData.baseRoughness as number;
            }

            // Apply metalness (override or brightness-adjusted)
            if (this.modelStyle.metalness >= 0) {
              mat.metalness = this.modelStyle.metalness;
            } else {
              // When darkening significantly, also reduce metalness to make it look darker
              const metalnessThreshold = isCustomModel ? 0.9 : 0.7;
              if (effectiveBrightness < metalnessThreshold) {
                mat.metalness = (mat.userData.baseMetalness as number) * effectiveBrightness;
              } else {
                mat.metalness = mat.userData.baseMetalness as number;
              }
            }

            // Apply envMapIntensity LAST so it can override roughness/metalness for reflections boost
            // Note: envMapIntensity is most visible with low roughness and some metalness
            if (this.modelStyle.envMapIntensity >= 0) {
              mat.envMapIntensity = this.modelStyle.envMapIntensity;
              // Boost effect: if envMapIntensity > 1, force lower roughness and add metalness for visible reflections
              if (this.modelStyle.envMapIntensity > 1) {
                const boostFactor = this.modelStyle.envMapIntensity - 1; // 0 to 1 for values 1 to 2
                // Only override roughness if not explicitly set
                if (this.modelStyle.roughness < 0) {
                  // Aggressively reduce roughness for reflections to show
                  mat.roughness = Math.max(0.05, mat.roughness - boostFactor * 0.5);
                }
                // Only override metalness if not explicitly set
                if (this.modelStyle.metalness < 0) {
                  // Add metalness to make reflections more visible
                  mat.metalness = Math.min(1, mat.metalness + boostFactor * 0.5);
                }
              }
            } else {
              mat.envMapIntensity = (mat.userData.baseEnvMapIntensity as number) * effectiveBrightness;
            }

            // Apply wireframe mode
            mat.wireframe = this.modelStyle.wireframe;

            // Mark material as needing update
            mat.needsUpdate = true;
          }
        }
      }
      // Handle sprites (name labels, mana bars, idle timer, crown)
      if (child instanceof THREE.Sprite) {
        const mat = child.material as THREE.SpriteMaterial;
        // Store original opacity if not stored yet
        if (mat.userData.originalOpacity === undefined) {
          mat.userData.originalOpacity = mat.opacity ?? 1;
        }
        // Apply brightness to opacity (clamped to 0-1)
        mat.opacity = Math.min(1, (mat.userData.originalOpacity as number) * effectiveBrightness);
      }
    });
  }

  setIdleAnimation(animation: string): void {
    this.idleAnimation = animation;
    const state = store.getState();
    for (const [agentId, meshData] of this.agentMeshes) {
      const agent = state.agents.get(agentId);
      if (agent && agent.status === 'idle' && !this.movementAnimator.isMoving(agentId)) {
        this.updateStatusAnimation(agent, meshData);
      }
    }
  }

  setWorkingAnimation(animation: string): void {
    this.workingAnimation = animation;
    const state = store.getState();
    for (const [agentId, meshData] of this.agentMeshes) {
      const agent = state.agents.get(agentId);
      if (agent && agent.status === 'working' && !this.movementAnimator.isMoving(agentId)) {
        this.updateStatusAnimation(agent, meshData);
      }
    }
  }

  setCustomAgentClasses(classes: Map<string, CustomAgentClass>): void {
    this.characterFactory.setCustomClasses(classes);
    for (const customClass of classes.values()) {
      if (customClass.customModelPath) {
        this.characterLoader.loadCustomModel(customClass.id).catch(err => {
          console.warn(`[AgentManager] Failed to preload custom model for class ${customClass.id}:`, err);
        });
      }
    }
  }

  // ============================================
  // Model Loading
  // ============================================

  async loadCharacterModels(): Promise<void> {
    console.log('[AgentManager] loadCharacterModels called, modelsReady:', this.modelsReady);
    await this.characterLoader.loadAll();
    this.modelsReady = true;
    console.log('[AgentManager] Models ready, pending agents:', this.pendingAgents.length);

    if (this.pendingAgents.length > 0) {
      console.log(`[AgentManager] Processing ${this.pendingAgents.length} pending agents`);
      const agents = this.pendingAgents;
      this.pendingAgents = [];
      for (const agent of agents) {
        this.addAgent(agent);
      }
      // After processing pending agents, trigger a callback to ensure the render loop
      // captures the updated agent meshes in the next frame
      this.onAgentMeshesChanged?.();
    }
  }

  upgradeAgentModels(): void {
    if (!this.characterLoader.isLoaded) return;

    const state = store.getState();
    const customClasses = state.customAgentClasses;

    for (const [agentId, meshData] of this.agentMeshes) {
      const agent = state.agents.get(agentId);
      if (!agent) continue;

      const body = meshData.group.getObjectByName('characterBody');
      const isCapsule = body instanceof THREE.Mesh && body.geometry instanceof THREE.CapsuleGeometry;
      const hasCustomClass = customClasses.has(agent.class);
      const needsUpgrade = isCapsule || hasCustomClass;

      if (needsUpgrade) {
        const currentPosition = meshData.group.position.clone();
        const newMeshData = this.characterFactory.createAgentMesh(agent);
        newMeshData.group.position.copy(currentPosition);

        const newBody = newMeshData.group.getObjectByName('characterBody');
        if (newBody) {
          const customModelScale = newBody.userData.customModelScale ?? 1.0;
          const bossMultiplier = (agent.isBoss || agent.class === 'boss') ? 1.5 : 1.0;
          newBody.scale.setScalar(customModelScale * this.characterScale * bossMultiplier);

          this.proceduralAnimator.unregister(agentId);
          if (newMeshData.animations.size === 0) {
            const proceduralState = this.getProceduralStateForStatus(agent.status);
            this.proceduralAnimator.register(agentId, newBody, proceduralState);
          }
        }

        this.scene.remove(meshData.group);
        this.characterFactory.disposeAgentMesh(meshData);
        this.scene.add(newMeshData.group);
        this.agentMeshes.set(agentId, newMeshData);

        // Apply current brightness to upgraded agent's materials
        this.applyStyleToMesh(newMeshData.group);

        this.updateStatusAnimation(agent, newMeshData);
      }
    }

    this.onAgentMeshesChanged?.();
  }

  // ============================================
  // Agent CRUD
  // ============================================

  addAgent(agent: Agent): void {
    // Don't add agents that are in archived areas
    if (store.isAgentInArchivedArea(agent.id)) {
      return;
    }

    if (!this.modelsReady) {
      console.log(`[AgentManager] Queueing agent ${agent.name} (models not ready, pending count: ${this.pendingAgents.length})`);
      const existingIdx = this.pendingAgents.findIndex(a => a.id === agent.id);
      if (existingIdx >= 0) {
        this.pendingAgents[existingIdx] = agent;
      } else {
        this.pendingAgents.push(agent);
      }
      return;
    }

    console.log(`[AgentManager] addAgent ${agent.name} (models ready, current meshes: ${this.agentMeshes.size})`);

    const existing = this.agentMeshes.get(agent.id);
    if (existing) {
      console.log(`[AgentManager] Agent ${agent.name} already exists, removing old mesh`);
      this.scene.remove(existing.group);
      this.characterFactory.disposeAgentMesh(existing);
      this.proceduralAnimator.unregister(agent.id);
      this.effectsManager.removeAgentEffects(agent.id);
      this.agentMeshes.delete(agent.id);
    }

    const customClasses = store.getState().customAgentClasses;
    const customClass = customClasses.get(agent.class);
    if (customClass?.customModelPath && !this.characterLoader.hasCustomModel(customClass.id)) {
      console.log(`[AgentManager] Loading custom model for class ${agent.class}`);
      this.characterLoader.loadCustomModel(customClass.id).then(() => {
        this.addAgentInternal(agent);
      }).catch(err => {
        console.warn(`[AgentManager] Failed to load custom model for ${agent.class}, using fallback:`, err);
        this.addAgentInternal(agent);
      });
      return;
    }

    this.addAgentInternal(agent);
  }

  private addAgentInternal(agent: Agent): void {
    console.log(`[AgentManager] addAgentInternal called for ${agent.name}, position: (${agent.position.x}, ${agent.position.y}, ${agent.position.z})`);

    const existing = this.agentMeshes.get(agent.id);
    if (existing) {
      console.log(`[AgentManager] Removing existing mesh for ${agent.name}`);
      this.scene.remove(existing.group);
      this.characterFactory.disposeAgentMesh(existing);
      this.proceduralAnimator.unregister(agent.id);
      this.effectsManager.removeAgentEffects(agent.id);
      this.agentMeshes.delete(agent.id);
    }

    const meshData = this.characterFactory.createAgentMesh(agent);
    this.scene.add(meshData.group);
    this.agentMeshes.set(agent.id, meshData);
    console.log(`[AgentManager] Agent ${agent.name} added to scene, total meshes: ${this.agentMeshes.size}`);

    // Apply current brightness to new agent's materials
    this.applyStyleToMesh(meshData.group);

    const body = meshData.group.getObjectByName('characterBody');
    const isBoss = agent.isBoss || agent.class === 'boss';
    if (body) {
      const customModelScale = body.userData.customModelScale ?? 1.0;
      const bossMultiplier = isBoss ? 1.5 : 1.0;
      body.scale.setScalar(customModelScale * this.characterScale * bossMultiplier);

      // Update status bar position based on actual scaled model height
      const statusBar = meshData.group.getObjectByName('statusBar') as THREE.Sprite;
      if (statusBar) {
        // Box3.setFromObject already accounts for the object's current scale
        const box = new THREE.Box3().setFromObject(body);
        // Use max.y as the top of the model, with smaller padding for bosses
        // since they're already taller
        const modelTop = box.max.y;
        const padding = isBoss ? 0.2 : 0.3;
        // Cap the height to prevent mana bar going too high
        const maxHeight = isBoss ? 3.0 : 2.2;
        statusBar.position.y = Math.min(Math.max(modelTop, 1.0) + padding, maxHeight);
      }

      if (meshData.animations.size === 0) {
        const state = this.getProceduralStateForStatus(agent.status);
        this.proceduralAnimator.register(agent.id, body, state);
        this.onProceduralCacheInvalidated?.();
      }
    }

    this.updateStatusAnimation(agent, meshData);
    // Register initial status for tracking changes
    this.previousAgentStatuses.set(agent.id, agent.status);
    this.onAgentMeshesChanged?.();
  }

  removeAgent(agentId: string): void {
    const meshData = this.agentMeshes.get(agentId);
    if (meshData) {
      this.scene.remove(meshData.group);
      this.characterFactory.disposeAgentMesh(meshData);
      this.agentMeshes.delete(agentId);
    }

    this.proceduralAnimator.unregister(agentId);
    this.previousAgentStatuses.delete(agentId);
    this.onProceduralCacheInvalidated?.();
    this.effectsManager.removeAgentEffects(agentId);
    this.onAgentMeshesChanged?.();
  }

  updateAgent(agent: Agent, animatePosition = false): void {
    const meshData = this.agentMeshes.get(agent.id);
    if (!meshData) return;

    const state = store.getState();
    const isSelected = state.selectedAgentIds.has(agent.id);

    if (animatePosition) {
      const currentPos = meshData.group.position;
      const posChanged =
        Math.abs(currentPos.x - agent.position.x) > 0.01 ||
        Math.abs(currentPos.z - agent.position.z) > 0.01;

      if (posChanged) {
        this.movementAnimator.startMovement(agent.id, meshData, agent.position);
      }
    } else if (!this.movementAnimator.isMoving(agent.id)) {
      meshData.group.position.set(agent.position.x, agent.position.y, agent.position.z);
    }

    // Check if agent status has changed and track it
    const previousStatus = this.previousAgentStatuses.get(agent.id);
    if (previousStatus !== agent.status) {
      this.previousAgentStatuses.set(agent.id, agent.status);
      console.log(`[AgentManager] Agent status changed: ${agent.name} ${previousStatus || 'initial'} → ${agent.status}`);
    }

    if (!this.movementAnimator.isMoving(agent.id)) {
      this.updateStatusAnimation(agent, meshData);
    } else {
      console.log(`[AgentManager] updateAgent: skipping updateStatusAnimation for ${agent.name} (status=${agent.status}) - movement in progress`);
    }

    this.characterFactory.updateVisuals(meshData.group, agent, isSelected);
  }

  syncAgents(agents: Agent[]): void {
    console.log(`[AgentManager] syncAgents called with ${agents.length} agents, modelsReady: ${this.modelsReady}, pending: ${this.pendingAgents.length}`);
    const previousCount = this.agentMeshes.size;

    // Log pending agents before clearing
    if (this.pendingAgents.length > 0) {
      console.warn(`[AgentManager] WARNING: syncAgents called with ${this.pendingAgents.length} pending agents that will be discarded!`);
      for (const pending of this.pendingAgents) {
        console.warn(`  - ${pending.name}`);
      }
    }

    this.pendingAgents = [];

    for (const meshData of this.agentMeshes.values()) {
      this.scene.remove(meshData.group);
      this.characterFactory.disposeAgentMesh(meshData);
    }
    this.agentMeshes.clear();
    this.previousAgentStatuses.clear();

    this.proceduralAnimator.clear();
    this.effectsManager.clear();

    // Filter out agents that are in archived areas
    const visibleAgents = agents.filter(agent => !store.isAgentInArchivedArea(agent.id));

    console.log(`[AgentManager] syncAgents: adding ${visibleAgents.length} visible agents (filtered from ${agents.length}, ${agents.length - visibleAgents.length} in archived areas)`);
    for (const agent of visibleAgents) {
      this.addAgent(agent);
    }

    console.log(`[AgentManager] syncAgents complete: disposed ${previousCount} agents, added ${visibleAgents.length} visible agents`);
  }

  // ============================================
  // Animation Helpers
  // ============================================

  private getAnimationForStatus(agent: Agent, meshData: AgentMeshData, status: string): string | null {
    const characterBody = meshData.group.getObjectByName('characterBody');
    const customMapping = characterBody?.userData?.animationMapping as AnimationMapping | undefined;

    if (customMapping) {
      if ((status === 'idle') && customMapping.idle) {
        if (meshData.animations.has(customMapping.idle) || meshData.animations.has(customMapping.idle.toLowerCase())) {
          return customMapping.idle;
        }
      }
      if ((status === 'working' || status === 'orphaned') && customMapping.working) {
        if (meshData.animations.has(customMapping.working) || meshData.animations.has(customMapping.working.toLowerCase())) {
          return customMapping.working;
        }
      }
      // If custom mapping exists but no mapping is set for this status, return null (no animation)
      if ((status === 'idle') && !customMapping.idle) {
        return null;
      }
      if ((status === 'working' || status === 'orphaned') && !customMapping.working) {
        return null;
      }
    }

    const statusAnimations: Record<string, string> = {
      idle: this.idleAnimation,
      working: this.workingAnimation,
      waiting: ANIMATIONS.IDLE,
      waiting_permission: ANIMATIONS.IDLE,
      error: ANIMATIONS.EMOTE_NO,
      offline: ANIMATIONS.STATIC,
      orphaned: this.workingAnimation,
    };

    const defaultAnimation = statusAnimations[status] || ANIMATIONS.IDLE;

    // Verify the animation exists - if not, try fallbacks
    const hasAnim = meshData.animations.has(defaultAnimation) || meshData.animations.has(defaultAnimation.toLowerCase());
    if (!hasAnim) {
      // For custom models with mapping, try the mapped idle animation
      if (customMapping?.idle && (meshData.animations.has(customMapping.idle) || meshData.animations.has(customMapping.idle.toLowerCase()))) {
        return customMapping.idle;
      }
      // Try built-in 'idle' animation as fallback
      if (meshData.animations.has(ANIMATIONS.IDLE) || meshData.animations.has(ANIMATIONS.IDLE.toLowerCase())) {
        console.warn(`[AgentManager] Animation '${defaultAnimation}' not found, falling back to 'idle'`);
        return ANIMATIONS.IDLE;
      }
      // Try 'static' as last resort
      if (meshData.animations.has(ANIMATIONS.STATIC) || meshData.animations.has(ANIMATIONS.STATIC.toLowerCase())) {
        console.warn(`[AgentManager] Animation '${defaultAnimation}' not found, falling back to 'static'`);
        return ANIMATIONS.STATIC;
      }
      // No valid animation found - return null to stop animation
      console.warn(`[AgentManager] No valid animation found for status '${status}', stopping animation`);
      return null;
    }

    return defaultAnimation;
  }

  updateStatusAnimation(agent: Agent, meshData: AgentMeshData): void {
    if (meshData.animations.size === 0) {
      if (this.proceduralAnimator.has(agent.id)) {
        const state = this.getProceduralStateForStatus(agent.status);
        this.proceduralAnimator.setState(agent.id, state);
      }
      this.effectsManager.setAgentMeshes(this.agentMeshes);
      this.effectsManager.updateWaitingPermissionEffect(agent.id, agent.status === 'waiting_permission');
      return;
    }

    const animation = this.getAnimationForStatus(agent, meshData, agent.status);

    // If no animation should play (e.g. idle animation set to none for custom models),
    // stop the current animation and freeze the agent
    if (animation === null) {
      console.log(`[AgentManager] updateStatusAnimation: agent=${agent.name} status=${agent.status} - no animation (none)`);
      if (meshData.currentAction) {
        meshData.currentAction.stop();
        meshData.currentAction = null;
      }
      this.movementAnimator.stopAnimation(agent.id);
      this.effectsManager.setAgentMeshes(this.agentMeshes);
      this.effectsManager.updateWaitingPermissionEffect(agent.id, agent.status === 'waiting_permission');
      return;
    }

    const currentClipName = meshData.currentAction?.getClip()?.name?.toLowerCase();

    const oneShotAnimations: string[] = [ANIMATIONS.DIE, ANIMATIONS.EMOTE_NO, ANIMATIONS.EMOTE_YES];
    const isConfiguredAnimation = animation === this.idleAnimation || animation === this.workingAnimation;
    const isOneShot = oneShotAnimations.includes(animation) ||
      (animation === ANIMATIONS.JUMP && !isConfiguredAnimation);

    const animationLower = animation.toLowerCase();
    const isAlreadyPlaying = currentClipName === animation || currentClipName === animationLower;

    // Check if current animation has different options (e.g., timeScale)
    // If status is 'working', we need timeScale 1.5. Movement uses timeScale 1.0.
    // Force replay if same animation but different expected timeScale.
    const expectedTimeScale = agent.status === 'working' ? 1.5 : 1.0;
    const currentTimeScale = meshData.currentAction?.timeScale ?? 1.0;
    const needsOptionsUpdate = isAlreadyPlaying && Math.abs(currentTimeScale - expectedTimeScale) > 0.01;

    const shouldPlay = isOneShot
      ? !isAlreadyPlaying
      : !isAlreadyPlaying || !meshData.currentAction || needsOptionsUpdate;

    console.log(`[AgentManager] updateStatusAnimation: agent=${agent.name} status=${agent.status} targetAnim=${animation} currentAnim=${currentClipName || 'none'} shouldPlay=${shouldPlay} isAlreadyPlaying=${isAlreadyPlaying} needsOptionsUpdate=${needsOptionsUpdate}`);

    if (shouldPlay) {
      const options = agent.status === 'working'
        ? { timeScale: 1.5 }
        : isOneShot
          ? { loop: false }
          : {};
      this.movementAnimator.playAnimation(meshData, animation, options);
    } else {
      console.log(`[AgentManager] Animation NOT played - shouldPlay=false`);
    }

    this.effectsManager.setAgentMeshes(this.agentMeshes);
    this.effectsManager.updateWaitingPermissionEffect(agent.id, agent.status === 'waiting_permission');
  }

  getProceduralStateForStatus(status: string): ProceduralAnimationState {
    switch (status) {
      case 'idle':
        return 'idle';
      case 'working':
      case 'orphaned':
        return 'working';
      case 'waiting':
      case 'waiting_permission':
        return 'waiting';
      case 'error':
        return 'error';
      case 'offline':
      default:
        return 'static';
    }
  }

  // ============================================
  // Movement Completion Handler
  // ============================================

  handleMovementCompletions(completedMovements: string[]): void {
    if (completedMovements.length === 0) return;

    const state = store.getState();
    for (const agentId of completedMovements) {
      const agent = state.agents.get(agentId);
      const meshData = this.agentMeshes.get(agentId);
      if (agent && meshData) {
        console.log(`[AgentManager] handleMovementCompletions: applying status animation for ${agent.name} (status=${agent.status})`);
        this.updateStatusAnimation(agent, meshData);
      }
    }
  }

  // ============================================
  // Idle Timer Updates
  // ============================================

  updateIdleTimers(): void {
    const state = store.getState();
    for (const [agentId, meshData] of this.agentMeshes) {
      const agent = state.agents.get(agentId);
      if (agent && agent.status === 'idle') {
        this.characterFactory.updateIdleTimer(meshData.group, agent.status, agent.lastActivity);
      }
    }
  }

  // ============================================
  // Cleanup
  // ============================================

  dispose(): void {
    const agentCount = this.agentMeshes.size;
    for (const meshData of this.agentMeshes.values()) {
      this.scene.remove(meshData.group);
      this.characterFactory.disposeAgentMesh(meshData);
    }
    this.agentMeshes.clear();
    this.pendingAgents = [];
    console.log(`[AgentManager] Disposed ${agentCount} agent meshes`);
  }
}

// HMR: Accept updates without full reload - mark as pending for manual refresh
if (import.meta.hot) {
  import.meta.hot.accept(() => {
    console.log('[Tide HMR] AgentManager updated - pending refresh available');
    window.__tideHmrPendingSceneChanges = true;
  });
}
