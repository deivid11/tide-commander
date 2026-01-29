import * as THREE from 'three';
import type { Agent, CustomAgentClass, BuiltInAgentClass } from '../../../shared/types';
import { AGENT_CLASS_CONFIG, AGENT_CLASS_MODELS } from '../config';
import { CharacterLoader } from './CharacterLoader';

/**
 * Status colors for agent state visualization.
 */
const STATUS_COLORS: Record<string, number> = {
  idle: 0x4aff9e,
  working: 0x4a9eff,
  waiting: 0xff9e4a,
  waiting_permission: 0xffcc00, // Yellow/gold for awaiting permission
  error: 0xff4a4a,
  orphaned: 0xff00ff, // Magenta/purple for orphaned (untracked) processes
  default: 0x888888,
};

/**
 * Calculate remaining context percentage from agent data.
 * Uses contextStats (from /context command) when available, otherwise falls back to basic calculation.
 */
function getContextRemainingPercent(agent: Agent): number {
  if (agent.contextStats) {
    // Remaining context is 100 - usedPercent
    // NOTE: freeSpace.percent is just one category (excludes autocompact buffer), don't use it
    return 100 - agent.contextStats.usedPercent;
  }
  // Fallback to basic calculation
  const used = agent.contextUsed || 0;
  const limit = agent.contextLimit || 200000;
  const remaining = Math.max(0, limit - used);
  return (remaining / limit) * 100;
}

// Default model for custom classes if none specified
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

/**
 * Creates and manages agent mesh groups with all visual components.
 */
export class CharacterFactory {
  private customClasses: Map<string, CustomAgentClass> = new Map();

  constructor(private characterLoader: CharacterLoader) {}

  /**
   * Update the custom classes reference for model lookups
   */
  setCustomClasses(classes: Map<string, CustomAgentClass>): void {
    this.customClasses = classes;
  }

  /**
   * Get class config (icon, color) for an agent class (built-in or custom)
   */
  private getClassConfig(agentClass: string): { icon: string; color: number; description: string } {
    // Check built-in classes first
    const builtIn = AGENT_CLASS_CONFIG[agentClass as BuiltInAgentClass];
    if (builtIn) {
      return builtIn;
    }

    // Check custom classes
    const custom = this.customClasses.get(agentClass);
    if (custom) {
      // Convert hex string color to number
      const colorNum = parseInt(custom.color.replace('#', ''), 16);
      return {
        icon: custom.icon,
        color: isNaN(colorNum) ? 0x888888 : colorNum,
        description: custom.description,
      };
    }

    // Fallback
    return { icon: '❓', color: 0x888888, description: 'Unknown class' };
  }

  /**
   * Get the model file for an agent class (built-in or custom)
   * Returns { file: string, isCustomModel: boolean, customClassId?: string }
   */
  private getModelInfo(agentClass: string): {
    file: string;
    isCustomModel: boolean;
    customClassId?: string;
    scale?: number;
    offset?: { x: number; y: number; z: number };
  } {
    // Check built-in classes first
    const builtIn = AGENT_CLASS_MODELS[agentClass as keyof typeof AGENT_CLASS_MODELS];
    if (builtIn) {
      return { file: builtIn, isCustomModel: false };
    }

    // Check custom classes
    const custom = this.customClasses.get(agentClass);
    if (custom) {
      // Custom model uploaded?
      if (custom.customModelPath) {
        return {
          file: custom.customModelPath,
          isCustomModel: true,
          customClassId: custom.id,
          scale: custom.modelScale,
          offset: custom.modelOffset,
        };
      }
      // Using built-in model for custom class
      if (custom.model) {
        return { file: custom.model, isCustomModel: false, scale: custom.modelScale, offset: custom.modelOffset };
      }
    }

    // Default model for unknown/custom classes without model specified
    return { file: DEFAULT_CUSTOM_CLASS_MODEL, isCustomModel: false };
  }

  /**
   * Get the model file for an agent class (built-in or custom)
   * @deprecated Use getModelInfo instead for full model information
   */
  private getModelFile(agentClass: string): string {
    return this.getModelInfo(agentClass).file;
  }

  /**
   * Create a complete agent mesh group with character model and indicators.
   */
  createAgentMesh(agent: Agent): AgentMeshData {
    const group = new THREE.Group();
    group.userData.agentId = agent.id;

    const classConfig = this.getClassConfig(agent.class);

    // Boss agents are 1.5x larger (scaling is applied by SceneManager.addAgent)
    // Check both isBoss property and class === 'boss' for backward compatibility
    const isBoss = agent.isBoss === true || agent.class === 'boss';

    // Character body (3D model or fallback capsule)
    const { body, mixer, animations } = this.createCharacterBody(agent, classConfig.color);
    group.add(body);

    // Calculate model height for proper UI positioning
    const modelHeight = this.calculateModelHeight(body, isBoss);

    // Selection ring (shows when agent is selected) - larger for boss
    const selectionRing = this.createSelectionRing(classConfig.color, isBoss);
    group.add(selectionRing);

    // Status bar sprite (mana bar + idle timer + crown) - positioned above model
    const remainingPercent = getContextRemainingPercent(agent);
    const statusBar = this.createStatusBarSprite(
      remainingPercent,
      agent.status,
      agent.lastActivity,
      isBoss,
      modelHeight
    );
    group.add(statusBar);

    // Name label sprite - positioned below
    const nameLabel = this.createNameLabelSprite(agent.name, classConfig.color, isBoss);
    group.add(nameLabel);

    // Store agent metadata for updates
    group.userData.agentName = agent.name;
    group.userData.agentClass = agent.class;
    group.userData.isBoss = isBoss;

    // Set initial position
    group.position.set(agent.position.x, agent.position.y, agent.position.z);

    // Add invisible hitbox for easier clicking (sphere at bottom, behind name label)
    const hitboxRadius = isBoss ? 0.9 : 0.65;
    const hitboxGeometry = new THREE.SphereGeometry(hitboxRadius, 8, 6);
    const hitboxMaterial = new THREE.MeshBasicMaterial({
      visible: false,
      transparent: true,
      opacity: 0,
    });
    const hitbox = new THREE.Mesh(hitboxGeometry, hitboxMaterial);
    hitbox.position.y = hitboxRadius; // Position sphere at ground level
    hitbox.name = 'clickHitbox';
    group.add(hitbox);

    return {
      group,
      mixer,
      animations,
      currentAction: null,
    };
  }

