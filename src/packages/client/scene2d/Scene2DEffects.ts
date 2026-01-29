/**
 * Scene2DEffects - Enhanced visual effects for 2D view
 *
 * Handles move order indicators, tool bubbles, boss connection lines,
 * status particles, and other visual feedback with smooth animations.
 */

import type { Scene2DCamera } from './Scene2DCamera';

// ============================================
// Effect Types
// ============================================

interface MoveOrderEffect {
  position: { x: number; z: number };
  startTime: number;
  duration: number;
}

interface ToolBubble {
  agentId: string;
  position: { x: number; z: number };
  text: string;
  startTime: number;
  duration: number;
}

interface StatusParticle {
  position: { x: number; z: number };
  velocity: { x: number; z: number };
  color: string;
  size: number;
  startTime: number;
  duration: number;
}

// ============================================
// Color Constants
// ============================================

const EFFECT_COLORS = {
  moveOrder: {
    primary: '#4aff9e',
    secondary: '#2ad87e',
    glow: 'rgba(74, 255, 158, 0.3)',
  },
  bossLine: {
    primary: '#ffd700',
    secondary: '#ffaa00',
    glow: 'rgba(255, 215, 0, 0.4)',
  },
  toolBubble: {
    background: ['#2a3040', '#1a2030'],
    border: '#4a9eff',
    text: '#ffffff',
  },
};

export class Scene2DEffects {
  private moveOrderEffects: MoveOrderEffect[] = [];
  private toolBubbles: Map<string, ToolBubble> = new Map();
  private statusParticles: StatusParticle[] = [];
  private animationTime = 0;

  update(deltaTime: number): void {
    const now = performance.now();
    this.animationTime += deltaTime;

    // Remove expired move order effects
    this.moveOrderEffects = this.moveOrderEffects.filter(
      effect => now - effect.startTime < effect.duration
    );

    // Remove expired tool bubbles
    for (const [id, bubble] of this.toolBubbles) {
      if (now - bubble.startTime >= bubble.duration) {
        this.toolBubbles.delete(id);
      }
    }

    // Remove expired particles
    this.statusParticles = this.statusParticles.filter(
      particle => now - particle.startTime < particle.duration
    );

    // Update particle positions
    for (const particle of this.statusParticles) {
      particle.position.x += particle.velocity.x * deltaTime;
      particle.position.z += particle.velocity.z * deltaTime;
      // Add gravity effect
      particle.velocity.z += deltaTime * 0.5;
    }
  }

  render(ctx: CanvasRenderingContext2D, camera: Scene2DCamera): void {
    const now = performance.now();

    // Render move order effects (below everything)
    for (const effect of this.moveOrderEffects) {
      this.renderMoveOrderEffect(ctx, camera, effect, now);
    }

    // Render status particles
    for (const particle of this.statusParticles) {
      this.renderStatusParticle(ctx, camera, particle, now);
    }

    // Render tool bubbles (above agents)
    for (const bubble of this.toolBubbles.values()) {
      this.renderToolBubble(ctx, camera, bubble, now);
    }
  }

  // ============================================
  // Move Order Effect - Enhanced with multiple rings and glow
  // ============================================

  addMoveOrderEffect(position: { x: number; z: number }): void {
    this.moveOrderEffects.push({
      position: { ...position },
      startTime: performance.now(),
      duration: 1500, // 1.5 seconds for smoother effect
    });
  }

