import * as THREE from 'three';
import { TOOL_ICONS } from '../../utils/outputRendering';

/**
 * Move order effect data.
 */
interface MoveOrderEffect {
  group: THREE.Group;
  startTime: number;
  duration: number;
}

/**
 * Speech bubble effect data.
 */
interface SpeechBubbleEffect {
  sprite: THREE.Sprite;
  agentId: string;
  startTime: number;
  duration: number;
  baseY: number;
}

/**
 * Sleeping ZZZ effect data.
 */
interface SleepingEffect {
  sprites: THREE.Sprite[];
  agentId: string;
  startTime: number;
}

/**
 * Waiting permission effect data.
 */
interface WaitingPermissionEffect {
  sprites: THREE.Sprite[];
  agentId: string;
  startTime: number;
}

/**
 * Delegation effect data - paper flying from boss to subordinate.
 */
interface DelegationEffect {
  sprite: THREE.Sprite;
  startPosition: THREE.Vector3;
  endPosition: THREE.Vector3;
  startTime: number;
  duration: number;
}

/**
 * Pooled sprite for reuse
 */
interface PooledSprite {
  sprite: THREE.Sprite;
  inUse: boolean;
}

/**
 * Manages visual effects like move order indicators.
 * Optimized with geometry/material reuse and object pooling.
 */
export class EffectsManager {
  private scene: THREE.Scene;
  private moveOrderEffects: MoveOrderEffect[] = [];
  private speechBubbles: SpeechBubbleEffect[] = [];
  private sleepingEffects: SleepingEffect[] = [];
  private waitingPermissionEffects: WaitingPermissionEffect[] = [];
  private delegationEffects: DelegationEffect[] = [];
  private agentMeshes: Map<string, THREE.Group> = new Map();

  // ============================================
  // CACHED GEOMETRIES (created once, reused)
  // ============================================
  private ringGeometry: THREE.RingGeometry | null = null;
  private pulseGeometry: THREE.RingGeometry | null = null;
  private chevronGeometry: THREE.ShapeGeometry | null = null;

  // ============================================
  // CACHED TEXTURES (created once, reused)
  // ============================================
  private delegationPaperTexture: THREE.CanvasTexture | null = null;
  private sleepingBubbleTexture: THREE.CanvasTexture | null = null;
  private waitingPermissionTexture: THREE.CanvasTexture | null = null;

  // ============================================
  // OBJECT POOLS (reuse sprites/materials)
  // ============================================
  private delegationSpritePool: PooledSprite[] = [];
  private moveOrderGroupPool: THREE.Group[] = [];
  private static readonly POOL_SIZE = 10;