  /**
   * Create the character body - either loaded model or fallback capsule.
   */
  private createCharacterBody(
    agent: Agent,
    fallbackColor: number
  ): {
    body: THREE.Object3D;
    mixer: THREE.AnimationMixer | null;
    animations: Map<string, THREE.AnimationClip>;
  } {
    // Get model info for this agent's class (built-in or custom)
    const modelInfo = this.getModelInfo(agent.class);

    let cloneResult: { mesh: THREE.Group; animations: THREE.AnimationClip[] } | null = null;

    // Try custom model first if applicable
    if (modelInfo.isCustomModel && modelInfo.customClassId) {
      cloneResult = this.characterLoader.cloneCustomModel(modelInfo.customClassId);
    }

    // Fall back to built-in model
    if (!cloneResult) {
      cloneResult = this.characterLoader.cloneByModelFile(modelInfo.file);
    }

    if (cloneResult) {
      cloneResult.mesh.name = 'characterBody';

      // Store custom model scale in userData for SceneManager to use
      // Don't apply scale here - let SceneManager handle all scaling uniformly
      const customModelScale = modelInfo.scale ?? 1.0;
      cloneResult.mesh.userData.customModelScale = customModelScale;

      // Mark if this is a custom model (GLB uploaded by user) for brightness adjustments
      cloneResult.mesh.userData.isCustomModel = modelInfo.isCustomModel;

      // Apply custom position offset if specified (x: horizontal, y: depth, z: vertical height)
      // Only apply if there are non-zero values to avoid overwriting default position
      if (modelInfo.offset && (modelInfo.offset.x !== 0 || modelInfo.offset.y !== 0 || modelInfo.offset.z !== 0)) {
        cloneResult.mesh.position.set(modelInfo.offset.x, modelInfo.offset.z, modelInfo.offset.y);
      }

      // Store custom class info for animation mapping
      const customClass = this.customClasses.get(agent.class);
      if (customClass?.animationMapping) {
        cloneResult.mesh.userData.animationMapping = customClass.animationMapping;
      }

      // Create animation mixer
      const mixer = new THREE.AnimationMixer(cloneResult.mesh);

      // Map animations by name (lowercase for consistent lookup)
      const animations = new Map<string, THREE.AnimationClip>();
      for (const clip of cloneResult.animations) {
        // Normalize to lowercase to match ANIMATIONS constants
        const normalizedName = clip.name.toLowerCase();
        animations.set(normalizedName, clip);
        // Also store with original name for custom animation mapping
        animations.set(clip.name, clip);
      }

      return {
        body: cloneResult.mesh,
        mixer,
        animations,
      };
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

    return {
      body,
      mixer: null,
      animations: new Map(),
    };
  }

  /**
   * Calculate the height of the model for UI positioning.
   * Returns a base height that will be updated after actual scaling is applied.
   * The real position update happens in AgentManager.addAgentInternal()
   */
  private calculateModelHeight(_body: THREE.Object3D, isBoss: boolean): number {
    // Return a reasonable default - the actual position will be calculated
    // in AgentManager after the model is properly scaled
    return isBoss ? 2.0 : 1.5;
  }

  /**
   * Create the selection ring indicator.
   */
  private createSelectionRing(color: number, isBoss: boolean = false): THREE.Mesh {
    const scale = isBoss ? 1.5 : 1.0;
    const geometry = new THREE.RingGeometry(0.8 * scale, 0.95 * scale, 32);
    const material = new THREE.MeshBasicMaterial({
      color,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0,
    });

    const ring = new THREE.Mesh(geometry, material);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.05;
    ring.name = 'selectionRing';

    return ring;
  }

  /**
   * Create a status bar sprite containing mana bar, idle timer, and crown.
   * Positioned above the character based on model height.
   */
  private createStatusBarSprite(
    remainingPercent: number,
    status: string,
    lastActivity: number,
    isBoss: boolean,
    modelHeight: number = 2.0
  ): THREE.Sprite {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d')!;

    // 4K resolution canvas for crisp text rendering (taller to fit idle timer)
    canvas.width = 4096;
    canvas.height = 2560;

    this.drawStatusBar(ctx, canvas.width, canvas.height, remainingPercent, status, lastActivity, isBoss);

    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = true;
    texture.anisotropy = 16;
    texture.needsUpdate = true;

    const material = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: false,
    });

    const sprite = new THREE.Sprite(material);
    // Position above the character based on model height with padding
    const padding = isBoss ? 0.8 : 0.5;
    sprite.position.y = modelHeight + padding;
    const baseScale = isBoss ? 2.8 : 2.2;
    sprite.scale.set(baseScale, baseScale * (canvas.height / canvas.width), 1);
    sprite.name = 'statusBar';

    // Store model height for potential runtime updates
    sprite.userData.modelHeight = modelHeight;

