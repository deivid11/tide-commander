import * as THREE from 'three';
import type { Agent, CustomAgentClass } from '../../../shared/types';
import { CharacterLoader } from './CharacterLoader';
import { ModelLoader } from './ModelLoader';
import { AnimationConfigurator } from './AnimationConfigurator';
import { VisualConfig, getContextRemainingPercent } from './VisualConfig';

// Re-export AgentMeshData from ModelLoader (canonical location)
export type { AgentMeshData } from './ModelLoader';
import type { AgentMeshData } from './ModelLoader';

/**
 * Thin orchestrator that composes ModelLoader, AnimationConfigurator, and VisualConfig
 * to create and manage agent mesh groups with all visual components.
 */
export class CharacterFactory {
  private modelLoader: ModelLoader;
  private animConfig: AnimationConfigurator;
  private visualConfig: VisualConfig;

  constructor(characterLoader: CharacterLoader) {
    this.modelLoader = new ModelLoader(characterLoader);
    this.animConfig = new AnimationConfigurator();
    this.visualConfig = new VisualConfig(this.animConfig);
  }

  /**
   * Update the custom classes reference for model lookups.
   */
  setCustomClasses(classes: Map<string, CustomAgentClass>): void {
    this.modelLoader.setCustomClasses(classes);
  }

  /**
   * Create a complete agent mesh group with character model and indicators.
   */
  createAgentMesh(agent: Agent): AgentMeshData {
    const group = new THREE.Group();
    group.userData.agentId = agent.id;

    const classConfig = this.modelLoader.getClassConfig(agent.class);
    const isBoss = agent.isBoss === true || agent.class === 'boss';

    // Character body (3D model or fallback capsule)
    const { body, mixer, animations } = this.modelLoader.createCharacterBody(agent, classConfig.color);
    group.add(body);

    // Calculate model height for proper UI positioning
    const modelHeight = this.modelLoader.calculateModelHeight(body, isBoss);

    // Selection ring (shows when agent is selected)
    const selectionRing = this.visualConfig.createSelectionRing(classConfig.color, isBoss);
    group.add(selectionRing);

    // Status bar sprite (mana bar + idle timer + crown) - positioned above model
    const remainingPercent = getContextRemainingPercent(agent);
    const statusBar = this.visualConfig.createStatusBarSprite(
      remainingPercent,
      agent.status,
      agent.lastActivity,
      isBoss,
      modelHeight
    );
    group.add(statusBar);

    // Name label sprite - positioned below
    const nameLabel = this.visualConfig.createNameLabelSprite(agent.name, classConfig.color, isBoss);
    group.add(nameLabel);

    // Store agent metadata for updates
    group.userData.agentName = agent.name;
    group.userData.agentClass = agent.class;
    group.userData.isBoss = isBoss;

    // Set initial position
    group.position.set(agent.position.x, agent.position.y, agent.position.z);

    // Add invisible hitbox for easier clicking
    const hitboxRadius = isBoss ? 0.9 : 0.65;
    const hitboxGeometry = new THREE.SphereGeometry(hitboxRadius, 8, 6);
    const hitboxMaterial = new THREE.MeshBasicMaterial({
      visible: false,
      transparent: true,
      opacity: 0,
    });
    const hitbox = new THREE.Mesh(hitboxGeometry, hitboxMaterial);
    hitbox.position.y = hitboxRadius;
    hitbox.name = 'clickHitbox';
    group.add(hitbox);

    return { group, mixer, animations, currentAction: null };
  }

  /**
   * Check if agent class changed and update the 3D model if needed.
   * Returns updated AgentMeshData if model was replaced, null otherwise.
   */
  updateAgentClass(meshData: AgentMeshData, agent: Agent): AgentMeshData | null {
    const { group } = meshData;
    const currentClass = group.userData.agentClass;

    if (currentClass === agent.class) return null;

    console.log(`[CharacterFactory] Agent ${agent.name} class changed: ${currentClass} -> ${agent.class}`);

    const result = this.modelLoader.replaceAgentModel(meshData, agent);
    if (result) {
      // Update name label with new class color
      this.visualConfig.updateNameLabel(group, agent.name, agent.class);
    }
    return result;
  }

  /**
   * Update visual state of an agent mesh.
   */
  updateVisuals(group: THREE.Group, agent: Agent, isSelected: boolean, isSubordinateOfSelectedBoss: boolean = false): void {
    const classConfig = this.modelLoader.getClassConfig(agent.class);
    this.visualConfig.updateVisuals(group, agent, isSelected, isSubordinateOfSelectedBoss, classConfig.color);
  }

  /**
   * Upgrade an agent's capsule body to a character model.
   */
  upgradeToCharacterModel(group: THREE.Group, agent: Agent): AgentMeshData | null {
    return this.modelLoader.upgradeToCharacterModel(group, agent);
  }

  /**
   * Dispose of an agent mesh and all its resources.
   */
  disposeAgentMesh(meshData: AgentMeshData): void {
    this.modelLoader.disposeAgentMesh(meshData);
  }

  /**
   * Get color for a status string.
   */
  getStatusColor(status: string): number {
    return this.visualConfig.getStatusColor(status);
  }

  /**
   * Update the idle timer for an agent.
   */
  updateIdleTimer(group: THREE.Group, status: string, lastActivity: number): void {
    this.visualConfig.updateIdleTimer(group, status, lastActivity);
  }

  /**
   * Update the mana bar for an agent.
   */
  updateManaBar(group: THREE.Group, remainingPercent: number, status: string): void {
    this.visualConfig.updateManaBar(group, remainingPercent, status);
  }
}

// HMR: Accept updates without full reload - mark as pending for manual refresh
if (import.meta.hot) {
  import.meta.hot.accept(() => {
    console.log('[Tide HMR] CharacterFactory updated - pending refresh available');
    window.__tideHmrPendingSceneChanges = true;
  });
}