  // Track if scene needs redraw (dirty flag)
  private _needsUpdate = false;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.initializeCachedResources();
  }

  /**
   * Check if effects need to be rendered this frame.
   */
  get needsUpdate(): boolean {
    return this._needsUpdate ||
      this.moveOrderEffects.length > 0 ||
      this.speechBubbles.length > 0 ||
      this.sleepingEffects.length > 0 ||
      this.waitingPermissionEffects.length > 0 ||
      this.delegationEffects.length > 0;
  }

  /**
   * Mark effects as needing update.
   */
  markDirty(): void {
    this._needsUpdate = true;
  }

  /**
   * Clear dirty flag after update.
   */
  clearDirty(): void {
    this._needsUpdate = false;
  }

  /**
   * Initialize all cached geometries and textures once.
   */
  private initializeCachedResources(): void {
    // Create shared geometries
    this.ringGeometry = new THREE.RingGeometry(0.3, 0.4, 32);
    this.pulseGeometry = new THREE.RingGeometry(0.1, 0.2, 32);

    // Chevron shape geometry
    const chevronShape = new THREE.Shape();
    chevronShape.moveTo(0, 0.15);
    chevronShape.lineTo(0.12, 0.35);
    chevronShape.lineTo(0.08, 0.35);
    chevronShape.lineTo(0, 0.2);
    chevronShape.lineTo(-0.08, 0.35);
    chevronShape.lineTo(-0.12, 0.35);
    chevronShape.closePath();
    this.chevronGeometry = new THREE.ShapeGeometry(chevronShape);

    // Create cached textures
    this.createDelegationPaperTexture();
    this.createSleepingBubbleTexture();
    this.createWaitingPermissionTexture();

    // Pre-populate object pools
    this.initializePools();
  }

  /**
   * Initialize object pools for frequently created/destroyed objects.
   */
  private initializePools(): void {
    // Pre-create delegation sprites
    for (let i = 0; i < EffectsManager.POOL_SIZE; i++) {
      if (this.delegationPaperTexture) {
        const material = new THREE.SpriteMaterial({
          map: this.delegationPaperTexture,
          transparent: true,
          opacity: 0,
          depthTest: false,
        });
        const sprite = new THREE.Sprite(material);
        sprite.scale.set(0.3, 0.3, 1);
        sprite.visible = false;
        this.delegationSpritePool.push({ sprite, inUse: false });
      }
    }

    // Pre-create move order groups
    for (let i = 0; i < EffectsManager.POOL_SIZE; i++) {
      const group = this.createMoveOrderGroup();
      group.visible = false;
      this.moveOrderGroupPool.push(group);
    }
  }

  /**
   * Create a reusable move order group with shared geometries.
   */
  private createMoveOrderGroup(): THREE.Group {
    const group = new THREE.Group();

    // Ring (using shared geometry)
    const ringMaterial = new THREE.MeshBasicMaterial({
      color: 0x4aff9e,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.8,
    });
    const ring = new THREE.Mesh(this.ringGeometry!, ringMaterial);
    ring.rotation.x = -Math.PI / 2;
    ring.name = 'ring';
    group.add(ring);

    // Pulse ring (using shared geometry)
    const pulseMaterial = new THREE.MeshBasicMaterial({
      color: 0x4aff9e,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.6,
    });
    const pulse = new THREE.Mesh(this.pulseGeometry!, pulseMaterial);
    pulse.rotation.x = -Math.PI / 2;
    pulse.name = 'pulse';
    group.add(pulse);

    // Chevrons (using shared geometry)
    for (let i = 0; i < 3; i++) {
      const chevronMaterial = new THREE.MeshBasicMaterial({
        color: 0x4aff9e,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.9,
      });
      const chevron = new THREE.Mesh(this.chevronGeometry!, chevronMaterial);
      chevron.rotation.x = -Math.PI / 2;
      chevron.position.y = 0.5 + i * 0.25;
      chevron.name = `chevron${i}`;
      group.add(chevron);
    }

    return group;
  }

  /**
   * Get a sprite from the delegation pool or create new if pool exhausted.
   */
  private getDelegationSprite(): THREE.Sprite {
    // Find available sprite in pool
    for (const pooled of this.delegationSpritePool) {
      if (!pooled.inUse) {
        pooled.inUse = true;
        pooled.sprite.visible = true;
        pooled.sprite.material.opacity = 1;
        return pooled.sprite;
      }
    }

    // Pool exhausted, create new (will be cleaned up, not returned to pool)
    const material = new THREE.SpriteMaterial({
      map: this.delegationPaperTexture,
      transparent: true,
      opacity: 1,
      depthTest: false,
    });
    const sprite = new THREE.Sprite(material);
    sprite.scale.set(0.3, 0.3, 1);
    return sprite;
  }

  /**
   * Return a sprite to the delegation pool.
   */
  private returnDelegationSprite(sprite: THREE.Sprite): void {
    for (const pooled of this.delegationSpritePool) {
      if (pooled.sprite === sprite) {
        pooled.inUse = false;
        pooled.sprite.visible = false;
        this.scene.remove(sprite);
        return;
      }
    }
    // Not from pool, dispose it
    this.scene.remove(sprite);
    sprite.material.dispose();
  }

  /**
   * Get a move order group from pool or create new.
   */
  private getMoveOrderGroup(): THREE.Group {
    for (const group of this.moveOrderGroupPool) {
      if (!group.visible) {
        group.visible = true;
        // Reset materials
        group.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            const mat = child.material as THREE.MeshBasicMaterial;
            mat.opacity = child.name === 'ring' ? 0.8 : child.name === 'pulse' ? 0.6 : 0.9;
          }
        });
        return group;
      }
    }

    // Pool exhausted, create new
    return this.createMoveOrderGroup();
  }

  /**
   * Return a move order group to pool.
   */
  private returnMoveOrderGroup(group: THREE.Group): void {
    const pooled = this.moveOrderGroupPool.includes(group);
    if (pooled) {
      group.visible = false;
      this.scene.remove(group);
    } else {
      // Not from pool, dispose it
      this.scene.remove(group);
      group.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          // Don't dispose shared geometry
          (child.material as THREE.Material).dispose();
        }
      });
    }
  }

  /**
   * Create and cache the delegation paper texture (called once).
   */
  private createDelegationPaperTexture(): void {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d')!;
    canvas.width = 64;
    canvas.height = 64;

    // Draw paper document icon
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#ffd700'; // Gold border
    ctx.lineWidth = 2;

    // Paper shape
    ctx.save();
    ctx.translate(32, 32);
    ctx.rotate(-0.2);

    // Paper body
    ctx.beginPath();
    ctx.moveTo(-12, -18);
    ctx.lineTo(8, -18);
    ctx.lineTo(12, -14);
    ctx.lineTo(12, 18);
    ctx.lineTo(-12, 18);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Folded corner
    ctx.beginPath();
    ctx.moveTo(8, -18);
    ctx.lineTo(8, -14);
    ctx.lineTo(12, -14);
    ctx.strokeStyle = '#cccccc';
    ctx.stroke();
    ctx.fillStyle = '#f0f0f0';
    ctx.fill();

    // Lines on paper
    ctx.strokeStyle = '#888888';
    ctx.lineWidth = 1;
    for (let i = 0; i < 4; i++) {
      const y = -8 + i * 6;
      const width = i === 3 ? 10 : 16;
      ctx.beginPath();
      ctx.moveTo(-8, y);
      ctx.lineTo(-8 + width, y);
      ctx.stroke();
    }

    ctx.restore();

    // Create and cache texture
    this.delegationPaperTexture = new THREE.CanvasTexture(canvas);
    this.delegationPaperTexture.minFilter = THREE.LinearFilter;
    this.delegationPaperTexture.magFilter = THREE.LinearFilter;
  }

  /**
   * Create and cache the sleeping bubble texture (called once).
   */
  private createSleepingBubbleTexture(): void {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d')!;
    canvas.width = 128;
    canvas.height = 128;

    // Draw thought bubble background - compact
    ctx.fillStyle = 'rgba(40, 42, 54, 0.95)';
    ctx.strokeStyle = '#bd93f9'; // Dracula purple
    ctx.lineWidth = 2;

    // Main bubble - centered, smaller
    const bubbleX = 64, bubbleY = 50, bubbleR = 40;
    ctx.beginPath();
    ctx.arc(bubbleX, bubbleY, bubbleR, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Small connector bubbles - scaled down
    ctx.beginPath();
    ctx.arc(30, 95, 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(18, 115, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Draw ZZZ text - smaller
    ctx.fillStyle = '#8be9fd'; // Dracula cyan
    ctx.font = 'bold 28px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = '#8be9fd';
    ctx.shadowBlur = 4;
    ctx.fillText('ZZZ', bubbleX, bubbleY);

    // Create and cache texture
    this.sleepingBubbleTexture = new THREE.CanvasTexture(canvas);
    this.sleepingBubbleTexture.minFilter = THREE.LinearFilter;
    this.sleepingBubbleTexture.magFilter = THREE.LinearFilter;
  }

  /**
   * Create and cache the waiting permission texture (called once).
   */
  private createWaitingPermissionTexture(): void {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d')!;
    canvas.width = 128;
    canvas.height = 128;

    // Draw thought bubble background - compact
    ctx.fillStyle = 'rgba(40, 42, 54, 0.95)';
    ctx.strokeStyle = '#ffcc00'; // Yellow/gold for permission
    ctx.lineWidth = 2;

    // Main bubble - centered, smaller
    const bubbleX = 64, bubbleY = 50, bubbleR = 40;
    ctx.beginPath();
    ctx.arc(bubbleX, bubbleY, bubbleR, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Small connector bubbles - scaled down
    ctx.beginPath();
    ctx.arc(30, 95, 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(18, 115, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Draw lock icon (🔒) - smaller
    ctx.fillStyle = '#ffcc00'; // Yellow/gold
    ctx.font = 'bold 32px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = '#ffcc00';
    ctx.shadowBlur = 6;
    ctx.fillText('🔒', bubbleX, bubbleY);

    // Create and cache texture
    this.waitingPermissionTexture = new THREE.CanvasTexture(canvas);
    this.waitingPermissionTexture.minFilter = THREE.LinearFilter;
    this.waitingPermissionTexture.magFilter = THREE.LinearFilter;
  }

  /**
   * Set reference to agent meshes for tracking positions.
   */
  setAgentMeshes(meshes: Map<string, { group: THREE.Group }>): void {
    this.agentMeshes.clear();
    for (const [id, data] of meshes) {
      this.agentMeshes.set(id, data.group);
    }
  }

  /**
   * Update sleeping ZZZ effect for an agent.
   */
  updateSleepingEffect(agentId: string, isSleeping: boolean): void {
    const existingEffect = this.sleepingEffects.find(e => e.agentId === agentId);

    if (isSleeping && !existingEffect) {
      // Create sleeping effect
      this.createSleepingEffect(agentId);
    } else if (!isSleeping && existingEffect) {
      // Remove sleeping effect
      this.removeSleepingEffect(agentId);
    }
  }

  /**
   * Update waiting permission effect for an agent.
   */
  updateWaitingPermissionEffect(agentId: string, isWaitingPermission: boolean): void {
    const existingEffect = this.waitingPermissionEffects.find(e => e.agentId === agentId);

    if (isWaitingPermission && !existingEffect) {
      // Create waiting permission effect
      this.createWaitingPermissionEffect(agentId);
    } else if (!isWaitingPermission && existingEffect) {
      // Remove waiting permission effect
      this.removeWaitingPermissionEffect(agentId);
    }
  }

  /**
   * Create a sleeping bubble effect above an agent.
   * Optimized: uses cached texture instead of creating canvas per agent.
   */
  private createSleepingEffect(agentId: string): void {
    const agentGroup = this.agentMeshes.get(agentId);
    if (!agentGroup || !this.sleepingBubbleTexture) return;

    const sprites: THREE.Sprite[] = [];

    // Use cached texture - only create new material
    const bubbleMaterial = new THREE.SpriteMaterial({
      map: this.sleepingBubbleTexture,
      transparent: true,
      opacity: 0.95,
      depthTest: false,
    });

    const bubbleSprite = new THREE.Sprite(bubbleMaterial);
    // Tiny size
    bubbleSprite.scale.set(0.12, 0.12, 1);
    bubbleSprite.userData.isBubble = true;

    // Position above and to the side of agent's head
    bubbleSprite.position.copy(agentGroup.position);
    bubbleSprite.position.y = 2.0;
    bubbleSprite.position.x += 0.15;

    this.scene.add(bubbleSprite);
    sprites.push(bubbleSprite);

    this.sleepingEffects.push({
      sprites,
      agentId,
      startTime: performance.now(),
    });

    this.markDirty();
  }

  /**
   * Remove sleeping effect for an agent.
   * Note: Does not dispose shared texture, only material.
   */
  private removeSleepingEffect(agentId: string): void {
    const index = this.sleepingEffects.findIndex(e => e.agentId === agentId);
    if (index !== -1) {
      const effect = this.sleepingEffects[index];
      for (const sprite of effect.sprites) {
        this.scene.remove(sprite);
        // Don't dispose the shared texture, only the material
        sprite.material.dispose();
      }
      this.sleepingEffects.splice(index, 1);
      this.markDirty();
    }
  }

  /**
   * Create a waiting permission bubble effect above an agent.
   * Optimized: uses cached texture instead of creating canvas per agent.
   */
  private createWaitingPermissionEffect(agentId: string): void {
    const agentGroup = this.agentMeshes.get(agentId);
    if (!agentGroup || !this.waitingPermissionTexture) return;

    const sprites: THREE.Sprite[] = [];

    // Use cached texture - only create new material
    const bubbleMaterial = new THREE.SpriteMaterial({
      map: this.waitingPermissionTexture,
      transparent: true,
      opacity: 0.95,
      depthTest: false,
    });

    const bubbleSprite = new THREE.Sprite(bubbleMaterial);
    // Tiny size
    bubbleSprite.scale.set(0.12, 0.12, 1);
    bubbleSprite.userData.isBubble = true;

    // Position above and to the side of agent's head
    bubbleSprite.position.copy(agentGroup.position);
    bubbleSprite.position.y = 2.0;
    bubbleSprite.position.x += 0.15;

    this.scene.add(bubbleSprite);
    sprites.push(bubbleSprite);

    this.waitingPermissionEffects.push({
      sprites,
      agentId,
      startTime: performance.now(),
    });

    this.markDirty();
  }

  /**
   * Remove waiting permission effect for an agent.
   * Note: Does not dispose shared texture, only material.
   */
  private removeWaitingPermissionEffect(agentId: string): void {
    const index = this.waitingPermissionEffects.findIndex(e => e.agentId === agentId);
    if (index !== -1) {
      const effect = this.waitingPermissionEffects[index];
      for (const sprite of effect.sprites) {
        this.scene.remove(sprite);
        // Don't dispose the shared texture, only the material
        sprite.material.dispose();
      }
      this.waitingPermissionEffects.splice(index, 1);
      this.markDirty();
    }
  }

  /**
   * Create a delegation effect - paper/document flying from boss to subordinate.
   * Optimized: uses sprite pool to avoid allocation.
   */
  createDelegationEffect(bossId: string, subordinateId: string): void {
    const bossGroup = this.agentMeshes.get(bossId);
    const subGroup = this.agentMeshes.get(subordinateId);

    if (!bossGroup || !subGroup || !this.delegationPaperTexture) {
      console.log('[EffectsManager] Cannot create delegation effect - missing agent meshes or texture');
      return;
    }

    // Get sprite from pool (or create new if exhausted)
    const sprite = this.getDelegationSprite();

    // Start position (above boss)
    const startPos = new THREE.Vector3(
      bossGroup.position.x,
      bossGroup.position.y + 1.5,
      bossGroup.position.z
    );

    // End position (above subordinate)
    const endPos = new THREE.Vector3(
      subGroup.position.x,
      subGroup.position.y + 1.2,
      subGroup.position.z
    );

    sprite.position.copy(startPos);
    this.scene.add(sprite);

    this.delegationEffects.push({
      sprite,
      startPosition: startPos.clone(),
      endPosition: endPos.clone(),
      startTime: performance.now(),
      duration: 800, // Faster: 0.8 seconds for the flight
    });

    this.markDirty();
  }

  /**
   * Create a speech bubble effect above an agent.
   */
  createSpeechBubble(agentId: string, toolName: string, toolInput?: Record<string, unknown>): void {
    const agentGroup = this.agentMeshes.get(agentId);
    if (!agentGroup) return;

    // Remove existing bubble for this agent
    this.removeSpeechBubble(agentId);

    // Get tool icon
    const icon = TOOL_ICONS[toolName] || '🔧';

    // Extract key parameter to display
    const paramText = this.formatToolParams(toolName, toolInput);

    // Create compact single-line canvas (smaller size)
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d')!;
    canvas.width = 400;
    canvas.height = 100;

    // Build single-line text: "icon toolName param"
    const fullText = paramText ? `${icon} ${toolName}: ${paramText}` : `${icon} ${toolName}`;

    // Measure text to size bubble appropriately
    ctx.font = 'bold 32px Arial';
    const textWidth = Math.min(ctx.measureText(fullText).width, canvas.width - 40);

    // Draw speech bubble background - pill shape (compact)
    const padding = 16;
    const bubbleWidth = textWidth + padding * 2;
    const bubbleHeight = 48;
    const bubbleX = (canvas.width - bubbleWidth) / 2;
    const bubbleY = (canvas.height - bubbleHeight) / 2;
    const r = bubbleHeight / 2;

    ctx.fillStyle = 'rgba(15, 15, 25, 0.85)';
    ctx.strokeStyle = '#4a9eff';
    ctx.lineWidth = 2;

    // Draw pill shape
    ctx.beginPath();
    ctx.moveTo(bubbleX + r, bubbleY);
    ctx.lineTo(bubbleX + bubbleWidth - r, bubbleY);
    ctx.arc(bubbleX + bubbleWidth - r, bubbleY + r, r, -Math.PI / 2, Math.PI / 2);
    ctx.lineTo(bubbleX + r, bubbleY + bubbleHeight);
    ctx.arc(bubbleX + r, bubbleY + r, r, Math.PI / 2, -Math.PI / 2);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Draw single-line text
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 30px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Truncate if needed
    let displayText = fullText;
    const maxWidth = canvas.width - 40;
    while (ctx.measureText(displayText).width > maxWidth && displayText.length > 3) {
      displayText = displayText.slice(0, -4) + '...';
    }
    ctx.fillText(displayText, canvas.width / 2, canvas.height / 2);

    // Create sprite with high quality filtering
    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.needsUpdate = true;

    const material = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      opacity: 0,
      depthTest: false,
    });

    const sprite = new THREE.Sprite(material);
    // Match sprite scale to canvas aspect ratio (400:100 = 4:1) - smaller bubble
    sprite.scale.set(2.4, 0.6, 1);
    // Ensure speech bubbles render on top of other scene elements
    sprite.renderOrder = 1000;

    // Position at bottom, behind name label (below character)
    const baseY = agentGroup.position.y - 1.3;
    sprite.position.copy(agentGroup.position);
    sprite.position.y = baseY;

    this.scene.add(sprite);

    this.speechBubbles.push({
      sprite,
      agentId,
      startTime: performance.now(),
      duration: 4000, // Longer duration for reading params
      baseY,
    });
  }

  /**
   * Format tool parameters for display.
   */
  private formatToolParams(toolName: string, input?: Record<string, unknown>): string {
    if (!input) return '';

    // Extract the most relevant parameter based on tool type
    switch (toolName) {
      case 'WebSearch':
        return input.query as string || '';
      case 'WebFetch':
        return input.url as string || '';
      case 'Read':
      case 'Write':
      case 'Edit':
        const filePath = (input.file_path || input.path) as string || '';
        // Show just filename for long paths
        if (filePath.length > 40) {
          const parts = filePath.split('/');
          return '.../' + parts.slice(-2).join('/');
        }
        return filePath;
      case 'Bash':
        const cmd = (input.command as string || '').slice(0, 60);
        return cmd + (cmd.length >= 60 ? '...' : '');
      case 'Grep':
        return `"${input.pattern || ''}"`;
      case 'Glob':
        return input.pattern as string || '';
      case 'Task':
        return (input.description as string || '').slice(0, 50);
      default:
        // Try to find any string parameter
        for (const [_key, value] of Object.entries(input)) {
          if (typeof value === 'string' && value.length > 0 && value.length < 100) {
            return value.slice(0, 50);
          }
        }
        return '';
    }
  }

  /**
   * Remove speech bubble for an agent.
   */
  private removeSpeechBubble(agentId: string): void {
    const index = this.speechBubbles.findIndex(b => b.agentId === agentId);
    if (index !== -1) {
      const bubble = this.speechBubbles[index];
      this.scene.remove(bubble.sprite);
      bubble.sprite.material.map?.dispose();
      bubble.sprite.material.dispose();
      this.speechBubbles.splice(index, 1);
    }
  }

  /**
   * Create a move order effect at a position.
   * Optimized: uses object pool and shared geometries.
   */
  createMoveOrderEffect(position: THREE.Vector3): void {
    // Get group from pool (or create new if exhausted)
    const group = this.getMoveOrderGroup();
    group.position.copy(position);
    group.position.y = 0.05;

    // Reset chevron positions
    for (let i = 0; i < 3; i++) {
      const chevron = group.getObjectByName(`chevron${i}`) as THREE.Mesh;
      if (chevron) {
        chevron.position.y = 0.5 + i * 0.25;
      }
    }

    // Reset ring scale
    const ring = group.getObjectByName('ring') as THREE.Mesh;
    if (ring) ring.scale.setScalar(1);

    const pulse = group.getObjectByName('pulse') as THREE.Mesh;
    if (pulse) pulse.scale.setScalar(1);

    this.scene.add(group);
    this.moveOrderEffects.push({
      group,
      startTime: performance.now(),
      duration: 800,
    });

    this.markDirty();
  }

  // Reference to camera for zoom-based scaling
  private camera: THREE.Camera | null = null;
  // User-configurable indicator scale
  private indicatorScale = 1.0;

  /**
   * Set user-configurable indicator scale.
   */
  setIndicatorScale(scale: number): void {
    this.indicatorScale = scale;
  }

  /**
   * Update all active effects.
   */
  update(): void {
    const now = performance.now();

    // Update move order effects
    this.updateMoveOrderEffects(now);

    // Update speech bubbles
    this.updateSpeechBubbles(now);

    // Update sleeping effects
    this.updateSleepingEffects();

    // Update waiting permission effects
    this.updateWaitingPermissionEffects();

    // Update delegation effects
    this.updateDelegationEffects(now);
  }

  /**
   * Update effects with camera reference for zoom-based scaling.
   */
  updateWithCamera(camera: THREE.Camera): void {
    this.camera = camera;
  }

  /**
   * Calculate zoom-based scale factor for an effect at a position.
   */
  private calculateZoomScale(position: THREE.Vector3): number {
    if (!this.camera) return this.indicatorScale;

    const distance = this.camera.position.distanceTo(position);
    const baseDistance = 15;

    // Scale factor: farther = larger, closer = smaller
    // Clamp between 0.5 and 2.5
    const zoomScale = Math.max(0.5, Math.min(2.5, distance / baseDistance));

    // Apply user's indicator scale setting
    return zoomScale * this.indicatorScale;
  }

  /**
   * Update sleeping effects animation.
   */
  private updateSleepingEffects(): void {
    const now = performance.now();

    for (const effect of this.sleepingEffects) {
      const agentGroup = this.agentMeshes.get(effect.agentId);
      if (!agentGroup) continue;

      const elapsed = now - effect.startTime;

      // Calculate zoom-based scale
      const zoomScale = this.calculateZoomScale(agentGroup.position);

      for (const sprite of effect.sprites) {
        // Follow agent position
        sprite.position.x = agentGroup.position.x + 0.25 * zoomScale;
        sprite.position.z = agentGroup.position.z;

        // Gentle floating animation
        const floatSpeed = 0.002;
        const floatAmount = 0.04 * zoomScale;
        sprite.position.y = 2.0 + Math.sin(elapsed * floatSpeed) * floatAmount;

        // Gentle scale pulse with zoom-based scaling - small but visible
        const scaleBase = 0.35 * zoomScale;
        const scalePulse = Math.sin(elapsed * 0.003) * 0.015 * zoomScale;
        sprite.scale.set(scaleBase + scalePulse, scaleBase + scalePulse, 1);

        // Fade in on creation
        const fadeIn = Math.min(elapsed / 500, 1);
        sprite.material.opacity = 0.95 * fadeIn;
      }
    }
  }

  /**
   * Update waiting permission effects animation.
   */
  private updateWaitingPermissionEffects(): void {
    const now = performance.now();

    for (const effect of this.waitingPermissionEffects) {
      const agentGroup = this.agentMeshes.get(effect.agentId);
      if (!agentGroup) continue;

      const elapsed = now - effect.startTime;

      // Calculate zoom-based scale
      const zoomScale = this.calculateZoomScale(agentGroup.position);

      for (const sprite of effect.sprites) {
        // Follow agent position
        sprite.position.x = agentGroup.position.x + 0.25 * zoomScale;
        sprite.position.z = agentGroup.position.z;

        // More urgent pulsing animation (faster than sleeping)
        const pulseSpeed = 0.004;
        const pulseAmount = 0.06 * zoomScale;
        sprite.position.y = 2.0 + Math.sin(elapsed * pulseSpeed) * pulseAmount;

        // More pronounced scale pulse for urgency
        const scaleBase = 0.38 * zoomScale;
        const scalePulse = Math.sin(elapsed * 0.006) * 0.03 * zoomScale;
        sprite.scale.set(scaleBase + scalePulse, scaleBase + scalePulse, 1);

        // Pulsing opacity for attention-grabbing effect
        const fadeIn = Math.min(elapsed / 300, 1);
        const opacityPulse = 0.85 + Math.sin(elapsed * 0.005) * 0.1;
        sprite.material.opacity = opacityPulse * fadeIn;
      }
    }
  }

  /**
   * Update delegation effects - animate paper flying from boss to subordinate.
   * Optimized: minimal calculations per frame, no object creation.
   */
  private updateDelegationEffects(now: number): void {
    const toRemove: number[] = [];

    for (let i = 0; i < this.delegationEffects.length; i++) {
      const effect = this.delegationEffects[i];
      const t = Math.min((now - effect.startTime) / effect.duration, 1);

      // Simple quadratic ease-out (faster than cubic, smoother than linear)
      const ease = 1 - (1 - t) * (1 - t);

      // Direct position calculation (no lerpVectors call)
      const dx = effect.endPosition.x - effect.startPosition.x;
      const dy = effect.endPosition.y - effect.startPosition.y;
      const dz = effect.endPosition.z - effect.startPosition.z;

      // Arc uses simple parabola: 4 * t * (1 - t) peaks at 0.5
      const arc = 4 * t * (1 - t) * 0.8;

      effect.sprite.position.x = effect.startPosition.x + dx * ease;
      effect.sprite.position.y = effect.startPosition.y + dy * ease + arc;
      effect.sprite.position.z = effect.startPosition.z + dz * ease;

      // Single rotation over duration
      effect.sprite.material.rotation = t * Math.PI * 1.5;

      // Fade out last 20%
      effect.sprite.material.opacity = t > 0.8 ? (1 - t) * 5 : 1;

      if (t >= 1) {
        toRemove.push(i);
      }
    }

    // Return completed effects to pool
    for (let i = toRemove.length - 1; i >= 0; i--) {
      const idx = toRemove[i];
      const effect = this.delegationEffects[idx];
      this.returnDelegationSprite(effect.sprite);
      this.delegationEffects.splice(idx, 1);
    }
  }

  /**
   * Update move order effects.
   * Optimized: returns groups to pool instead of disposing.
   */
  private updateMoveOrderEffects(now: number): void {
    const toRemove: number[] = [];

    for (let i = 0; i < this.moveOrderEffects.length; i++) {
      const effect = this.moveOrderEffects[i];
      const elapsed = now - effect.startTime;
      const t = Math.min(elapsed / effect.duration, 1);
      const opacity = 1 - t;

      const ring = effect.group.getObjectByName('ring') as THREE.Mesh;
      if (ring) {
        ring.scale.setScalar(1 + t * 1.5);
        (ring.material as THREE.MeshBasicMaterial).opacity = opacity * 0.8;
      }

      const pulse = effect.group.getObjectByName('pulse') as THREE.Mesh;
      if (pulse) {
        const pulseT = (Math.sin(t * Math.PI * 4) + 1) / 2;
        pulse.scale.setScalar(0.8 + pulseT * 0.4);
        (pulse.material as THREE.MeshBasicMaterial).opacity = opacity * 0.6;
      }

      for (let j = 0; j < 3; j++) {
        const chevron = effect.group.getObjectByName(`chevron${j}`) as THREE.Mesh;
        if (chevron) {
          const delay = j * 0.15;
          const chevronT = Math.max(0, Math.min((t - delay) / (1 - delay), 1));
          chevron.position.y = 0.5 + j * 0.25 - chevronT * (0.4 + j * 0.15);
          (chevron.material as THREE.MeshBasicMaterial).opacity = (1 - chevronT) * 0.9;
        }
      }

      if (t >= 1) {
        toRemove.push(i);
      }
    }

    // Return completed effects to pool
    for (let i = toRemove.length - 1; i >= 0; i--) {
      const idx = toRemove[i];
      this.returnMoveOrderGroup(this.moveOrderEffects[idx].group);
      this.moveOrderEffects.splice(idx, 1);
    }
  }

  /**
   * Update speech bubble effects.
   */
  private updateSpeechBubbles(now: number): void {
    const toRemove: number[] = [];

    for (let i = 0; i < this.speechBubbles.length; i++) {
      const bubble = this.speechBubbles[i];
      const elapsed = now - bubble.startTime;
      const t = Math.min(elapsed / bubble.duration, 1);

      // Follow agent position
      const agentGroup = this.agentMeshes.get(bubble.agentId);
      if (agentGroup) {
        bubble.sprite.position.x = agentGroup.position.x;
        bubble.sprite.position.z = agentGroup.position.z;

        // Calculate zoom-based scale
        const zoomScale = this.calculateZoomScale(agentGroup.position);

        // Apply zoom-based scaling (4:1 aspect ratio to match canvas) - smaller bubble
        bubble.sprite.scale.set(2.4 * zoomScale, 0.6 * zoomScale, 1);
      }

      // Fade in/out animation (no bobbing at bottom)
      const fadeIn = Math.min(elapsed / 200, 1);
      const fadeOut = t > 0.7 ? 1 - ((t - 0.7) / 0.3) : 1;
      bubble.sprite.material.opacity = fadeIn * fadeOut;

      // Position at bottom, behind name label
      const agentY = agentGroup ? agentGroup.position.y : 0;
      bubble.sprite.position.y = agentY - 1.3;

      if (t >= 1) {
        toRemove.push(i);
      }
    }

    // Remove completed bubbles
    for (let i = toRemove.length - 1; i >= 0; i--) {
      const idx = toRemove[i];
      const bubble = this.speechBubbles[idx];
      this.scene.remove(bubble.sprite);
      bubble.sprite.material.map?.dispose();
      bubble.sprite.material.dispose();
      this.speechBubbles.splice(idx, 1);
    }
  }

  /**
   * Dispose of an effect and its resources (for non-pooled effects).
   */
  private disposeEffect(effect: MoveOrderEffect): void {
    this.scene.remove(effect.group);
    effect.group.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        // Don't dispose shared geometry
        (child.material as THREE.Material).dispose();
      }
    });
  }

  /**
   * Remove all effects for a specific agent.
   */
  removeAgentEffects(agentId: string): void {
    // Remove sleeping effect
    this.removeSleepingEffect(agentId);

    // Remove waiting permission effect
    this.removeWaitingPermissionEffect(agentId);

    // Remove speech bubble
    this.removeSpeechBubble(agentId);

    // Remove from agent meshes reference
    this.agentMeshes.delete(agentId);
  }

  /**
   * Clear all active effects (keeps pools and cached resources).
   */
  clear(): void {
    // Return move order groups to pool
    for (const effect of this.moveOrderEffects) {
      this.returnMoveOrderGroup(effect.group);
    }
    this.moveOrderEffects = [];

    // Clear sleeping effects (don't dispose shared texture)
    for (const effect of this.sleepingEffects) {
      for (const sprite of effect.sprites) {
        this.scene.remove(sprite);
        sprite.material.dispose();
      }
    }
    this.sleepingEffects = [];

    // Clear waiting permission effects (don't dispose shared texture)
    for (const effect of this.waitingPermissionEffects) {
      for (const sprite of effect.sprites) {
        this.scene.remove(sprite);
        sprite.material.dispose();
      }
    }
    this.waitingPermissionEffects = [];

    // Return delegation sprites to pool
    for (const effect of this.delegationEffects) {
      this.returnDelegationSprite(effect.sprite);
    }
    this.delegationEffects = [];

    // Clear speech bubbles
    for (const bubble of this.speechBubbles) {
      this.scene.remove(bubble.sprite);
      bubble.sprite.material.map?.dispose();
      bubble.sprite.material.dispose();
    }
    this.speechBubbles = [];
  }

  /**
   * Fully dispose all resources including pools and cached textures.
   * Call this when destroying the EffectsManager.
   */
  dispose(): void {
    // Clear all active effects first
    this.clear();

    // Dispose cached geometries
    this.ringGeometry?.dispose();
    this.pulseGeometry?.dispose();
    this.chevronGeometry?.dispose();
    this.ringGeometry = null;
    this.pulseGeometry = null;
    this.chevronGeometry = null;

    // Dispose cached textures
    this.delegationPaperTexture?.dispose();
    this.sleepingBubbleTexture?.dispose();
    this.waitingPermissionTexture?.dispose();
    this.delegationPaperTexture = null;
    this.sleepingBubbleTexture = null;
    this.waitingPermissionTexture = null;

    // Dispose delegation sprite pool
    for (const pooled of this.delegationSpritePool) {
      pooled.sprite.material.dispose();
    }
    this.delegationSpritePool = [];

    // Dispose move order group pool
    for (const group of this.moveOrderGroupPool) {
      group.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          (child.material as THREE.Material).dispose();
        }
      });
    }
    this.moveOrderGroupPool = [];

    // Clear agent meshes reference
    this.agentMeshes.clear();
  }
}

// HMR: Accept updates without full reload - mark as pending for manual refresh
if (import.meta.hot) {
  import.meta.hot.accept(() => {
    console.log('[Tide HMR] EffectsManager updated - pending refresh available');
    window.__tideHmrPendingSceneChanges = true;
  });
}