    return sprite;
  }

  /**
   * Create a name label sprite.
   * Positioned below the character.
   */
  private createNameLabelSprite(name: string, color: number, isBoss: boolean): THREE.Sprite {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d')!;

    // Wide canvas to fit long names
    canvas.width = 8192;
    canvas.height = 1024;

    this.drawNameLabel(ctx, canvas.width, canvas.height, name, color);

    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = true;
    texture.anisotropy = 16;
    texture.needsUpdate = true;

    const material = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: false,
    });

    const sprite = new THREE.Sprite(material);
    // Position below the character (lower)
    sprite.position.y = isBoss ? -0.8 : -0.6;
    const baseScale = isBoss ? 3.5 : 2.8;
    sprite.scale.set(baseScale, baseScale * (canvas.height / canvas.width), 1);
    sprite.name = 'nameLabelSprite';

    return sprite;
  }

  /**
   * Draw the name label on a canvas.
   */
  private drawNameLabel(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    name: string,
    color: number
  ): void {
    ctx.clearRect(0, 0, width, height);

    const colorHex = `#${color.toString(16).padStart(6, '0')}`;

    // Dynamic font size - start large and shrink if needed to fit
    let fontSize = 800;
    const minFontSize = 300;
    const maxWidth = width - 400; // Leave some padding

    ctx.font = `bold ${fontSize}px Arial`;
    let textWidth = ctx.measureText(name).width;

    // Reduce font size until text fits
    while (textWidth > maxWidth && fontSize > minFontSize) {
      fontSize -= 40;
      ctx.font = `bold ${fontSize}px Arial`;
      textWidth = ctx.measureText(name).width;
    }

    // Name text with thick outline and shadow for readability
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Add drop shadow for depth
    ctx.shadowColor = 'rgba(0, 0, 0, 0.9)';
    ctx.shadowBlur = fontSize * 0.12;
    ctx.shadowOffsetX = fontSize * 0.04;
    ctx.shadowOffsetY = fontSize * 0.04;

    // Draw thick black outline (proportional to font size)
    ctx.strokeStyle = '#000';
    ctx.lineWidth = fontSize * 0.14;
    ctx.lineJoin = 'round';
    ctx.strokeText(name, width / 2, height / 2);

    // Reset shadow for fill
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;

    // Draw colored fill
    ctx.fillStyle = colorHex;
    ctx.fillText(name, width / 2, height / 2);
  }

  /**
   * Draw the status bar (mana bar, idle timer, crown) on a canvas.
   */
  private drawStatusBar(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    remainingPercent: number,
    status: string,
    lastActivity: number,
    isBoss: boolean
  ): void {
    ctx.clearRect(0, 0, width, height);

    // Scale factor for 4K resolution (4096x2048)
    const scale = width / 2048;
    let yOffset = 80 * scale;

    // === Crown (for boss agents) ===
    if (isBoss) {
      ctx.font = `${400 * scale}px serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText('👑', width / 2, yOffset);
      yOffset += 440 * scale;
    }

    // === Mana bar with status dot (same size for all agents) ===
    const manaBarHeight = 200 * scale;
    const manaBarWidth = 1350 * scale;
    const manaBarX = (width - manaBarWidth) / 2;
    const manaBarY = yOffset;

    // Status dot
    const dotSize = 200 * scale;
    const dotX = manaBarX + dotSize / 2 + 30 * scale;
    const dotY = manaBarY + manaBarHeight / 2;

    let dotColor: string;
    switch (status) {
      case 'working': dotColor = '#4a9eff'; break;      // Soft blue
      case 'orphaned': dotColor = '#c060e0'; break;     // Muted purple
      case 'error': dotColor = '#e05050'; break;        // Soft red
      case 'waiting':
      case 'waiting_permission': dotColor = '#e0a030'; break; // Soft amber
      default: dotColor = '#40c090';                    // Soft teal
    }

    // Draw status dot - clean and simple
    ctx.beginPath();
    ctx.arc(dotX, dotY, dotSize / 2, 0, Math.PI * 2);
    ctx.fillStyle = dotColor;
    ctx.shadowColor = dotColor;
    ctx.shadowBlur = 20 * scale;
    ctx.fill();
    ctx.shadowBlur = 0;

    // Subtle border for definition
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.4)';
    ctx.lineWidth = 4 * scale;
    ctx.stroke();

    // Mana bar background
    const barStartX = manaBarX + dotSize + 60 * scale;
    const barWidth = manaBarWidth - dotSize - 90 * scale;
    const barHeight = manaBarHeight - 80 * scale;
    const barY = manaBarY + 40 * scale;
    const borderRadius = 30 * scale;

    // Clean dark background - solid color, no gradient
    ctx.fillStyle = '#0d0d14';
    ctx.beginPath();
    ctx.roundRect(barStartX, barY, barWidth, barHeight, borderRadius);
    ctx.fill();

    // Subtle border
    ctx.strokeStyle = 'rgba(80, 90, 110, 0.5)';
    ctx.lineWidth = 4 * scale;
    ctx.stroke();

    // Mana fill - clean solid colors
    const percentage = Math.max(0, Math.min(100, remainingPercent)) / 100;
    const fillPadding = 8 * scale;
    const fillWidth = Math.max(0, (barWidth - fillPadding * 2) * percentage);
    if (fillWidth > 0) {
      let fillColor: string;
      if (percentage > 0.5) {
        // Clean teal for healthy
        fillColor = '#00c896';
      } else if (percentage > 0.2) {
        // Warm amber for warning
        fillColor = '#e8a020';
      } else {
        // Soft red for critical
        fillColor = '#e84040';
      }

      // Solid fill - no gradients
      ctx.fillStyle = fillColor;
      ctx.beginPath();
      ctx.roundRect(barStartX + fillPadding, barY + fillPadding, fillWidth, barHeight - fillPadding * 2, borderRadius - fillPadding);
      ctx.fill();

      // Subtle glow only
      ctx.shadowColor = fillColor;
      ctx.shadowBlur = 12 * scale;
      ctx.fill();
      ctx.shadowBlur = 0;
    }

    // Percentage text with improved styling
    const percentText = `${Math.round(percentage * 100)}%`;
    ctx.font = `bold ${180 * scale}px "Segoe UI", Arial, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const barCenterX = barStartX + barWidth / 2;
    const barCenterY = barY + barHeight / 2;

    // Text shadow for depth
    ctx.shadowColor = 'rgba(0, 0, 0, 0.8)';
    ctx.shadowBlur = 8 * scale;
    ctx.shadowOffsetX = 2 * scale;
    ctx.shadowOffsetY = 2 * scale;

    // Dark outline
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.9)';
    ctx.lineWidth = 24 * scale;
    ctx.lineJoin = 'round';
    ctx.strokeText(percentText, barCenterX, barCenterY);

    // Reset shadow for fill
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;

    // White fill with subtle gradient
    ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
    ctx.fillText(percentText, barCenterX, barCenterY);

    yOffset += manaBarHeight + 60 * scale;

    // === Idle timer (only for idle agents) ===
    if (status === 'idle' && lastActivity > 0) {
      const idleSeconds = Math.floor((Date.now() - lastActivity) / 1000);
      const idleText = this.formatIdleTimeShort(idleSeconds);
      const colors = this.getIdleTimerColor(idleSeconds);

      ctx.font = `bold ${140 * scale}px Arial`;
      const idleTextWidth = ctx.measureText(`⏱ ${idleText}`).width;
      const idleBgWidth = idleTextWidth + 140 * scale;
      const idleBgHeight = 180 * scale;
      const idleBgX = (width - idleBgWidth) / 2;
      const idleBgY = yOffset;

      ctx.fillStyle = 'rgba(0, 0, 0, 0.85)';
      ctx.beginPath();
      ctx.roundRect(idleBgX, idleBgY, idleBgWidth, idleBgHeight, 28 * scale);
      ctx.fill();

      ctx.strokeStyle = colors.border;
      ctx.lineWidth = 12 * scale;
      ctx.stroke();

      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 14 * scale;
      ctx.strokeText(`⏱ ${idleText}`, width / 2, idleBgY + idleBgHeight / 2);
      ctx.fillStyle = colors.text;
      ctx.fillText(`⏱ ${idleText}`, width / 2, idleBgY + idleBgHeight / 2);
    }
  }

  /**
   * @deprecated Use createStatusBarSprite and createNameLabelSprite instead
   */
  private createCombinedUISprite(
    name: string,
    color: number,
    remainingPercent: number,
    status: string,
    lastActivity: number,
    isBoss: boolean
  ): THREE.Sprite {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d')!;

    // High resolution canvas for crisp text rendering (4K resolution)
    canvas.width = 4096;
    canvas.height = 2048;

    this.drawCombinedUI(ctx, canvas.width, canvas.height, name, color, remainingPercent, status, lastActivity, isBoss);

    const texture = new THREE.CanvasTexture(canvas);
    // Use LinearMipmapLinearFilter for better quality at varying distances
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = true;
    // Increase anisotropy for sharper text at angles
    texture.anisotropy = 16;
    texture.needsUpdate = true;

    const material = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: false,
    });

    const sprite = new THREE.Sprite(material);
    // Position above the character
    sprite.position.y = isBoss ? 3.2 : 2.2;
    // Scale to match the canvas aspect ratio - larger scale for crisp rendering
    const baseScale = isBoss ? 3.0 : 2.4;
    sprite.scale.set(baseScale, baseScale * (canvas.height / canvas.width), 1);
    sprite.name = 'combinedUI';

    return sprite;
  }

  /**
   * Draw all UI elements on a single canvas.
   */
  private drawCombinedUI(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    name: string,
    color: number,
    remainingPercent: number,
    status: string,
    lastActivity: number,
    isBoss: boolean
  ): void {
    ctx.clearRect(0, 0, width, height);

    const colorHex = `#${color.toString(16).padStart(6, '0')}`;
    // Scale factor: 4096/2048 = 2x the original values
    const scale = width / 2048;
    let yOffset = 80 * scale; // Start with some padding from top

    // === Crown (for boss agents) ===
    if (isBoss) {
      ctx.font = `${288 * scale}px serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText('👑', width / 2, yOffset);
      yOffset += 320 * scale;
    }

    // === Name label (no background, just text with outline) ===
    const fontSize = 224 * scale;
    const maxNameWidth = width - 240 * scale;
    ctx.font = `bold ${fontSize}px Arial`;

    // Truncate name if too long
    let displayName = name;
    let nameWidth = ctx.measureText(displayName).width;
    if (nameWidth > maxNameWidth) {
      while (displayName.length > 3 && ctx.measureText(displayName + '...').width > maxNameWidth) {
        displayName = displayName.slice(0, -1);
      }
      displayName += '...';
    }

    // Name text with thick outline for readability (no background)
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const nameY = yOffset + fontSize / 2;

    // Draw thick black outline
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 24 * scale;
    ctx.lineJoin = 'round';
    ctx.strokeText(displayName, width / 2, nameY);

    // Draw colored fill
    ctx.fillStyle = colorHex;
    ctx.fillText(displayName, width / 2, nameY);

    yOffset += fontSize + 64 * scale;

    // === Mana bar with status dot (same size for all agents) ===
    const manaBarHeight = 200 * scale;
    const manaBarWidth = 1350 * scale;
    const manaBarX = (width - manaBarWidth) / 2;
    const manaBarY = yOffset;

    // Status dot
    const dotSize = 176 * scale;
    const dotX = manaBarX + dotSize / 2 + 24 * scale;
    const dotY = manaBarY + manaBarHeight / 2;

    let dotColor: string;
    switch (status) {
      case 'working': dotColor = '#00a8ff'; break;      // Bright sky blue
      case 'orphaned': dotColor = '#e040ff'; break;     // Vivid magenta
      case 'error': dotColor = '#ff3030'; break;        // Bright red
      case 'waiting':
      case 'waiting_permission': dotColor = '#ffc000'; break; // Golden yellow
      default: dotColor = '#00e090';                    // Bright teal-green
    }

    ctx.beginPath();
    ctx.arc(dotX, dotY, dotSize / 2, 0, Math.PI * 2);
    ctx.fillStyle = dotColor;
    ctx.fill();
    ctx.shadowColor = dotColor;
    ctx.shadowBlur = 32 * scale;
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 12 * scale;
    ctx.stroke();

    // Mana bar background
    const barStartX = manaBarX + dotSize + 64 * scale;
    const barWidth = manaBarWidth - dotSize - 88 * scale;
    const barHeight = manaBarHeight - 48 * scale;
    const barY = manaBarY + 24 * scale;

    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.roundRect(barStartX, barY, barWidth, barHeight, 24 * scale);
    ctx.fill();
    ctx.strokeStyle = '#5a8a8a';
    ctx.lineWidth = 8 * scale;
    ctx.stroke();

    // Mana fill - vibrant colors
    const percentage = Math.max(0, Math.min(100, remainingPercent)) / 100;
    const fillPadding = 16 * scale;
    const fillWidth = Math.max(0, (barWidth - fillPadding * 2) * percentage);
    if (fillWidth > 0) {
      let fillColor: string;
      if (percentage > 0.5) fillColor = '#00ff88';      // Vibrant green
      else if (percentage > 0.2) fillColor = '#ffaa00'; // Vibrant orange
      else fillColor = '#ff3366';                       // Vibrant red/pink

      ctx.fillStyle = fillColor;
      ctx.beginPath();
      ctx.roundRect(barStartX + fillPadding, barY + fillPadding, fillWidth, barHeight - fillPadding * 2, 16 * scale);
      ctx.fill();
      ctx.shadowColor = fillColor;
      ctx.shadowBlur = 32 * scale;
      ctx.fill();
      ctx.shadowBlur = 0;
    }

    // Percentage text - centered in the bar with strong contrast
    const percentText = `${Math.round(percentage * 100)}%`;
    ctx.font = `bold ${128 * scale}px Arial`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const barCenterX = barStartX + barWidth / 2;
    const barCenterY = barY + barHeight / 2;

    // Draw thick black outline for strong contrast
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 28 * scale;
    ctx.lineJoin = 'round';
    ctx.strokeText(percentText, barCenterX, barCenterY);

    // Draw white fill with slight glow
    ctx.fillStyle = '#fff';
    ctx.shadowColor = '#000';
    ctx.shadowBlur = 8 * scale;
    ctx.fillText(percentText, barCenterX, barCenterY);
    ctx.shadowBlur = 0;

    yOffset += manaBarHeight + 48 * scale;

    // === Idle timer (only for idle agents) ===
    if (status === 'idle' && lastActivity > 0) {
      const idleSeconds = Math.floor((Date.now() - lastActivity) / 1000);
      const idleText = this.formatIdleTimeShort(idleSeconds);
      const colors = this.getIdleTimerColor(idleSeconds);

      ctx.font = `bold ${160 * scale}px Arial`;
      const idleTextWidth = ctx.measureText(`⏱ ${idleText}`).width;
      const idleBgWidth = idleTextWidth + 160 * scale;
      const idleBgHeight = 216 * scale;
      const idleBgX = (width - idleBgWidth) / 2;
      const idleBgY = yOffset;

      // Background
      ctx.fillStyle = 'rgba(0, 0, 0, 0.85)';
      ctx.beginPath();
      ctx.roundRect(idleBgX, idleBgY, idleBgWidth, idleBgHeight, 32 * scale);
      ctx.fill();

      // Border
      ctx.strokeStyle = colors.border;
      ctx.lineWidth = 12 * scale;
      ctx.stroke();

      // Text
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 16 * scale;
      ctx.strokeText(`⏱ ${idleText}`, width / 2, idleBgY + idleBgHeight / 2);
      ctx.fillStyle = colors.text;
      ctx.fillText(`⏱ ${idleText}`, width / 2, idleBgY + idleBgHeight / 2);
    }
  }

  /**
   * Create a text sprite for the agent's name.
   * @deprecated Use createCombinedUISprite instead for better performance
   */
  private createNameLabel(name: string, color: number, isBoss: boolean = false): THREE.Sprite {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d')!;

    const fontSize = 72;
    const padding = 32;
    const bgHeight = 100;
    const canvasHeight = 256;

    // Measure text to determine required canvas width
    canvas.width = 2048;
    canvas.height = canvasHeight;
    context.font = `bold ${fontSize}px Arial`;
    const measuredWidth = context.measureText(name).width;

    // Set canvas width to fit text (minimum 512 for short names)
    const minCanvasWidth = 512;
    const requiredWidth = measuredWidth + padding * 2 + 16;
    canvas.width = Math.max(minCanvasWidth, requiredWidth);

    // Clear canvas and reset context after resize
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.font = `bold ${fontSize}px Arial`;

    const bgWidth = measuredWidth + padding * 2;
    const bgX = (canvas.width - bgWidth) / 2;
    const bgY = (canvas.height - bgHeight) / 2;

    // Draw background (semi-transparent dark with rounded corners)
    context.fillStyle = 'rgba(0, 0, 0, 0.8)';
    context.beginPath();
    context.roundRect(bgX, bgY, bgWidth, bgHeight, 12);
    context.fill();

    // Draw text
    context.fillStyle = `#${color.toString(16).padStart(6, '0')}`;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(name, canvas.width / 2, canvas.height / 2);

    // Create texture with high quality filtering
    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.needsUpdate = true;

    // Create sprite material
    const material = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: false,
    });

    // Create sprite - scale must match canvas aspect ratio to avoid distortion
    const sprite = new THREE.Sprite(material);
    sprite.position.y = isBoss ? -0.2 : -0.3;
    const baseHeight = isBoss ? 0.75 : 0.6;
    // Scale width proportionally to canvas width (original: 512x256 canvas = 1.2x0.6 sprite)
    const baseWidth = isBoss ? 1.5 : 1.2;
    const widthScale = baseWidth * (canvas.width / 512);
    sprite.scale.set(widthScale, baseHeight, 1);
    sprite.name = 'nameLabel';
    // Store aspect ratio for SceneManager to use when scaling
    sprite.userData.aspectRatio = canvas.width / canvas.height;

    return sprite;
  }

  /**
   * Create a mana bar showing context remaining with status indicator.
   * @param remainingPercent - Percentage of context remaining (0-100)
   */
  private createManaBar(remainingPercent: number, status: string, isBoss: boolean = false): THREE.Sprite {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d')!;

    // Higher resolution for crisp rendering
    canvas.width = 400;
    canvas.height = 64;

    this.drawManaBar(ctx, canvas.width, canvas.height, remainingPercent, status);

    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.needsUpdate = true;

    const material = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: false,
    });

    const sprite = new THREE.Sprite(material);
    // Position higher for boss agents
    sprite.position.y = isBoss ? 3.0 : 2.0; // Below the name label
    sprite.scale.set(isBoss ? 1.4 : 1.1, isBoss ? 0.22 : 0.18, 1); // Wider to fit status dot + bar
    sprite.name = 'manaBar';

    return sprite;
  }

  /**
   * Draw the mana bar on a canvas context with status indicator.
   * @param remainingPercent - Percentage of context remaining (0-100)
   */
  private drawManaBar(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    remainingPercent: number,
    status: string
  ): void {
    // Convert percentage (0-100) to fraction (0-1)
    const percentage = Math.max(0, Math.min(100, remainingPercent)) / 100;

    // Clear canvas
    ctx.clearRect(0, 0, width, height);

    // Scale factors based on canvas size
    const scale = height / 32; // Base scale on height (32 was original)
    const dotSize = 20 * scale; // Status dot size
    const dotMargin = 6 * scale;
    const barX = dotSize + dotMargin + 4 * scale; // Start after the dot
    const barY = 6 * scale;
    const barWidth = width - barX - 10 * scale;
    const barHeight = height - 12 * scale;
    const borderRadius = 6 * scale;

    // Draw status dot (left side) - color based on status
    let dotColor: string;
    switch (status) {
      case 'working':
        dotColor = '#4a9eff'; // blue
        break;
      case 'orphaned':
        dotColor = '#ff00ff'; // magenta - untracked process running
        break;
      case 'error':
        dotColor = '#ff4a4a'; // red
        break;
      case 'waiting':
      case 'waiting_permission':
        dotColor = '#ffcc00'; // yellow/gold
        break;
      default:
        dotColor = '#4aff9e'; // green for idle
    }
    const dotX = dotSize / 2 + 4 * scale;
    const dotY = height / 2;

    ctx.beginPath();
    ctx.arc(dotX, dotY, dotSize / 2, 0, Math.PI * 2);
    ctx.fillStyle = dotColor;
    ctx.fill();

    // Dot glow
    ctx.shadowColor = dotColor;
    ctx.shadowBlur = 8 * scale;
    ctx.fill();
    ctx.shadowBlur = 0;

    // Dot border
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 2 * scale;
    ctx.stroke();

    // Background (solid black)
    ctx.fillStyle = '#000000';
    ctx.beginPath();
    ctx.roundRect(barX, barY, barWidth, barHeight, borderRadius);
    ctx.fill();

    // Muted border
    ctx.strokeStyle = '#5a8a8a';
    ctx.lineWidth = 2 * scale;
    ctx.stroke();

    // Mana fill - vibrant colors
    const fillWidth = Math.max(0, (barWidth - 4 * scale) * percentage);
    if (fillWidth > 0) {
      // Vibrant colors based on percentage
      let fillColor: string;
      let glowColor: string;

      if (percentage > 0.5) {
        fillColor = '#00ff88'; // Vibrant green
        glowColor = '#00ff88';
      } else if (percentage > 0.2) {
        fillColor = '#ffaa00'; // Vibrant orange
        glowColor = '#ffaa00';
      } else {
        fillColor = '#ff3366'; // Vibrant red/pink
        glowColor = '#ff3366';
      }

      ctx.fillStyle = fillColor;
      ctx.beginPath();
      ctx.roundRect(barX + 2 * scale, barY + 2 * scale, fillWidth, barHeight - 4 * scale, borderRadius - 2);
      ctx.fill();

      // Strong glow effect
      ctx.shadowColor = glowColor;
      ctx.shadowBlur = 8 * scale;
      ctx.fill();
      ctx.shadowBlur = 0;
    }

    // Percentage text - scale font size (75% of original)
    const percentText = `${Math.round(percentage * 100)}%`;
    ctx.font = `bold ${Math.round(24 * scale)}px Arial`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Thick black outline
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 4 * scale;
    ctx.strokeText(percentText, width / 2, height / 2);

    // Bright white fill
    ctx.fillStyle = '#ffffff';
    ctx.shadowColor = '#ffffff';
    ctx.shadowBlur = 2 * scale;
    ctx.fillText(percentText, width / 2, height / 2);
    ctx.shadowBlur = 0;

  }

  /**
   * Create an idle timer indicator showing time since last activity.
   */
  private createIdleTimer(status: string, lastActivity: number, isBoss: boolean = false): THREE.Sprite {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d')!;

    // Same canvas ratio as mana bar (400:64) for alignment
    canvas.width = 400;
    canvas.height = 64;

    this.drawIdleTimer(ctx, canvas.width, canvas.height, status, lastActivity);

    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.needsUpdate = true;

    const material = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: false,
    });

    const sprite = new THREE.Sprite(material);
    // Position higher for boss agents
    sprite.position.set(0, isBoss ? 3.5 : 2.4, 0); // Above mana bar
    sprite.scale.set(isBoss ? 1.4 : 1.1, isBoss ? 0.22 : 0.18, 1); // Same scale as mana bar for alignment
    sprite.name = 'idleTimer';

    return sprite;
  }

  /**
   * Create a crown indicator for boss agents.
   */
  private createBossCrown(): THREE.Sprite {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d')!;

    canvas.width = 128;
    canvas.height = 128;

    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw crown emoji
    ctx.font = '96px serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('👑', canvas.width / 2, canvas.height / 2);

    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.needsUpdate = true;

    const material = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: false,
    });

    const sprite = new THREE.Sprite(material);
    sprite.position.set(0, 4.0, 0); // Above the character's head (scaled for 1.5x)
    sprite.scale.set(0.8, 0.8, 1);
    sprite.name = 'bossCrown';

    return sprite;
  }

  /**
   * Get color for idle timer based on duration.
   * Uses a smooth gradient from green (0 min) to red (1+ hour).
   */
  private getIdleTimerColor(idleSeconds: number): { text: string; border: string } {
    // Gradual color transition from green to red over 1 hour
    // 0 min = green (120° hue), 60 min = red (0° hue)
    const maxMinutes = 60;
    const minutes = Math.min(idleSeconds / 60, maxMinutes);

    // Calculate hue: 120 (green) -> 0 (red)
    // Use a slight curve to stay green longer, then transition faster to red
    const progress = minutes / maxMinutes;
    const curvedProgress = Math.pow(progress, 0.7); // Slower start, faster end
    const hue = 120 * (1 - curvedProgress);

    // Keep saturation high and lightness at a good visible level
    const saturation = 80 + (20 * curvedProgress); // 80% -> 100% as it gets redder
    const lightness = 60 - (10 * curvedProgress);  // 60% -> 50% (slightly darker for red)

    const color = `hsl(${Math.round(hue)}, ${Math.round(saturation)}%, ${Math.round(lightness)}%)`;
    return { text: color, border: color };
  }

  /**
   * Draw the idle timer on a canvas context.
   */
  private drawIdleTimer(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    status: string,
    lastActivity: number
  ): void {
    // Clear canvas
    ctx.clearRect(0, 0, width, height);

    // Only show for idle agents with activity
    if (status !== 'idle' || lastActivity <= 0) {
      return;
    }

    // Calculate idle time
    const idleSeconds = Math.floor((Date.now() - lastActivity) / 1000);
    const idleText = this.formatIdleTimeShort(idleSeconds);
    const colors = this.getIdleTimerColor(idleSeconds);

    // Scale factor based on new height (80 is the base)
    const scale = height / 80;

    // Background pill - larger and more visible
    const padding = 24 * scale;
    ctx.font = `bold ${Math.round(44 * scale)}px Arial`;
    const textWidth = ctx.measureText(`⏱ ${idleText}`).width;
    const bgWidth = textWidth + padding * 2;
    const bgHeight = height - 12 * scale;
    const bgX = (width - bgWidth) / 2;
    const bgY = 6 * scale;

    // Draw background - more opaque
    ctx.fillStyle = 'rgba(0, 0, 0, 0.9)';
    ctx.beginPath();
    ctx.roundRect(bgX, bgY, bgWidth, bgHeight, 10 * scale);
    ctx.fill();

    // Border - color based on idle duration
    ctx.strokeStyle = colors.border;
    ctx.lineWidth = 3 * scale;
    ctx.stroke();

    // Draw text
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Text outline - thicker
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 4 * scale;
    ctx.strokeText(`⏱ ${idleText}`, width / 2, height / 2);

    // Text fill - color based on idle duration
    ctx.fillStyle = colors.text;
    ctx.fillText(`⏱ ${idleText}`, width / 2, height / 2);
  }

  /**
   * Format idle time for display in short format.
   */
  private formatIdleTimeShort(seconds: number): string {
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) {
      const secs = seconds % 60;
      return secs > 0 ? `${minutes}m ${secs}s` : `${minutes}m`;
    }
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    if (hours < 24) {
      return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
    }
    const days = Math.floor(hours / 24);
    return `${days}d`;
  }

  // Reusable canvases for updating sprites (avoid creating new canvases per frame)
  private idleTimerCanvas: HTMLCanvasElement | null = null;
  private idleTimerCtx: CanvasRenderingContext2D | null = null;
  private manaBarCanvas: HTMLCanvasElement | null = null;
  private manaBarCtx: CanvasRenderingContext2D | null = null;

  /**
   * Get or create the reusable idle timer canvas.
   */
  private getIdleTimerCanvas(): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
    if (!this.idleTimerCanvas) {
      this.idleTimerCanvas = document.createElement('canvas');
      this.idleTimerCanvas.width = 400;
      this.idleTimerCanvas.height = 64;
      this.idleTimerCtx = this.idleTimerCanvas.getContext('2d')!;
    }
    return { canvas: this.idleTimerCanvas, ctx: this.idleTimerCtx! };
  }

  /**
   * Get or create the reusable mana bar canvas.
   */
  private getManaBarCanvas(): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
    if (!this.manaBarCanvas) {
      this.manaBarCanvas = document.createElement('canvas');
      this.manaBarCanvas.width = 400;
      this.manaBarCanvas.height = 64;
      this.manaBarCtx = this.manaBarCanvas.getContext('2d')!;
    }
    return { canvas: this.manaBarCanvas, ctx: this.manaBarCtx! };
  }

  /**
   * Update the idle timer for an agent.
   */
  updateIdleTimer(group: THREE.Group, status: string, lastActivity: number): void {
    const idleTimer = group.getObjectByName('idleTimer') as THREE.Sprite;
    if (!idleTimer) return;

    const material = idleTimer.material as THREE.SpriteMaterial;
    if (!material.map) return;

    // Get the canvas that's already attached to this sprite's texture
    // Each sprite has its own canvas created in createIdleTimer
    const existingCanvas = material.map.image as HTMLCanvasElement;
    if (!existingCanvas || !(existingCanvas instanceof HTMLCanvasElement)) return;

    const ctx = existingCanvas.getContext('2d');
    if (!ctx) return;

    this.drawIdleTimer(ctx, existingCanvas.width, existingCanvas.height, status, lastActivity);

    // Mark texture as needing update
    material.map.needsUpdate = true;
  }

  /**
   * Update the mana bar for an agent.
   * Optimized: reuses canvas to avoid memory leaks.
   * @param remainingPercent - Percentage of context remaining (0-100)
   */
  updateManaBar(group: THREE.Group, remainingPercent: number, status: string): void {
    const manaBar = group.getObjectByName('manaBar') as THREE.Sprite;
    if (!manaBar) return;

    const material = manaBar.material as THREE.SpriteMaterial;
    if (!material.map) return;

    // Get the canvas that's already attached to this sprite's texture
    // Each sprite has its own canvas created in createManaBar
    const existingCanvas = material.map.image as HTMLCanvasElement;
    if (!existingCanvas || !(existingCanvas instanceof HTMLCanvasElement)) return;

    const ctx = existingCanvas.getContext('2d');
    if (!ctx) return;

    this.drawManaBar(ctx, existingCanvas.width, existingCanvas.height, remainingPercent, status);

    // Mark texture as needing update
    material.map.needsUpdate = true;
  }

  /**
   * Get color for a status string.
   */
  getStatusColor(status: string): number {
    return STATUS_COLORS[status] ?? STATUS_COLORS.default;
  }

  /**
   * Upgrade an agent's capsule body to a character model.
   * Returns the new AgentMeshData if upgrade was performed, null otherwise.
   */
  upgradeToCharacterModel(group: THREE.Group, agent: Agent): AgentMeshData | null {
    const existingBody = group.getObjectByName('characterBody');

    // Check if using fallback capsule
    if (!(existingBody instanceof THREE.Mesh)) return null;
    if (!(existingBody.geometry instanceof THREE.CapsuleGeometry)) return null;

    // Try to get character model
    const cloneResult = this.characterLoader.clone(agent.class);
    if (!cloneResult) return null;

    // Replace capsule with character model
    group.remove(existingBody);
    existingBody.geometry.dispose();
    (existingBody.material as THREE.Material).dispose();

    cloneResult.mesh.name = 'characterBody';
    group.add(cloneResult.mesh);

    // Create mixer for animations
    const mixer = new THREE.AnimationMixer(cloneResult.mesh);
    const animations = new Map<string, THREE.AnimationClip>();
    for (const clip of cloneResult.animations) {
      // Normalize to lowercase to match ANIMATIONS constants
      const normalizedName = clip.name.toLowerCase();
      animations.set(normalizedName, clip);
    }


    return {
      group,
      mixer,
      animations,
      currentAction: null,
    };
  }

  /**
   * Check if agent class changed and update the 3D model if needed.
   * Returns updated AgentMeshData if model was replaced, null otherwise.
   */
  updateAgentClass(meshData: AgentMeshData, agent: Agent): AgentMeshData | null {
    const { group } = meshData;
    const currentClass = group.userData.agentClass;

    // No change
    if (currentClass === agent.class) {
      return null;
    }

    console.log(`[CharacterFactory] Agent ${agent.name} class changed: ${currentClass} -> ${agent.class}`);

    // Get model info for the new class
    const modelInfo = this.getModelInfo(agent.class);

    let cloneResult: { mesh: THREE.Group; animations: THREE.AnimationClip[] } | null = null;

    // Try custom model first if applicable
    if (modelInfo.isCustomModel && modelInfo.customClassId) {
      cloneResult = this.characterLoader.cloneCustomModel(modelInfo.customClassId);
    }

    // Fall back to built-in model
    if (!cloneResult) {
      cloneResult = this.characterLoader.cloneByModelFile(modelInfo.file);
    }

    if (!cloneResult) {
      console.warn(`[CharacterFactory] Could not load model for class ${agent.class}, keeping current model`);
      group.userData.agentClass = agent.class; // Still update the class even if model fails
      return null;
    }

    // Find and remove the old character body
    const oldBody = group.getObjectByName('characterBody');
    if (oldBody) {
      group.remove(oldBody);
      // Dispose old body resources
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

    // Store custom model scale in userData for SceneManager to use
    // Don't apply scale here - let SceneManager handle all scaling uniformly
    const customModelScale = modelInfo.scale ?? 1.0;
    cloneResult.mesh.userData.customModelScale = customModelScale;

    // Mark if this is a custom model (GLB uploaded by user) for brightness adjustments
    cloneResult.mesh.userData.isCustomModel = modelInfo.isCustomModel;

    // Apply custom position offset if specified (x: horizontal, y: depth, z: vertical height)
    // Only apply if there are non-zero values to avoid overwriting default position
    if (modelInfo.offset && (modelInfo.offset.x !== 0 || modelInfo.offset.y !== 0 || modelInfo.offset.z !== 0)) {
      cloneResult.mesh.position.set(modelInfo.offset.x, modelInfo.offset.z, modelInfo.offset.y);
    }

    // Store custom class info for animation mapping
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
      // Also store with original name for custom animation mapping
      animations.set(clip.name, clip);
    }

    // Update stored class
    group.userData.agentClass = agent.class;

    // Update name label with new class color
    this.updateNameLabel(group, agent.name, agent.class);

    console.log(`[CharacterFactory] Agent ${agent.name} model updated to ${modelInfo.file}`);

    return {
      group,
      mixer,
      animations,
      currentAction: null,
    };
  }

  /**
   * Update visual state of an agent mesh.
   * @param isSubordinateOfSelectedBoss - true if this agent is a subordinate of the currently selected boss
   */
  updateVisuals(group: THREE.Group, agent: Agent, isSelected: boolean, isSubordinateOfSelectedBoss: boolean = false): void {
    const isBoss = agent.isBoss === true || agent.class === 'boss';
    const classConfig = this.getClassConfig(agent.class);
    const remainingPercent = getContextRemainingPercent(agent);

    // Update status bar sprite (new style)
    const statusBar = group.getObjectByName('statusBar') as THREE.Sprite;
    if (statusBar) {
      const material = statusBar.material as THREE.SpriteMaterial;
      if (material.map) {
        const canvas = material.map.image as HTMLCanvasElement;
        if (canvas instanceof HTMLCanvasElement) {
          const ctx = canvas.getContext('2d');
          if (ctx) {
            this.drawStatusBar(ctx, canvas.width, canvas.height, remainingPercent, agent.status, agent.lastActivity, isBoss);
            material.map.needsUpdate = true;
          }
        }
      }
    }

    // Update name label sprite if name changed (new style)
    const nameLabelSprite = group.getObjectByName('nameLabelSprite') as THREE.Sprite;
    if (nameLabelSprite && group.userData.agentName !== agent.name) {
      const material = nameLabelSprite.material as THREE.SpriteMaterial;
      if (material.map) {
        const canvas = material.map.image as HTMLCanvasElement;
        if (canvas instanceof HTMLCanvasElement) {
          const ctx = canvas.getContext('2d');
          if (ctx) {
            this.drawNameLabel(ctx, canvas.width, canvas.height, agent.name, classConfig.color);
            material.map.needsUpdate = true;
            group.userData.agentName = agent.name;
          }
        }
      }
    }

    // Fallback: Update combined UI sprite (legacy style)
    const combinedUI = group.getObjectByName('combinedUI') as THREE.Sprite;
    if (combinedUI) {
      const material = combinedUI.material as THREE.SpriteMaterial;
      if (material.map) {
        const canvas = material.map.image as HTMLCanvasElement;
        if (canvas instanceof HTMLCanvasElement) {
          const ctx = canvas.getContext('2d');
          if (ctx) {
            this.drawCombinedUI(
              ctx,
              canvas.width,
              canvas.height,
              agent.name,
              classConfig.color,
              remainingPercent,
              agent.status,
              agent.lastActivity,
              isBoss
            );
            material.map.needsUpdate = true;
          }
        }
      }
    }

    // Fallback for very old agents with completely separate sprites
    if (!statusBar && !combinedUI) {
      if (group.userData.agentName !== agent.name) {
        this.updateNameLabel(group, agent.name, agent.class);
        group.userData.agentName = agent.name;
      }
      this.updateManaBar(group, remainingPercent, agent.status);
      this.updateIdleTimer(group, agent.status, agent.lastActivity);
    }

    // Update selection ring visibility and color
    const selectionRing = group.getObjectByName('selectionRing') as THREE.Mesh;
    if (selectionRing) {
      const material = selectionRing.material as THREE.MeshBasicMaterial;
      if (isSelected) {
        // Normal selection - use agent's class color
        const builtInConfig = AGENT_CLASS_CONFIG[agent.class as BuiltInAgentClass];
        material.color.setHex(builtInConfig?.color ?? classConfig.color);
        material.opacity = 0.8;
      } else if (isSubordinateOfSelectedBoss) {
        // Subordinate of selected boss - gold ring to match boss
        material.color.setHex(0xffd700);
        material.opacity = 0.5;
      } else {
        // Not selected
        material.opacity = 0;
      }
    }
  }

  /**
   * Dispose of an agent mesh and all its resources.
   * Call this when removing an agent from the scene.
   */
  disposeAgentMesh(meshData: AgentMeshData): void {
    // Stop and clean up animation mixer
    if (meshData.mixer) {
      meshData.mixer.stopAllAction();
      meshData.mixer.uncacheRoot(meshData.group);
    }

    // Dispose all children in the group
    meshData.group.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.geometry?.dispose();
        if (Array.isArray(child.material)) {
          child.material.forEach(mat => {
            this.disposeMaterial(mat);
          });
        } else if (child.material) {
          this.disposeMaterial(child.material);
        }
      } else if (child instanceof THREE.Sprite) {
        this.disposeMaterial(child.material);
      } else if (child instanceof THREE.SkinnedMesh) {
        child.geometry?.dispose();
        if (Array.isArray(child.material)) {
          child.material.forEach(mat => {
            this.disposeMaterial(mat);
          });
        } else if (child.material) {
          this.disposeMaterial(child.material);
        }
      }
    });

    // Clear the group
    while (meshData.group.children.length > 0) {
      meshData.group.remove(meshData.group.children[0]);
    }

    // Clear animations map
    meshData.animations.clear();
  }

  /**
   * Dispose a material and its textures.
   */
  private disposeMaterial(material: THREE.Material): void {
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

  /**
   * Update the name label for an agent.
   */
  private updateNameLabel(group: THREE.Group, name: string, agentClass: string): void {
    const oldLabel = group.getObjectByName('nameLabel') as THREE.Sprite;
    if (oldLabel) {
      // Dispose old texture and material
      oldLabel.material.map?.dispose();
      oldLabel.material.dispose();
      group.remove(oldLabel);
    }

    // Create new label with class color
    const classConfig = AGENT_CLASS_CONFIG[agentClass as BuiltInAgentClass];
    const color = classConfig?.color ?? 0xffffff;
    const newLabel = this.createNameLabel(name, color);
    group.add(newLabel);
  }
}

// HMR: Accept updates without full reload - mark as pending for manual refresh
if (import.meta.hot) {
  import.meta.hot.accept(() => {
    console.log('[Tide HMR] CharacterFactory updated - pending refresh available');
    window.__tideHmrPendingSceneChanges = true;
  });
}