  private renderMoveOrderEffect(
    ctx: CanvasRenderingContext2D,
    camera: Scene2DCamera,
    effect: MoveOrderEffect,
    now: number
  ): void {
    const progress = Math.min(1, Math.max(0, (now - effect.startTime) / effect.duration));
    const zoom = camera.getZoom();

    // Smooth ease-out for alpha
    const alpha = Math.pow(1 - progress, 1.5);

    camera.applyTransform(ctx);

    const { x, z } = effect.position;

    // Draw multiple expanding rings for ripple effect
    const ringCount = 3;
    for (let i = 0; i < ringCount; i++) {
      const ringProgress = Math.max(0, Math.min(1, progress * 1.5 - i * 0.15));
      if (ringProgress <= 0) continue;

      const ringAlpha = alpha * (1 - ringProgress) * (1 - i * 0.25);
      const radius = 0.3 + ringProgress * 2;
      const lineWidth = Math.max(1, (3 - ringProgress * 2)) / zoom;

      // Outer glow
      ctx.shadowColor = EFFECT_COLORS.moveOrder.glow;
      ctx.shadowBlur = 10 / zoom;

      // Create gradient stroke
      const gradient = ctx.createRadialGradient(x, z, radius * 0.8, x, z, radius * 1.2);
      gradient.addColorStop(0, this.hexToRgba(EFFECT_COLORS.moveOrder.primary, ringAlpha));
      gradient.addColorStop(1, this.hexToRgba(EFFECT_COLORS.moveOrder.secondary, ringAlpha * 0.5));

      ctx.strokeStyle = gradient;
      ctx.lineWidth = lineWidth;
      ctx.beginPath();
      ctx.arc(x, z, radius, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.shadowBlur = 0;

    // Animated crosshair/target marker at center
    const markerAlpha = alpha * 0.8;
    const markerSize = 0.25;
    const rotation = this.animationTime * 2;

    ctx.save();
    ctx.translate(x, z);
    ctx.rotate(rotation);

    // Draw crosshair lines
    ctx.strokeStyle = this.hexToRgba(EFFECT_COLORS.moveOrder.primary, markerAlpha);
    ctx.lineWidth = 2 / zoom;
    ctx.lineCap = 'round';

    const gap = markerSize * 0.3;
    const length = markerSize;

    ctx.beginPath();
    // Top
    ctx.moveTo(0, -gap);
    ctx.lineTo(0, -length);
    // Bottom
    ctx.moveTo(0, gap);
    ctx.lineTo(0, length);
    // Left
    ctx.moveTo(-gap, 0);
    ctx.lineTo(-length, 0);
    // Right
    ctx.moveTo(gap, 0);
    ctx.lineTo(length, 0);
    ctx.stroke();

    ctx.restore();

    // Center pulsing dot
    const pulsePhase = (now * 0.01) % 1;
    const dotSize = 0.06 + Math.sin(pulsePhase * Math.PI * 2) * 0.02;

    const dotGradient = ctx.createRadialGradient(x, z, 0, x, z, dotSize * 2);
    dotGradient.addColorStop(0, this.hexToRgba(EFFECT_COLORS.moveOrder.primary, markerAlpha));
    dotGradient.addColorStop(0.5, this.hexToRgba(EFFECT_COLORS.moveOrder.secondary, markerAlpha * 0.8));
    dotGradient.addColorStop(1, this.hexToRgba(EFFECT_COLORS.moveOrder.secondary, 0));

    ctx.fillStyle = dotGradient;
    ctx.beginPath();
    ctx.arc(x, z, dotSize * 2, 0, Math.PI * 2);
    ctx.fill();

    camera.restoreTransform(ctx);
  }

  // ============================================
  // Tool Bubble - Enhanced with gradients and better styling
  // ============================================

  addToolBubble(agentId: string, position: { x: number; z: number }, text: string): void {
    this.toolBubbles.set(agentId, {
      agentId,
      position: { ...position },
      text,
      startTime: performance.now(),
      duration: 4000, // 4 seconds
    });
  }

  updateToolBubblePosition(agentId: string, position: { x: number; z: number }): void {
    const bubble = this.toolBubbles.get(agentId);
    if (bubble) {
      bubble.position = { ...position };
    }
  }

  removeToolBubble(agentId: string): void {
    this.toolBubbles.delete(agentId);
  }

  private renderToolBubble(
    ctx: CanvasRenderingContext2D,
    camera: Scene2DCamera,
    bubble: ToolBubble,
    now: number
  ): void {
    const progress = (now - bubble.startTime) / bubble.duration;

    // Smooth fade in/out with easing
    let alpha = 1;
    if (progress < 0.1) {
      alpha = this.easeOutCubic(progress / 0.1);
    } else if (progress > 0.75) {
      alpha = this.easeInCubic((1 - progress) / 0.25);
    }

    // Gentle float and bob animation
    const floatOffset = Math.sin(progress * Math.PI * 4) * 0.03 + progress * 0.15;

    // Render in screen space for crisp text
    const screenPos = camera.worldToScreen(bubble.position.x, bubble.position.z - 1.2 - floatOffset);

    const fontSize = Math.max(11, Math.min(14, 12 * camera.getZoom()));
    ctx.font = `bold ${fontSize}px "Segoe UI", Arial, sans-serif`;

    const textMetrics = ctx.measureText(bubble.text);
    const textWidth = textMetrics.width;
    const padding = 10;
    const bubbleWidth = textWidth + padding * 2;
    const bubbleHeight = fontSize + padding * 1.5;
    const borderRadius = 6;

    const bubbleX = screenPos.x - bubbleWidth / 2;
    const bubbleY = screenPos.y - bubbleHeight / 2;

    // Drop shadow
    ctx.shadowColor = 'rgba(0, 0, 0, 0.4)';
    ctx.shadowBlur = 8;
    ctx.shadowOffsetY = 2;

    // Gradient background
    const bgGradient = ctx.createLinearGradient(
      bubbleX, bubbleY,
      bubbleX, bubbleY + bubbleHeight
    );
    bgGradient.addColorStop(0, this.hexToRgba(EFFECT_COLORS.toolBubble.background[0], alpha * 0.95));
    bgGradient.addColorStop(1, this.hexToRgba(EFFECT_COLORS.toolBubble.background[1], alpha * 0.98));

    ctx.fillStyle = bgGradient;
    ctx.beginPath();
    this.roundedRect(ctx, bubbleX, bubbleY, bubbleWidth, bubbleHeight, borderRadius);
    ctx.fill();

    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;

    // Subtle inner highlight at top
    const highlightGradient = ctx.createLinearGradient(
      bubbleX + borderRadius, bubbleY + 1,
      bubbleX + bubbleWidth - borderRadius, bubbleY + 1
    );
    highlightGradient.addColorStop(0, 'transparent');
    highlightGradient.addColorStop(0.2, `rgba(255, 255, 255, ${alpha * 0.15})`);
    highlightGradient.addColorStop(0.8, `rgba(255, 255, 255, ${alpha * 0.15})`);
    highlightGradient.addColorStop(1, 'transparent');

    ctx.strokeStyle = highlightGradient;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(bubbleX + borderRadius, bubbleY + 1);
    ctx.lineTo(bubbleX + bubbleWidth - borderRadius, bubbleY + 1);
    ctx.stroke();

    // Border with gradient
    const borderGradient = ctx.createLinearGradient(
      bubbleX, bubbleY,
      bubbleX, bubbleY + bubbleHeight
    );
    borderGradient.addColorStop(0, this.hexToRgba(EFFECT_COLORS.toolBubble.border, alpha * 0.8));
    borderGradient.addColorStop(1, this.hexToRgba(EFFECT_COLORS.toolBubble.border, alpha * 0.5));

    ctx.strokeStyle = borderGradient;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    this.roundedRect(ctx, bubbleX, bubbleY, bubbleWidth, bubbleHeight, borderRadius);
    ctx.stroke();

    // Pointer triangle with gradient
    const pointerWidth = 8;
    const pointerHeight = 6;
    const pointerX = screenPos.x;
    const pointerY = bubbleY + bubbleHeight;

    ctx.fillStyle = this.hexToRgba(EFFECT_COLORS.toolBubble.background[1], alpha * 0.98);
    ctx.beginPath();
    ctx.moveTo(pointerX - pointerWidth / 2, pointerY);
    ctx.lineTo(pointerX + pointerWidth / 2, pointerY);
    ctx.lineTo(pointerX, pointerY + pointerHeight);
    ctx.closePath();
    ctx.fill();

    // Pointer border
    ctx.strokeStyle = this.hexToRgba(EFFECT_COLORS.toolBubble.border, alpha * 0.6);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(pointerX - pointerWidth / 2 - 0.5, pointerY);
    ctx.lineTo(pointerX, pointerY + pointerHeight);
    ctx.lineTo(pointerX + pointerWidth / 2 + 0.5, pointerY);
    ctx.stroke();

    // Tool icon (wrench emoji or tool indicator)
    const iconSize = fontSize * 0.9;
    ctx.font = `${iconSize}px "Segoe UI Emoji", "Apple Color Emoji", serif`;
    ctx.fillStyle = this.hexToRgba('#ffcc00', alpha);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    // ctx.fillText('🔧', bubbleX + padding * 0.5, screenPos.y);

    // Text
    ctx.font = `bold ${fontSize}px "Segoe UI", Arial, sans-serif`;
    ctx.fillStyle = `rgba(255, 255, 255, ${alpha})`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(bubble.text, screenPos.x, screenPos.y);
  }

  // ============================================
  // Boss-Subordinate Connection Lines - Animated
  // ============================================

  renderBossLine(
    ctx: CanvasRenderingContext2D,
    camera: Scene2DCamera,
    from: { x: number; z: number },
    to: { x: number; z: number }
  ): void {
    camera.applyTransform(ctx);

    const zoom = camera.getZoom();

    // Calculate line properties
    const dx = to.x - from.x;
    const dz = to.z - from.z;
    const length = Math.sqrt(dx * dx + dz * dz);
    const angle = Math.atan2(dz, dx);

    // Animated dash offset for flowing effect
    const dashOffset = (this.animationTime * 30) % 24;

    // Create gradient along the line
    const gradient = ctx.createLinearGradient(from.x, from.z, to.x, to.z);
    gradient.addColorStop(0, this.hexToRgba(EFFECT_COLORS.bossLine.primary, 0.7));
    gradient.addColorStop(0.5, this.hexToRgba(EFFECT_COLORS.bossLine.secondary, 0.5));
    gradient.addColorStop(1, this.hexToRgba(EFFECT_COLORS.bossLine.primary, 0.7));

    // Outer glow line
    ctx.strokeStyle = EFFECT_COLORS.bossLine.glow;
    ctx.lineWidth = 6 / zoom;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(from.x, from.z);
    ctx.lineTo(to.x, to.z);
    ctx.stroke();

    // Main dashed line with animation
    ctx.strokeStyle = gradient;
    ctx.lineWidth = 2.5 / zoom;
    ctx.setLineDash([8 / zoom, 4 / zoom]);
    ctx.lineDashOffset = -dashOffset / zoom;

    ctx.beginPath();
    ctx.moveTo(from.x, from.z);
    ctx.lineTo(to.x, to.z);
    ctx.stroke();

    ctx.setLineDash([]);

    // Draw small decorative dots along the line
    const dotCount = Math.max(2, Math.floor(length / 1.5));
    const dotRadius = 0.06;

    for (let i = 0; i <= dotCount; i++) {
      const t = i / dotCount;
      const dotX = from.x + dx * t;
      const dotZ = from.z + dz * t;

      // Animate dot alpha based on position and time
      const pulseOffset = (this.animationTime * 2 + t * 5) % 1;
      const dotAlpha = 0.3 + Math.sin(pulseOffset * Math.PI * 2) * 0.2;

      ctx.fillStyle = this.hexToRgba(EFFECT_COLORS.bossLine.primary, dotAlpha);
      ctx.beginPath();
      ctx.arc(dotX, dotZ, dotRadius, 0, Math.PI * 2);
      ctx.fill();
    }

    // Arrow at the end pointing to subordinate
    const arrowSize = 0.2;
    const arrowAngle = Math.PI / 6;

    // Position arrow slightly before the end
    const arrowTip = {
      x: to.x - Math.cos(angle) * 0.3,
      z: to.z - Math.sin(angle) * 0.3,
    };

    ctx.fillStyle = this.hexToRgba(EFFECT_COLORS.bossLine.primary, 0.8);
    ctx.beginPath();
    ctx.moveTo(arrowTip.x, arrowTip.z);
    ctx.lineTo(
      arrowTip.x - Math.cos(angle - arrowAngle) * arrowSize,
      arrowTip.z - Math.sin(angle - arrowAngle) * arrowSize
    );
    ctx.lineTo(
      arrowTip.x - Math.cos(angle + arrowAngle) * arrowSize,
      arrowTip.z - Math.sin(angle + arrowAngle) * arrowSize
    );
    ctx.closePath();
    ctx.fill();

    camera.restoreTransform(ctx);
  }

  // ============================================
  // Status Change Particles
  // ============================================

  addStatusChangeEffect(position: { x: number; z: number }, color: string): void {
    const particleCount = 8;

    for (let i = 0; i < particleCount; i++) {
      const angle = (i / particleCount) * Math.PI * 2 + Math.random() * 0.5;
      const speed = 0.5 + Math.random() * 0.8;

      this.statusParticles.push({
        position: { ...position },
        velocity: {
          x: Math.cos(angle) * speed,
          z: Math.sin(angle) * speed - 1, // Initial upward velocity
        },
        color,
        size: 0.05 + Math.random() * 0.04,
        startTime: performance.now(),
        duration: 800 + Math.random() * 400,
      });
    }
  }

  private renderStatusParticle(
    ctx: CanvasRenderingContext2D,
    camera: Scene2DCamera,
    particle: StatusParticle,
    now: number
  ): void {
    const progress = (now - particle.startTime) / particle.duration;

    // Fade out with easing
    const alpha = this.easeOutCubic(1 - progress);

    // Shrink over time
    const size = particle.size * (1 - progress * 0.5);

    camera.applyTransform(ctx);

    const { x, z } = particle.position;

    // Particle glow
    ctx.shadowColor = particle.color;
    ctx.shadowBlur = 4 / camera.getZoom();

    // Gradient for sparkle effect
    const gradient = ctx.createRadialGradient(x, z, 0, x, z, size);
    gradient.addColorStop(0, this.hexToRgba('#ffffff', alpha));
    gradient.addColorStop(0.3, this.hexToRgba(particle.color, alpha));
    gradient.addColorStop(1, this.hexToRgba(particle.color, 0));

    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(x, z, size, 0, Math.PI * 2);
    ctx.fill();

    ctx.shadowBlur = 0;

    camera.restoreTransform(ctx);
  }

  // ============================================
  // Selection Sparkle Effect
  // ============================================

  addSelectionSparkle(position: { x: number; z: number }, color: string): void {
    // Add a few sparkle particles around the selection
    for (let i = 0; i < 4; i++) {
      const angle = Math.random() * Math.PI * 2;
      const distance = 0.3 + Math.random() * 0.2;

      this.statusParticles.push({
        position: {
          x: position.x + Math.cos(angle) * distance,
          z: position.z + Math.sin(angle) * distance,
        },
        velocity: {
          x: Math.cos(angle) * 0.3,
          z: -0.5 - Math.random() * 0.3,
        },
        color,
        size: 0.04 + Math.random() * 0.03,
        startTime: performance.now(),
        duration: 500 + Math.random() * 300,
      });
    }
  }

  // ============================================
  // Utilities
  // ============================================

  private roundedRect(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    width: number,
    height: number,
    radius: number
  ): void {
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + width - radius, y);
    ctx.arcTo(x + width, y, x + width, y + radius, radius);
    ctx.lineTo(x + width, y + height - radius);
    ctx.arcTo(x + width, y + height, x + width - radius, y + height, radius);
    ctx.lineTo(x + radius, y + height);
    ctx.arcTo(x, y + height, x, y + height - radius, radius);
    ctx.lineTo(x, y + radius);
    ctx.arcTo(x, y, x + radius, y, radius);
  }

  private hexToRgba(hex: string, alpha: number): string {
    // Handle both #rgb and #rrggbb formats
    let r: number, g: number, b: number;

    if (hex.startsWith('rgba') || hex.startsWith('rgb')) {
      // Already an rgb/rgba string, just adjust alpha
      const match = hex.match(/[\d.]+/g);
      if (match) {
        r = parseInt(match[0]);
        g = parseInt(match[1]);
        b = parseInt(match[2]);
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
      }
    }

    const cleanHex = hex.replace('#', '');
    if (cleanHex.length === 3) {
      r = parseInt(cleanHex[0] + cleanHex[0], 16);
      g = parseInt(cleanHex[1] + cleanHex[1], 16);
      b = parseInt(cleanHex[2] + cleanHex[2], 16);
    } else {
      r = parseInt(cleanHex.slice(0, 2), 16);
      g = parseInt(cleanHex.slice(2, 4), 16);
      b = parseInt(cleanHex.slice(4, 6), 16);
    }

    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  private easeOutCubic(t: number): number {
    return 1 - Math.pow(1 - t, 3);
  }

  private easeInCubic(t: number): number {
    return t * t * t;
  }

  // ============================================
  // Clear
  // ============================================

  clear(): void {
    this.moveOrderEffects = [];
    this.toolBubbles.clear();
    this.statusParticles = [];
  }
}
