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
  private idleAnimation: string = ANIMATIONS.SIT;
  private workingAnimation: string = ANIMATIONS.WALK;

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
      }
    }
  }

  setIdleAnimation(animation: string): void {
    this.idleAnimation = animation;
    const state = store.getState();
    for (const [agentId, meshData] of this.agentMeshes) {
      const agent = state.agents.get(agentId);
      if (agent && agent.status === 'idle' && !this.movementAnimator.isMoving(agentId)) {
        this.movementAnimator.playAnimation(meshData, animation);
      }
    }
  }

  setWorkingAnimation(animation: string): void {
    this.workingAnimation = animation;
    const state = store.getState();
    for (const [agentId, meshData] of this.agentMeshes) {
      const agent = state.agents.get(agentId);
      if (agent && agent.status === 'working' && !this.movementAnimator.isMoving(agentId)) {
        this.movementAnimator.playAnimation(meshData, animation, { timeScale: 1.5 });
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

        this.updateStatusAnimation(agent, newMeshData);
      }
    }

    this.onAgentMeshesChanged?.();
  }

  // ============================================
  // Agent CRUD
  // ============================================

  addAgent(agent: Agent): void {
    if (!this.modelsReady) {
      console.log(`[AgentManager] Queueing agent ${agent.name} (models not ready)`);
      const existingIdx = this.pendingAgents.findIndex(a => a.id === agent.id);
      if (existingIdx >= 0) {
        this.pendingAgents[existingIdx] = agent;
      } else {
        this.pendingAgents.push(agent);
      }
      return;
    }

    const existing = this.agentMeshes.get(agent.id);
    if (existing) {
      this.scene.remove(existing.group);
      this.characterFactory.disposeAgentMesh(existing);
      this.proceduralAnimator.unregister(agent.id);
      this.effectsManager.removeAgentEffects(agent.id);
      this.agentMeshes.delete(agent.id);
    }

    const customClasses = store.getState().customAgentClasses;
    const customClass = customClasses.get(agent.class);
    if (customClass?.customModelPath && !this.characterLoader.hasCustomModel(customClass.id)) {
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
    const existing = this.agentMeshes.get(agent.id);
    if (existing) {
      this.scene.remove(existing.group);
      this.characterFactory.disposeAgentMesh(existing);
      this.proceduralAnimator.unregister(agent.id);
      this.effectsManager.removeAgentEffects(agent.id);
      this.agentMeshes.delete(agent.id);
    }

    const meshData = this.characterFactory.createAgentMesh(agent);
    this.scene.add(meshData.group);
    this.agentMeshes.set(agent.id, meshData);

    const body = meshData.group.getObjectByName('characterBody');
    if (body) {
      const customModelScale = body.userData.customModelScale ?? 1.0;
      const bossMultiplier = (agent.isBoss || agent.class === 'boss') ? 1.5 : 1.0;
      body.scale.setScalar(customModelScale * this.characterScale * bossMultiplier);

      if (meshData.animations.size === 0) {
        const state = this.getProceduralStateForStatus(agent.status);
        this.proceduralAnimator.register(agent.id, body, state);
        this.onProceduralCacheInvalidated?.();
      }
    }

    this.updateStatusAnimation(agent, meshData);
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

    if (!this.movementAnimator.isMoving(agent.id)) {
      this.updateStatusAnimation(agent, meshData);
    }

    this.characterFactory.updateVisuals(meshData.group, agent, isSelected);
  }

  syncAgents(agents: Agent[]): void {
    console.log(`[AgentManager] syncAgents called with ${agents.length} agents, modelsReady: ${this.modelsReady}`);
    const previousCount = this.agentMeshes.size;

    this.pendingAgents = [];

    for (const meshData of this.agentMeshes.values()) {
      this.scene.remove(meshData.group);
      this.characterFactory.disposeAgentMesh(meshData);
    }
    this.agentMeshes.clear();

    this.proceduralAnimator.clear();
    this.effectsManager.clear();

    for (const agent of agents) {
      this.addAgent(agent);
    }

    console.log(`[AgentManager] syncAgents: disposed ${previousCount} agents, added ${agents.length} new agents`);
  }

  // ============================================
  // Animation Helpers
  // ============================================

  private getAnimationForStatus(agent: Agent, meshData: AgentMeshData, status: string): string {
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

    // For custom models, verify the animation exists - if not, try common fallbacks
    if (customMapping && !meshData.animations.has(defaultAnimation) && !meshData.animations.has(defaultAnimation.toLowerCase())) {
      // Try to find any available animation as fallback
      // Priority: idle mapping, first available animation, or return default anyway
      if (customMapping.idle && (meshData.animations.has(customMapping.idle) || meshData.animations.has(customMapping.idle.toLowerCase()))) {
        return customMapping.idle;
      }
      // Return the first available animation if no idle mapping
      const firstAnimation = meshData.animations.keys().next().value;
      if (firstAnimation) {
        return firstAnimation;
      }
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
    const currentClipName = meshData.currentAction?.getClip()?.name?.toLowerCase();

    const oneShotAnimations: string[] = [ANIMATIONS.DIE, ANIMATIONS.EMOTE_NO, ANIMATIONS.EMOTE_YES];
    const isConfiguredAnimation = animation === this.idleAnimation || animation === this.workingAnimation;
    const isOneShot = oneShotAnimations.includes(animation) ||
      (animation === ANIMATIONS.JUMP && !isConfiguredAnimation);

    const animationLower = animation.toLowerCase();
    const isAlreadyPlaying = currentClipName === animation || currentClipName === animationLower;

    const shouldPlay = isOneShot
      ? !isAlreadyPlaying
      : !isAlreadyPlaying || !meshData.currentAction;

    console.log(`[AgentManager] updateStatusAnimation: agent=${agent.name} status=${agent.status} targetAnim=${animation} currentAnim=${currentClipName || 'none'} shouldPlay=${shouldPlay} isAlreadyPlaying=${isAlreadyPlaying}`);

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
