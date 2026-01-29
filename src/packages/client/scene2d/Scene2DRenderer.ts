/**
 * Scene2DRenderer - Handles all 2D drawing operations
 *
 * Renders agents, buildings, areas, grid, and effects using Canvas 2D API.
 */

import type { Agent2DData, Building2DData, Area2DData } from './Scene2D';
import type { Scene2DCamera } from './Scene2DCamera';
import { AGENT_CLASS_CONFIG } from '../scene/config';
import type { BuiltInAgentClass, CustomAgentClass } from '../../shared/types';
import { store } from '../store';
import { TOOL_ICONS } from '../utils/outputRendering';

// Status colors with glow effects
const STATUS_COLORS: Record<string, { color: string; glow: string; darkColor: string }> = {
  idle: { color: '#4aff9e', glow: 'rgba(74, 255, 158, 0.6)', darkColor: '#2a9a5e' },
  working: { color: '#4a9eff', glow: 'rgba(74, 158, 255, 0.6)', darkColor: '#2a5e9a' },
  waiting: { color: '#ffcc00', glow: 'rgba(255, 204, 0, 0.6)', darkColor: '#9a7a00' },
  waiting_permission: { color: '#ffcc00', glow: 'rgba(255, 204, 0, 0.6)', darkColor: '#9a7a00' },
  error: { color: '#ff4a4a', glow: 'rgba(255, 74, 74, 0.6)', darkColor: '#9a2a2a' },
  orphaned: { color: '#ff00ff', glow: 'rgba(255, 0, 255, 0.6)', darkColor: '#9a009a' },
};

// Building style configuration - colors and emojis
const BUILDING_STYLES_CONFIG: Record<string, { color: string; darkColor: string; emoji: string }> = {
  'server-rack': { color: '#5a7a9a', darkColor: '#3a5a7a', emoji: '🖥️' },
  'desktop': { color: '#7a9a7a', darkColor: '#5a7a5a', emoji: '💻' },
  'filing-cabinet': { color: '#9a8a6a', darkColor: '#7a6a4a', emoji: '🗄️' },
  'factory': { color: '#9a6a6a', darkColor: '#7a4a4a', emoji: '🏭' },
  'satellite': { color: '#6a6a9a', darkColor: '#4a4a7a', emoji: '📡' },
  'crystal': { color: '#9a6a9a', darkColor: '#7a4a7a', emoji: '💎' },
  'tower': { color: '#6a9a9a', darkColor: '#4a7a7a', emoji: '🗼' },
  'dome': { color: '#7a7a9a', darkColor: '#5a5a7a', emoji: '🔮' },
  'pyramid': { color: '#9a9a6a', darkColor: '#7a7a4a', emoji: '🔺' },
  'command-center': { color: '#ba9a5a', darkColor: '#9a7a3a', emoji: '🏛️' },
};

export class Scene2DRenderer {
  private ctx: CanvasRenderingContext2D;
  private camera: Scene2DCamera;
  private animationTime = 0;

  constructor(ctx: CanvasRenderingContext2D, camera: Scene2DCamera) {
    this.ctx = ctx;
    this.camera = camera;
  }

  /**
   * Update animation time (call from render loop)
   */
  update(deltaTime: number): void {
    this.animationTime += deltaTime;
  }

  // ============================================
  // Ground & Grid
  // ============================================

  drawGround(_size: number): void {
    const { width, height } = this.camera.getViewportSize();

    // Draw a large radial gradient background in screen space
    // This creates a subtle vignette effect with dark edges
    const centerX = width / 2;
    const centerY = height / 2;
    const maxRadius = Math.sqrt(centerX * centerX + centerY * centerY) * 1.2;

    // Create radial gradient from center (slightly lighter) to edges (darker)
    const gradient = this.ctx.createRadialGradient(
      centerX, centerY, 0,
      centerX, centerY, maxRadius
    );

    // Dark theme with subtle blue-ish tint
    gradient.addColorStop(0, '#1a1f2e');     // Slightly lighter center
    gradient.addColorStop(0.5, '#141820');   // Mid-tone
    gradient.addColorStop(1, '#0a0c12');     // Dark edges (vignette)

    this.ctx.fillStyle = gradient;
    this.ctx.fillRect(0, 0, width, height);
  }

  drawGrid(size: number, spacing: number): void {
    const bounds = this.camera.getVisibleBounds();
    const zoom = this.camera.getZoom();

    // Calculate grid density - use larger spacing when zoomed out
    let actualSpacing = spacing;
    if (zoom < 20) actualSpacing = spacing * 2;
    if (zoom < 12) actualSpacing = spacing * 4;

    // Calculate visible grid lines (with some margin)
    const startX = Math.floor(bounds.minX / actualSpacing) * actualSpacing;
    const endX = Math.ceil(bounds.maxX / actualSpacing) * actualSpacing;
    const startZ = Math.floor(bounds.minZ / actualSpacing) * actualSpacing;
    const endZ = Math.ceil(bounds.maxZ / actualSpacing) * actualSpacing;

    this.camera.applyTransform(this.ctx);

    // Calculate fade distance from center (in world units)
    const fadeRadius = size * 0.4;
    const fadeStart = fadeRadius * 0.5;

    // Draw grid lines with distance-based alpha fade
    const lineWidth = 1 / zoom;

    // Draw vertical lines
    for (let x = startX; x <= endX; x += actualSpacing) {
      // Calculate alpha based on distance from origin (x-axis)
      const distFromOrigin = Math.abs(x);
      let alpha = this.calculateGridAlpha(distFromOrigin, fadeStart, fadeRadius);

      // Minor vs major lines (every 5th line is major)
      const isMajor = Math.abs(x) % (actualSpacing * 5) < 0.001;
      alpha *= isMajor ? 0.12 : 0.05;

      if (alpha > 0.005) {
        this.ctx.strokeStyle = `rgba(100, 140, 180, ${alpha})`;
        this.ctx.lineWidth = isMajor ? lineWidth * 1.5 : lineWidth;
        this.ctx.beginPath();
        this.ctx.moveTo(x, bounds.minZ);
        this.ctx.lineTo(x, bounds.maxZ);
        this.ctx.stroke();
      }
    }

    // Draw horizontal lines
    for (let z = startZ; z <= endZ; z += actualSpacing) {
      const distFromOrigin = Math.abs(z);
      let alpha = this.calculateGridAlpha(distFromOrigin, fadeStart, fadeRadius);

      const isMajor = Math.abs(z) % (actualSpacing * 5) < 0.001;
      alpha *= isMajor ? 0.12 : 0.05;

      if (alpha > 0.005) {
        this.ctx.strokeStyle = `rgba(100, 140, 180, ${alpha})`;
        this.ctx.lineWidth = isMajor ? lineWidth * 1.5 : lineWidth;
        this.ctx.beginPath();
        this.ctx.moveTo(bounds.minX, z);
        this.ctx.lineTo(bounds.maxX, z);
        this.ctx.stroke();
      }
    }

    this.camera.restoreTransform(this.ctx);

    // Draw origin marker in screen space for crisp rendering
    this.drawOriginMarker();

    // Draw coordinate labels if zoomed in enough
    if (zoom > 15) {
      this.drawCoordinateLabels(actualSpacing, fadeStart, fadeRadius);
    }
  }

  /**
   * Calculate alpha for grid elements based on distance from origin
   */
  private calculateGridAlpha(distance: number, fadeStart: number, fadeEnd: number): number {
    if (distance <= fadeStart) return 1;
    if (distance >= fadeEnd) return 0;
    // Smooth ease-out fade
    const t = (distance - fadeStart) / (fadeEnd - fadeStart);
    return 1 - (t * t);
  }

  /**
   * Draw a professional origin marker (crosshair style)
   */
  private drawOriginMarker(): void {
    const screenOrigin = this.camera.worldToScreen(0, 0);
    const { x, y } = screenOrigin;

    // Outer ring with glow
    const ringRadius = 12;

    // Subtle glow effect
    const glowGradient = this.ctx.createRadialGradient(x, y, 0, x, y, ringRadius * 2);
    glowGradient.addColorStop(0, 'rgba(74, 158, 255, 0.15)');
    glowGradient.addColorStop(1, 'rgba(74, 158, 255, 0)');
    this.ctx.fillStyle = glowGradient;
    this.ctx.beginPath();
    this.ctx.arc(x, y, ringRadius * 2, 0, Math.PI * 2);
    this.ctx.fill();

    // Crosshair lines (extend beyond the ring)
    const lineLength = 20;
    const gap = 6;
    this.ctx.strokeStyle = 'rgba(74, 158, 255, 0.4)';
    this.ctx.lineWidth = 1;
    this.ctx.beginPath();

    // Horizontal line (left segment)
    this.ctx.moveTo(x - lineLength, y);
    this.ctx.lineTo(x - gap, y);
    // Horizontal line (right segment)
    this.ctx.moveTo(x + gap, y);
    this.ctx.lineTo(x + lineLength, y);
    // Vertical line (top segment)
    this.ctx.moveTo(x, y - lineLength);
    this.ctx.lineTo(x, y - gap);
    // Vertical line (bottom segment)
    this.ctx.moveTo(x, y + gap);
    this.ctx.lineTo(x, y + lineLength);
    this.ctx.stroke();

    // Inner ring
    this.ctx.strokeStyle = 'rgba(74, 158, 255, 0.5)';
    this.ctx.lineWidth = 1.5;
    this.ctx.beginPath();
    this.ctx.arc(x, y, ringRadius, 0, Math.PI * 2);
    this.ctx.stroke();

    // Center dot
    this.ctx.fillStyle = 'rgba(74, 158, 255, 0.8)';
    this.ctx.beginPath();
    this.ctx.arc(x, y, 2, 0, Math.PI * 2);
    this.ctx.fill();

    // Small ticks at cardinal points on the ring
    const tickLength = 3;
    this.ctx.strokeStyle = 'rgba(74, 158, 255, 0.6)';
    this.ctx.lineWidth = 1;
    this.ctx.beginPath();
    // Top tick
    this.ctx.moveTo(x, y - ringRadius);
    this.ctx.lineTo(x, y - ringRadius + tickLength);
    // Bottom tick
    this.ctx.moveTo(x, y + ringRadius);
    this.ctx.lineTo(x, y + ringRadius - tickLength);
    // Left tick
    this.ctx.moveTo(x - ringRadius, y);
    this.ctx.lineTo(x - ringRadius + tickLength, y);
    // Right tick
    this.ctx.moveTo(x + ringRadius, y);
    this.ctx.lineTo(x + ringRadius - tickLength, y);
    this.ctx.stroke();
  }

  /**
   * Draw subtle coordinate labels at major grid intervals
   */
  private drawCoordinateLabels(spacing: number, fadeStart: number, fadeEnd: number): void {
    const bounds = this.camera.getVisibleBounds();

    // Only show labels at major intervals (every 5 units)
    const labelInterval = spacing * 5;
    const startX = Math.floor(bounds.minX / labelInterval) * labelInterval;
    const endX = Math.ceil(bounds.maxX / labelInterval) * labelInterval;
    const startZ = Math.floor(bounds.minZ / labelInterval) * labelInterval;
    const endZ = Math.ceil(bounds.maxZ / labelInterval) * labelInterval;

    this.ctx.font = '10px "SF Mono", "Monaco", "Consolas", monospace';
    this.ctx.textBaseline = 'middle';

    // X-axis labels (along the horizontal line through origin)
    for (let x = startX; x <= endX; x += labelInterval) {
      if (Math.abs(x) < 0.001) continue; // Skip origin label

      const distFromOrigin = Math.abs(x);
      const alpha = this.calculateGridAlpha(distFromOrigin, fadeStart, fadeEnd) * 0.4;

      if (alpha > 0.02) {
        const screenPos = this.camera.worldToScreen(x, 0);
        this.ctx.fillStyle = `rgba(100, 140, 180, ${alpha})`;
        this.ctx.textAlign = 'center';
        this.ctx.fillText(x.toString(), screenPos.x, screenPos.y + 16);
      }
    }

    // Z-axis labels (along the vertical line through origin)
    for (let z = startZ; z <= endZ; z += labelInterval) {
      if (Math.abs(z) < 0.001) continue; // Skip origin label

      const distFromOrigin = Math.abs(z);
      const alpha = this.calculateGridAlpha(distFromOrigin, fadeStart, fadeEnd) * 0.4;

      if (alpha > 0.02) {
        const screenPos = this.camera.worldToScreen(0, z);
        this.ctx.fillStyle = `rgba(100, 140, 180, ${alpha})`;
        this.ctx.textAlign = 'left';
        this.ctx.fillText(z.toString(), screenPos.x + 16, screenPos.y);
      }
    }
  }

  // ============================================
  // Areas
  // ============================================

  drawArea(area: Area2DData): void {
    this.camera.applyTransform(this.ctx);

    const { x, z } = area.position;
    const baseColor = area.color || '#4a9eff';
    const zoom = this.camera.getZoom();

    // Animation phase for dashed border
    const dashOffset = (this.animationTime * 20) % 24;

    if (area.type === 'rectangle' && 'width' in area.size) {
      const { width, height } = area.size;
      const left = x - width / 2;
      const top = z - height / 2;

      this.drawRectangleArea(left, top, width, height, baseColor, zoom, dashOffset);

      // Label at top edge
      if (area.label) {
        this.drawAreaLabel(area.label, x, top, baseColor, zoom, 'top');
      }
    } else if (area.type === 'circle' && 'radius' in area.size) {
      const { radius } = area.size;

      this.drawCircleArea(x, z, radius, baseColor, zoom, dashOffset);

      // Label at top of circle
      if (area.label) {
        this.drawAreaLabel(area.label, x, z - radius, baseColor, zoom, 'top');
      }
    }

    this.camera.restoreTransform(this.ctx);
  }

  private drawRectangleArea(
    left: number,
    top: number,
    width: number,
    height: number,
    baseColor: string,
    zoom: number,
    dashOffset: number
  ): void {
    const ctx = this.ctx;
    const cornerSize = Math.min(width, height) * 0.08;

    // Outer shadow (subtle glow)
    ctx.save();
    ctx.shadowColor = this.hexToRgba(baseColor, 0.4);
    ctx.shadowBlur = 12 / zoom;
    ctx.fillStyle = 'transparent';
    ctx.beginPath();
    ctx.rect(left, top, width, height);
    ctx.fill();
    ctx.restore();

    // Gradient fill - diagonal gradient for depth
    const gradient = ctx.createLinearGradient(left, top, left + width, top + height);
    gradient.addColorStop(0, this.hexToRgba(baseColor, 0.15));
    gradient.addColorStop(0.5, this.hexToRgba(baseColor, 0.08));
    gradient.addColorStop(1, this.hexToRgba(baseColor, 0.2));

    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.rect(left, top, width, height);
    ctx.fill();

    // Inner highlight line at top
    const innerHighlight = ctx.createLinearGradient(left, top, left + width, top);
    innerHighlight.addColorStop(0, 'transparent');
    innerHighlight.addColorStop(0.2, this.hexToRgba(baseColor, 0.3));
    innerHighlight.addColorStop(0.8, this.hexToRgba(baseColor, 0.3));
    innerHighlight.addColorStop(1, 'transparent');

    ctx.strokeStyle = innerHighlight;
    ctx.lineWidth = 2 / zoom;
    ctx.beginPath();
    ctx.moveTo(left + cornerSize, top + 2 / zoom);
    ctx.lineTo(left + width - cornerSize, top + 2 / zoom);
    ctx.stroke();

    // Inner shadow line at bottom
    const innerShadow = ctx.createLinearGradient(left, top + height, left + width, top + height);
    innerShadow.addColorStop(0, 'transparent');
    innerShadow.addColorStop(0.2, this.hexToRgba(this.darkenColor(baseColor, 0.5), 0.4));
    innerShadow.addColorStop(0.8, this.hexToRgba(this.darkenColor(baseColor, 0.5), 0.4));
    innerShadow.addColorStop(1, 'transparent');

    ctx.strokeStyle = innerShadow;
    ctx.lineWidth = 2 / zoom;
    ctx.beginPath();
    ctx.moveTo(left + cornerSize, top + height - 2 / zoom);
    ctx.lineTo(left + width - cornerSize, top + height - 2 / zoom);
    ctx.stroke();

    // Animated dashed border
    ctx.strokeStyle = this.hexToRgba(baseColor, 0.7);
    ctx.lineWidth = 2 / zoom;
    ctx.setLineDash([8 / zoom, 4 / zoom]);
    ctx.lineDashOffset = -dashOffset / zoom;

    ctx.beginPath();
    ctx.rect(left, top, width, height);
    ctx.stroke();

    ctx.setLineDash([]);

    // Corner decorations - L-shaped marks
    ctx.strokeStyle = this.hexToRgba(baseColor, 0.9);
    ctx.lineWidth = 3 / zoom;
    ctx.lineCap = 'round';

    // Top-left corner
    this.drawCornerMark(left, top, cornerSize, 'top-left');
    // Top-right corner
    this.drawCornerMark(left + width, top, cornerSize, 'top-right');
    // Bottom-left corner
    this.drawCornerMark(left, top + height, cornerSize, 'bottom-left');
    // Bottom-right corner
    this.drawCornerMark(left + width, top + height, cornerSize, 'bottom-right');

    // Small dots at corner intersections
    ctx.fillStyle = baseColor;
    const dotRadius = 3 / zoom;
    const corners = [
      { x: left, y: top },
      { x: left + width, y: top },
      { x: left, y: top + height },
      { x: left + width, y: top + height },
    ];
    for (const corner of corners) {
      ctx.beginPath();
      ctx.arc(corner.x, corner.y, dotRadius, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private drawCornerMark(
    x: number,
    y: number,
    size: number,
    position: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'
  ): void {
    const ctx = this.ctx;
    ctx.beginPath();

    switch (position) {
      case 'top-left':
        ctx.moveTo(x, y + size);
        ctx.lineTo(x, y);
        ctx.lineTo(x + size, y);
        break;
      case 'top-right':
        ctx.moveTo(x - size, y);
        ctx.lineTo(x, y);
        ctx.lineTo(x, y + size);
        break;
      case 'bottom-left':
        ctx.moveTo(x, y - size);
        ctx.lineTo(x, y);
        ctx.lineTo(x + size, y);
        break;
      case 'bottom-right':
        ctx.moveTo(x - size, y);
        ctx.lineTo(x, y);
        ctx.lineTo(x, y - size);
        break;
    }

    ctx.stroke();
  }

  private drawCircleArea(
    cx: number,
    cy: number,
    radius: number,
    baseColor: string,
    zoom: number,
    dashOffset: number
  ): void {
    const ctx = this.ctx;

    // Outer glow
    ctx.save();
    ctx.shadowColor = this.hexToRgba(baseColor, 0.4);
    ctx.shadowBlur = 12 / zoom;
    ctx.fillStyle = 'transparent';
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Radial gradient fill
    const gradient = ctx.createRadialGradient(cx, cy - radius * 0.3, 0, cx, cy, radius);
    gradient.addColorStop(0, this.hexToRgba(baseColor, 0.2));
    gradient.addColorStop(0.6, this.hexToRgba(baseColor, 0.1));
    gradient.addColorStop(1, this.hexToRgba(baseColor, 0.18));

    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fill();

    // Inner highlight arc at top
    const highlightGradient = ctx.createLinearGradient(
      cx - radius * 0.7,
      cy - radius,
      cx + radius * 0.7,
      cy - radius
    );
    highlightGradient.addColorStop(0, 'transparent');
    highlightGradient.addColorStop(0.3, this.hexToRgba(baseColor, 0.4));
    highlightGradient.addColorStop(0.7, this.hexToRgba(baseColor, 0.4));
    highlightGradient.addColorStop(1, 'transparent');

    ctx.strokeStyle = highlightGradient;
    ctx.lineWidth = 2 / zoom;
    ctx.beginPath();
    ctx.arc(cx, cy, radius - 2 / zoom, -Math.PI * 0.8, -Math.PI * 0.2);
    ctx.stroke();

    // Animated dashed border
    ctx.strokeStyle = this.hexToRgba(baseColor, 0.7);
    ctx.lineWidth = 2 / zoom;
    ctx.setLineDash([8 / zoom, 4 / zoom]);
    ctx.lineDashOffset = -dashOffset / zoom;

    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.stroke();

    ctx.setLineDash([]);

    // Decorative dots around perimeter (like compass points)
    const dotCount = 8;
    const dotRadius = 3 / zoom;
    ctx.fillStyle = baseColor;

    for (let i = 0; i < dotCount; i++) {
      const angle = (i / dotCount) * Math.PI * 2 - Math.PI / 2;
      const dotX = cx + Math.cos(angle) * radius;
      const dotY = cy + Math.sin(angle) * radius;

      ctx.beginPath();
      ctx.arc(dotX, dotY, dotRadius, 0, Math.PI * 2);
      ctx.fill();
    }

    // Larger dots at cardinal points
    const cardinalDotRadius = 4.5 / zoom;
    for (let i = 0; i < 4; i++) {
      const angle = (i / 4) * Math.PI * 2 - Math.PI / 2;
      const dotX = cx + Math.cos(angle) * radius;
      const dotY = cy + Math.sin(angle) * radius;

      ctx.beginPath();
      ctx.arc(dotX, dotY, cardinalDotRadius, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private drawAreaLabel(
    label: string,
    x: number,
    y: number,
    baseColor: string,
    zoom: number,
    position: 'top' | 'center'
  ): void {
    const ctx = this.ctx;
    const fontSize = 11 / zoom;
    const padding = 6 / zoom;
    const offsetY = position === 'top' ? -8 / zoom : 0;

    ctx.font = `bold ${fontSize}px "Segoe UI", Arial, sans-serif`;
    const textMetrics = ctx.measureText(label);
    const textWidth = textMetrics.width;
    const textHeight = fontSize;

    const bgWidth = textWidth + padding * 2;
    const bgHeight = textHeight + padding;
    const bgX = x - bgWidth / 2;
    const bgY = y + offsetY - bgHeight / 2;
    const borderRadius = 4 / zoom;

    // Label background with gradient
    const bgGradient = ctx.createLinearGradient(bgX, bgY, bgX, bgY + bgHeight);
    bgGradient.addColorStop(0, this.hexToRgba(this.darkenColor(baseColor, 0.7), 0.9));
    bgGradient.addColorStop(1, this.hexToRgba(this.darkenColor(baseColor, 0.5), 0.9));

    ctx.fillStyle = bgGradient;
    ctx.beginPath();
    this.roundedRect(bgX, bgY, bgWidth, bgHeight, borderRadius);
    ctx.fill();

    // Label border
    ctx.strokeStyle = this.hexToRgba(baseColor, 0.8);
    ctx.lineWidth = 1.5 / zoom;
    ctx.beginPath();
    this.roundedRect(bgX, bgY, bgWidth, bgHeight, borderRadius);
    ctx.stroke();

    // Label text with subtle shadow
    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
    ctx.shadowBlur = 2 / zoom;
    ctx.shadowOffsetY = 1 / zoom;

    ctx.fillStyle = this.lightenColor(baseColor, 0.3);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, x, y + offsetY);

    ctx.restore();
  }

  // ============================================
  // Boss Lines
  // ============================================

  drawBossLine(from: { x: number; z: number }, to: { x: number; z: number }): void {
    this.camera.applyTransform(this.ctx);

    this.ctx.strokeStyle = 'rgba(255, 215, 0, 0.4)'; // Gold
    this.ctx.lineWidth = 2 / this.camera.getZoom();
    this.ctx.setLineDash([4 / this.camera.getZoom(), 4 / this.camera.getZoom()]);

    this.ctx.beginPath();
    this.ctx.moveTo(from.x, from.z);
    this.ctx.lineTo(to.x, to.z);
    this.ctx.stroke();

    this.ctx.setLineDash([]);

    this.camera.restoreTransform(this.ctx);
  }

  // ============================================
  // Buildings
  // ============================================

  drawBuilding(building: Building2DData, isSelected: boolean, isHovered: boolean = false): void {
    const { x, z } = building.position;
    const baseSize = 1.8 * building.scale;
    const styleConfig = BUILDING_STYLES_CONFIG[building.style] || BUILDING_STYLES_CONFIG['server-rack'];
    const statusConfig = STATUS_COLORS[building.status] || STATUS_COLORS.idle;

    // Use custom color if provided, otherwise use style color
    let mainColor = styleConfig.color;
    let darkColor = styleConfig.darkColor;
    if (building.color) {
      mainColor = building.color;
      darkColor = this.darkenColor(building.color, 0.3);
    }

    // ---- Draw drop shadow (in world space) ----
    this.camera.applyTransform(this.ctx);

    const shadowOffsetX = 0.08;
    const shadowOffsetY = 0.12;

    this.ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
    this.ctx.beginPath();
    this.roundedRect(
      x - baseSize / 2 + shadowOffsetX,
      z - baseSize / 2 + shadowOffsetY,
      baseSize,
      baseSize,
      0.15
    );
    this.ctx.fill();

    // ---- Selection glow effect ----
    if (isSelected) {
      const glowPulse = 0.5 + Math.sin(this.animationTime * 4) * 0.2;
      this.ctx.shadowColor = 'rgba(255, 255, 255, 0.8)';
      this.ctx.shadowBlur = 15 / this.camera.getZoom();
      this.ctx.strokeStyle = `rgba(255, 255, 255, ${glowPulse})`;
      this.ctx.lineWidth = 4 / this.camera.getZoom();
      this.ctx.beginPath();
      this.roundedRect(x - baseSize / 2 - 0.05, z - baseSize / 2 - 0.05, baseSize + 0.1, baseSize + 0.1, 0.2);
      this.ctx.stroke();
      this.ctx.shadowBlur = 0;
    }

    // ---- Hover glow effect ----
    if (isHovered && !isSelected) {
      this.ctx.shadowColor = mainColor;
      this.ctx.shadowBlur = 10 / this.camera.getZoom();
      this.ctx.strokeStyle = `rgba(255, 255, 255, 0.4)`;
      this.ctx.lineWidth = 2 / this.camera.getZoom();
      this.ctx.beginPath();
      this.roundedRect(x - baseSize / 2, z - baseSize / 2, baseSize, baseSize, 0.15);
      this.ctx.stroke();
      this.ctx.shadowBlur = 0;
    }

    // ---- Pseudo-3D building body with gradient ----
    const gradient = this.ctx.createLinearGradient(
      x - baseSize / 2, z - baseSize / 2,
      x + baseSize / 2, z + baseSize / 2
    );
    gradient.addColorStop(0, this.lightenColor(mainColor, 0.2));
    gradient.addColorStop(0.3, mainColor);
    gradient.addColorStop(1, darkColor);

    this.ctx.fillStyle = gradient;
    this.ctx.beginPath();
    this.roundedRect(x - baseSize / 2, z - baseSize / 2, baseSize, baseSize, 0.15);
    this.ctx.fill();

    // ---- Inner highlight (top edge) for 3D depth ----
    this.ctx.strokeStyle = `rgba(255, 255, 255, 0.25)`;
    this.ctx.lineWidth = 2 / this.camera.getZoom();
    this.ctx.beginPath();
    this.ctx.moveTo(x - baseSize / 2 + 0.15, z - baseSize / 2 + 0.02);
    this.ctx.lineTo(x + baseSize / 2 - 0.15, z - baseSize / 2 + 0.02);
    this.ctx.stroke();

    // ---- Inner shadow (bottom edge) for 3D depth ----
    this.ctx.strokeStyle = `rgba(0, 0, 0, 0.3)`;
    this.ctx.lineWidth = 2 / this.camera.getZoom();
    this.ctx.beginPath();
    this.ctx.moveTo(x - baseSize / 2 + 0.15, z + baseSize / 2 - 0.02);
    this.ctx.lineTo(x + baseSize / 2 - 0.15, z + baseSize / 2 - 0.02);
    this.ctx.stroke();

    // ---- Border based on status with pulsing glow ----
    const borderGlow = 0.6 + Math.sin(this.animationTime * 3) * 0.15;
    this.ctx.strokeStyle = this.hexToRgba(statusConfig.color, borderGlow);
    this.ctx.lineWidth = 3 / this.camera.getZoom();
    this.ctx.beginPath();
    this.roundedRect(x - baseSize / 2, z - baseSize / 2, baseSize, baseSize, 0.15);
    this.ctx.stroke();

    // ---- Outer subtle border ----
    this.ctx.strokeStyle = 'rgba(0, 0, 0, 0.4)';
    this.ctx.lineWidth = 1 / this.camera.getZoom();
    this.ctx.beginPath();
    this.roundedRect(x - baseSize / 2 - 0.02, z - baseSize / 2 - 0.02, baseSize + 0.04, baseSize + 0.04, 0.17);
    this.ctx.stroke();

    // ---- Status indicator dot (top-right corner) ----
    const indicatorRadius = 0.18 * building.scale;
    const indicatorX = x + baseSize / 2 - indicatorRadius - 0.1;
    const indicatorY = z - baseSize / 2 + indicatorRadius + 0.1;

    // Indicator glow
    this.ctx.shadowColor = statusConfig.color;
    this.ctx.shadowBlur = 8 / this.camera.getZoom();

    // Indicator background
    this.ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
    this.ctx.beginPath();
    this.ctx.arc(indicatorX, indicatorY, indicatorRadius + 0.03, 0, Math.PI * 2);
    this.ctx.fill();

    // Indicator dot with gradient
    const indicatorGradient = this.ctx.createRadialGradient(
      indicatorX - indicatorRadius * 0.3, indicatorY - indicatorRadius * 0.3, 0,
      indicatorX, indicatorY, indicatorRadius
    );
    indicatorGradient.addColorStop(0, this.lightenColor(statusConfig.color, 0.4));
    indicatorGradient.addColorStop(1, statusConfig.color);

    this.ctx.fillStyle = indicatorGradient;
    this.ctx.beginPath();
    this.ctx.arc(indicatorX, indicatorY, indicatorRadius, 0, Math.PI * 2);
    this.ctx.fill();

    this.ctx.shadowBlur = 0;

    this.camera.restoreTransform(this.ctx);

    // ---- Building emoji (render in screen space for proper sizing) ----
    const screenPos = this.camera.worldToScreen(x, z);
    const emojiSize = Math.max(20, Math.min(40, 28 * this.camera.getZoom() * building.scale));

    this.ctx.font = `${emojiSize}px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", serif`;
    this.ctx.textAlign = 'center';
    this.ctx.textBaseline = 'middle';

    // Subtle emoji shadow
    this.ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
    this.ctx.fillText(styleConfig.emoji, screenPos.x + 1, screenPos.y + 1);

    // Main emoji
    this.ctx.fillText(styleConfig.emoji, screenPos.x, screenPos.y);

    // ---- Name label with styled background ----
    const labelScreenPos = this.camera.worldToScreen(x, z + baseSize / 2 + 0.25);
    const fontSize = Math.max(10, Math.min(14, 12 * this.camera.getZoom()));

    this.ctx.font = `bold ${fontSize}px "Segoe UI", Arial, sans-serif`;
    const nameWidth = this.ctx.measureText(building.name).width;
    const labelPadding = 6;
    const labelHeight = fontSize + 6;

    // Label background with gradient
    const labelBgGradient = this.ctx.createLinearGradient(
      labelScreenPos.x - nameWidth / 2 - labelPadding,
      labelScreenPos.y - labelHeight / 2,
      labelScreenPos.x - nameWidth / 2 - labelPadding,
      labelScreenPos.y + labelHeight / 2
    );
    labelBgGradient.addColorStop(0, 'rgba(30, 35, 40, 0.9)');
    labelBgGradient.addColorStop(1, 'rgba(20, 25, 30, 0.95)');

    this.ctx.fillStyle = labelBgGradient;
    this.ctx.beginPath();
    this.roundedRectScreen(
      labelScreenPos.x - nameWidth / 2 - labelPadding,
      labelScreenPos.y - labelHeight / 2,
      nameWidth + labelPadding * 2,
      labelHeight,
      4
    );
    this.ctx.fill();

    // Label border
    this.ctx.strokeStyle = this.hexToRgba(mainColor, 0.6);
    this.ctx.lineWidth = 1;
    this.ctx.beginPath();
    this.roundedRectScreen(
      labelScreenPos.x - nameWidth / 2 - labelPadding,
      labelScreenPos.y - labelHeight / 2,
      nameWidth + labelPadding * 2,
      labelHeight,
      4
    );
    this.ctx.stroke();

    // Label text
    this.ctx.fillStyle = '#ffffff';
    this.ctx.textAlign = 'center';
    this.ctx.textBaseline = 'middle';
    this.ctx.fillText(building.name, labelScreenPos.x, labelScreenPos.y);
  }

  /**
   * Helper to draw rounded rect in screen space (no camera transform)
   */
  private roundedRectScreen(x: number, y: number, width: number, height: number, radius: number): void {
    this.ctx.moveTo(x + radius, y);
    this.ctx.lineTo(x + width - radius, y);
    this.ctx.arcTo(x + width, y, x + width, y + radius, radius);
    this.ctx.lineTo(x + width, y + height - radius);
    this.ctx.arcTo(x + width, y + height, x + width - radius, y + height, radius);
    this.ctx.lineTo(x + radius, y + height);
    this.ctx.arcTo(x, y + height, x, y + height - radius, radius);
    this.ctx.lineTo(x, y + radius);
    this.ctx.arcTo(x, y, x + radius, y, radius);
  }

  /**
   * Lighten a hex color by a factor (0-1)
   */
  private lightenColor(hex: string, factor: number): string {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);

    const newR = Math.min(255, Math.floor(r + (255 - r) * factor));
    const newG = Math.min(255, Math.floor(g + (255 - g) * factor));
    const newB = Math.min(255, Math.floor(b + (255 - b) * factor));

    return `#${newR.toString(16).padStart(2, '0')}${newG.toString(16).padStart(2, '0')}${newB.toString(16).padStart(2, '0')}`;
  }

  /**
   * Darken a hex color by a factor (0-1)
   */
  private darkenColor(hex: string, factor: number): string {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);

    const newR = Math.max(0, Math.floor(r * (1 - factor)));
    const newG = Math.max(0, Math.floor(g * (1 - factor)));
    const newB = Math.max(0, Math.floor(b * (1 - factor)));

    return `#${newR.toString(16).padStart(2, '0')}${newG.toString(16).padStart(2, '0')}${newB.toString(16).padStart(2, '0')}`;
  }

  // ============================================
  // Agents
  // ============================================

  /**
   * Get the emoji icon for an agent's class
   */
  private getAgentClassIcon(agentClass: string): string {
    // Check built-in classes first
    const builtIn = AGENT_CLASS_CONFIG[agentClass as BuiltInAgentClass];
    if (builtIn) {
      return builtIn.icon;
    }

    // Check custom classes from store
    const state = store.getState();
    const custom = state.customAgentClasses.get(agentClass);
    if (custom) {
      return custom.icon;
    }

    // Fallback
    return '🤖';
  }

  drawAgent(agent: Agent2DData, isSelected: boolean, isMoving: boolean, indicatorScale: number): void {
    const { x, z } = agent.position;
    const baseRadius = agent.isBoss ? 0.7 : 0.5;
    const radius = baseRadius;

    // Animation parameters
    const walkSpeed = 8;
    const walkPhase = this.animationTime * walkSpeed;
    const pulsePhase = this.animationTime * 3; // Slower pulse for status
    const glowPhase = this.animationTime * 2; // Selection glow animation

    // Working bounce animation - only for the emoji icon
    const isWorking = agent.status === 'working';
    const workBounceSpeed = 6; // Bounce frequency
    const workBouncePhase = this.animationTime * workBounceSpeed;
    // Use absolute value of sine for a bouncing effect (always up) - in screen pixels
    const iconBounceOffset = isWorking ? Math.abs(Math.sin(workBouncePhase)) * 8 : 0;

    // Walking animation
    const bobAmount = isMoving ? Math.sin(walkPhase * 2) * 0.05 : 0;
    const squashAmount = isMoving ? 1 + Math.sin(walkPhase * 2) * 0.08 : 1;
    const footOffset = isMoving ? Math.sin(walkPhase) * 0.15 : 0;

    // Get status colors
    const statusConfig = STATUS_COLORS[agent.status] || STATUS_COLORS.idle;
    const bodyColor = this.numberToHex(agent.color);
    const bodyColorDark = this.darkenColor(bodyColor, 0.4);
    const bodyColorLight = this.lightenColor(bodyColor, 0.3);

    // Get class emoji
    const classEmoji = this.getAgentClassIcon(agent.class);

    // ========== SCREEN SPACE RENDERING ==========
    const screenPos = this.camera.worldToScreen(x, z + bobAmount);
    const screenRadius = radius * this.camera.getZoom();

    // ========== DROP SHADOW ==========
    this.ctx.save();
    this.ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
    this.ctx.shadowBlur = 8;
    this.ctx.shadowOffsetX = 3;
    this.ctx.shadowOffsetY = 3;

    // ========== STATUS RING (Outer glow ring) ==========
    const statusPulse = 0.7 + Math.sin(pulsePhase) * 0.3;
    const statusRingRadius = screenRadius + 6;

    // Status ring glow
    const statusGradient = this.ctx.createRadialGradient(
      screenPos.x, screenPos.y, screenRadius,
      screenPos.x, screenPos.y, statusRingRadius + 4
    );
    statusGradient.addColorStop(0, 'transparent');
    statusGradient.addColorStop(0.5, this.hexToRgba(statusConfig.color, statusPulse * 0.5));
    statusGradient.addColorStop(1, 'transparent');

    this.ctx.beginPath();
    this.ctx.arc(screenPos.x, screenPos.y, statusRingRadius + 4, 0, Math.PI * 2);
    this.ctx.fillStyle = statusGradient;
    this.ctx.fill();

    // Status ring stroke
    this.ctx.beginPath();
    this.ctx.arc(screenPos.x, screenPos.y, statusRingRadius, 0, Math.PI * 2);
    this.ctx.strokeStyle = this.hexToRgba(statusConfig.color, statusPulse * 0.8);
    this.ctx.lineWidth = 2;
    this.ctx.stroke();

    // ========== SELECTION GLOW (Animated outer ring when selected) ==========
    if (isSelected) {
      const glowPulse = 0.5 + Math.sin(glowPhase) * 0.5;
      const selectionRadius = screenRadius + 12 + Math.sin(glowPhase * 2) * 2;

      // Outer glow
      const selectionGradient = this.ctx.createRadialGradient(
        screenPos.x, screenPos.y, screenRadius + 6,
        screenPos.x, screenPos.y, selectionRadius + 8
      );
      selectionGradient.addColorStop(0, this.hexToRgba(bodyColor, glowPulse * 0.6));
      selectionGradient.addColorStop(0.5, this.hexToRgba(bodyColor, glowPulse * 0.3));
      selectionGradient.addColorStop(1, 'transparent');

      this.ctx.beginPath();
      this.ctx.arc(screenPos.x, screenPos.y, selectionRadius + 8, 0, Math.PI * 2);
      this.ctx.fillStyle = selectionGradient;
      this.ctx.fill();

      // Selection ring
      this.ctx.beginPath();
      this.ctx.arc(screenPos.x, screenPos.y, selectionRadius, 0, Math.PI * 2);
      this.ctx.strokeStyle = bodyColor;
      this.ctx.lineWidth = 3;
      this.ctx.setLineDash([8, 4]);
      this.ctx.lineDashOffset = -this.animationTime * 20;
      this.ctx.stroke();
      this.ctx.setLineDash([]);
    }

    // ========== FEET (when moving) ==========
    if (isMoving) {
      const footRadius = screenRadius * 0.25;
      const footY = screenPos.y + screenRadius * 0.7;

      // Shadow under feet
      this.ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
      this.ctx.beginPath();
      this.ctx.ellipse(screenPos.x, footY + 4, screenRadius * 0.6, screenRadius * 0.15, 0, 0, Math.PI * 2);
      this.ctx.fill();

      // Left foot
      this.ctx.fillStyle = bodyColorDark;
      this.ctx.beginPath();
      this.ctx.arc(screenPos.x - screenRadius * 0.3 + footOffset * this.camera.getZoom(), footY, footRadius, 0, Math.PI * 2);
      this.ctx.fill();

      // Right foot
      this.ctx.beginPath();
      this.ctx.arc(screenPos.x + screenRadius * 0.3 - footOffset * this.camera.getZoom(), footY, footRadius, 0, Math.PI * 2);
      this.ctx.fill();
    }

    // ========== AGENT BODY (with dark radial gradient) ==========
    const bodyRadiusX = isMoving ? screenRadius / squashAmount : screenRadius;
    const bodyRadiusY = isMoving ? screenRadius * squashAmount : screenRadius;

    // Create dark radial gradient for 3D-like depth (black background)
    const bodyGradient = this.ctx.createRadialGradient(
      screenPos.x - screenRadius * 0.3, screenPos.y - screenRadius * 0.3, 0,
      screenPos.x, screenPos.y, screenRadius
    );
    bodyGradient.addColorStop(0, '#3a3a3a');  // Dark gray highlight
    bodyGradient.addColorStop(0.5, '#1a1a1a'); // Near black
    bodyGradient.addColorStop(1, '#0a0a0a');   // Very dark

    this.ctx.beginPath();
    if (isMoving) {
      this.ctx.ellipse(screenPos.x, screenPos.y, bodyRadiusX, bodyRadiusY, 0, 0, Math.PI * 2);
    } else {
      this.ctx.arc(screenPos.x, screenPos.y, screenRadius, 0, Math.PI * 2);
    }
    this.ctx.fillStyle = bodyGradient;
    this.ctx.fill();

    // Body outline with agent color accent
    this.ctx.strokeStyle = this.hexToRgba(bodyColor, 0.6);
    this.ctx.lineWidth = 2;
    this.ctx.stroke();

    // Subtle inner highlight
    this.ctx.beginPath();
    this.ctx.arc(screenPos.x - screenRadius * 0.25, screenPos.y - screenRadius * 0.25, screenRadius * 0.3, 0, Math.PI * 2);
    this.ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
    this.ctx.fill();

    this.ctx.restore(); // Remove shadow for remaining elements

    // ========== CLASS EMOJI (Prominent in center, bounces when working) ==========
    const emojiFontSize = Math.max(16, screenRadius * 1.1);
    this.ctx.font = `${emojiFontSize}px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif`;
    this.ctx.textAlign = 'center';
    this.ctx.textBaseline = 'middle';
    this.ctx.fillText(classEmoji, screenPos.x, screenPos.y + 1 - iconBounceOffset);

    // ========== BOSS CROWN (Better positioned above agent) ==========
    if (agent.isBoss) {
      const crownSize = Math.max(14, screenRadius * 0.6);
      this.ctx.font = `${crownSize}px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", serif`;
      this.ctx.textAlign = 'center';
      this.ctx.textBaseline = 'bottom';

      // Crown with subtle glow
      this.ctx.save();
      this.ctx.shadowColor = 'rgba(255, 215, 0, 0.8)';
      this.ctx.shadowBlur = 6;
      this.ctx.fillText('👑', screenPos.x, screenPos.y - screenRadius - 2);
      this.ctx.restore();
    }

    // ========== DUST PARTICLES (when moving) ==========
    if (isMoving) {
      const dustCount = 4;
      for (let i = 0; i < dustCount; i++) {
        const dustPhase = walkPhase + i * 1.5;
        const dustX = screenPos.x + Math.sin(dustPhase * 1.5) * screenRadius * 0.5;
        const dustY = screenPos.y + screenRadius * 0.9 + Math.abs(Math.sin(dustPhase)) * 8;
        const dustSize = 2 + Math.sin(dustPhase) * 1;
        const dustAlpha = 0.4 - (Math.abs(Math.sin(dustPhase)) * 0.3);

        this.ctx.beginPath();
        this.ctx.arc(dustX, dustY, dustSize, 0, Math.PI * 2);
        this.ctx.fillStyle = `rgba(180, 180, 180, ${dustAlpha})`;
        this.ctx.fill();
      }
    }

    // ========== NAME TAG (Styled badge below agent) ==========
    const labelY = screenPos.y + screenRadius + 14;
    const labelFontSize = Math.max(10, 11 * indicatorScale);

    this.ctx.font = `bold ${labelFontSize}px "Segoe UI", Arial, sans-serif`;
    const nameWidth = this.ctx.measureText(agent.name).width;
    const namePadding = 8;
    const nameHeight = labelFontSize + 6;

    // Name tag background with gradient
    const nameTagGradient = this.ctx.createLinearGradient(
      screenPos.x - nameWidth / 2 - namePadding, labelY - nameHeight / 2,
      screenPos.x - nameWidth / 2 - namePadding, labelY + nameHeight / 2
    );
    nameTagGradient.addColorStop(0, 'rgba(30, 30, 40, 0.95)');
    nameTagGradient.addColorStop(1, 'rgba(20, 20, 30, 0.95)');

    // Draw rounded name tag
    this.ctx.beginPath();
    this.roundedRectScreen(
      screenPos.x - nameWidth / 2 - namePadding,
      labelY - nameHeight / 2,
      nameWidth + namePadding * 2,
      nameHeight,
      4
    );
    this.ctx.fillStyle = nameTagGradient;
    this.ctx.fill();

    // Name tag border with agent color
    this.ctx.strokeStyle = this.hexToRgba(bodyColor, 0.6);
    this.ctx.lineWidth = 1.5;
    this.ctx.stroke();

    // Name text
    this.ctx.fillStyle = bodyColor;
    this.ctx.textAlign = 'center';
    this.ctx.textBaseline = 'middle';
    this.ctx.fillText(agent.name, screenPos.x, labelY);

    // ========== CONTEXT/MANA BAR (Gradient filled) ==========
    // Calculate remaining context percentage using correct formula from unit-context
    const used = agent.contextUsed || 0;
    const limit = agent.contextLimit || 200000;
    const remaining = Math.max(0, limit - used);
    const contextPercent = (remaining / limit) * 100;
    const manaPercent = Math.max(0, Math.min(100, contextPercent)) / 100;

    const barY = labelY + nameHeight / 2 + 8;
    const barWidth = Math.max(70, nameWidth + namePadding * 2); // Wider bar
    const barHeight = 10; // Taller bar

    // Bar background
    this.ctx.beginPath();
    this.roundedRectScreen(screenPos.x - barWidth / 2, barY, barWidth, barHeight, 4);
    this.ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
    this.ctx.fill();

    // Bar fill with gradient
    if (manaPercent > 0) {
      let barStartColor: string, barEndColor: string;
      if (manaPercent > 0.5) {
        barStartColor = '#6a9a78';
        barEndColor = '#4a7a58';
      } else if (manaPercent > 0.2) {
        barStartColor = '#c89858';
        barEndColor = '#a87838';
      } else {
        barStartColor = '#c85858';
        barEndColor = '#a83838';
      }

      const barGradient = this.ctx.createLinearGradient(
        screenPos.x - barWidth / 2, barY,
        screenPos.x - barWidth / 2 + barWidth * manaPercent, barY
      );
      barGradient.addColorStop(0, barStartColor);
      barGradient.addColorStop(1, barEndColor);

      this.ctx.beginPath();
      this.roundedRectScreen(screenPos.x - barWidth / 2, barY, barWidth * manaPercent, barHeight, 4);
      this.ctx.fillStyle = barGradient;
      this.ctx.fill();
    }

    // Bar border
    this.ctx.beginPath();
    this.roundedRectScreen(screenPos.x - barWidth / 2, barY, barWidth, barHeight, 4);
    this.ctx.strokeStyle = 'rgba(100, 150, 150, 0.6)';
    this.ctx.lineWidth = 1.5;
    this.ctx.stroke();

    // Bar percentage text (more prominent)
    const percentText = `${Math.round(contextPercent)}%`;
    this.ctx.font = `bold 10px "Segoe UI", Arial, sans-serif`;
    this.ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
    this.ctx.textAlign = 'center';
    this.ctx.textBaseline = 'middle';
    this.ctx.fillText(percentText, screenPos.x, barY + barHeight / 2);

    // ========== IDLE TIMER BADGE ==========
    if (agent.status === 'idle' && agent.lastActivity > 0) {
      const idleSeconds = Math.floor((Date.now() - agent.lastActivity) / 1000);
      if (idleSeconds >= 5) {
        const idleText = this.formatIdleTime(idleSeconds);
        const timerY = barY + barHeight + 10;

        // Timer badge colors based on duration
        let timerBgColor: string, timerTextColor: string, timerIcon: string;
        if (idleSeconds < 60) {
          timerBgColor = 'rgba(74, 158, 74, 0.9)';
          timerTextColor = '#aaffaa';
          timerIcon = '💤';
        } else if (idleSeconds < 300) {
          timerBgColor = 'rgba(158, 120, 50, 0.9)';
          timerTextColor = '#ffdd88';
          timerIcon = '⏳';
        } else {
          timerBgColor = 'rgba(158, 120, 50, 0.9)';
          timerTextColor = '#ffdd88';
          timerIcon = '⏳';
        }

        const timerFontSize = Math.max(8, 9 * indicatorScale);
        this.ctx.font = `bold ${timerFontSize}px "Segoe UI Emoji", "Apple Color Emoji", Arial`;
        const timerContent = `${timerIcon} ${idleText}`;
        const timerWidth = this.ctx.measureText(timerContent).width;
        const timerPadding = 5;
        const timerHeight = timerFontSize + 3;

        // Timer badge background (pill shape)
        this.ctx.beginPath();
        this.roundedRectScreen(
          screenPos.x - timerWidth / 2 - timerPadding,
          timerY - timerHeight / 2,
          timerWidth + timerPadding * 2,
          timerHeight,
          timerHeight / 2
        );
        this.ctx.fillStyle = timerBgColor;
        this.ctx.fill();

        // Timer text
        this.ctx.fillStyle = timerTextColor;
        this.ctx.textAlign = 'center';
        this.ctx.textBaseline = 'middle';
        this.ctx.fillText(timerContent, screenPos.x, timerY);
      }
    }

    // ========== CURRENT TOOL BADGE (when working) ==========
    if (agent.currentTool) {
      const toolIcon = TOOL_ICONS[agent.currentTool] || TOOL_ICONS.default;
      const toolY = barY + barHeight + 10;

      const toolFontSize = Math.max(9, 10 * indicatorScale);
      this.ctx.font = `bold ${toolFontSize}px "Segoe UI Emoji", "Apple Color Emoji", Arial`;
      const toolContent = `${toolIcon} ${agent.currentTool}`;
      const toolTextWidth = this.ctx.measureText(toolContent).width;
      const toolPadding = 6;
      const toolBadgeHeight = toolFontSize + 4;

      // Tool badge background (pill shape with blue theme)
      this.ctx.beginPath();
      this.roundedRectScreen(
        screenPos.x - toolTextWidth / 2 - toolPadding,
        toolY - toolBadgeHeight / 2,
        toolTextWidth + toolPadding * 2,
        toolBadgeHeight,
        toolBadgeHeight / 2
      );
      this.ctx.fillStyle = 'rgba(74, 118, 158, 0.9)';
      this.ctx.fill();

      // Tool badge border
      this.ctx.strokeStyle = 'rgba(74, 158, 255, 0.6)';
      this.ctx.lineWidth = 1;
      this.ctx.stroke();

      // Tool text
      this.ctx.fillStyle = '#aaddff';
      this.ctx.textAlign = 'center';
      this.ctx.textBaseline = 'middle';
      this.ctx.fillText(toolContent, screenPos.x, toolY);
    }
  }

  // ============================================
  // Selection Box
  // ============================================

  drawSelectionBox(start: { x: number; z: number }, end: { x: number; z: number }): void {
    const zoom = this.camera.getZoom();
    const minX = Math.min(start.x, end.x);
    const maxX = Math.max(start.x, end.x);
    const minZ = Math.min(start.z, end.z);
    const maxZ = Math.max(start.z, end.z);

    const width = maxX - minX;
    const height = maxZ - minZ;

    // Skip if too small
    if (width < 0.1 && height < 0.1) return;

    this.camera.applyTransform(this.ctx);

    const ctx = this.ctx;
    const accentColor = '#4a9eff';

    // Animated marching ants offset (moves over time)
    const dashOffset = (this.animationTime * 30) % 24;
    const dashLength = 6 / zoom;
    const gapLength = 3 / zoom;

    // ---- Outer glow/shadow effect ----
    ctx.save();
    ctx.shadowColor = 'rgba(74, 158, 255, 0.5)';
    ctx.shadowBlur = 10 / zoom;
    ctx.fillStyle = 'transparent';
    ctx.beginPath();
    ctx.rect(minX, minZ, width, height);
    ctx.fill();
    ctx.restore();

    // ---- Gradient fill ----
    // Diagonal gradient for depth effect
    const gradient = ctx.createLinearGradient(minX, minZ, maxX, maxZ);
    gradient.addColorStop(0, 'rgba(74, 158, 255, 0.15)');
    gradient.addColorStop(0.4, 'rgba(74, 158, 255, 0.08)');
    gradient.addColorStop(0.6, 'rgba(74, 158, 255, 0.12)');
    gradient.addColorStop(1, 'rgba(100, 180, 255, 0.18)');

    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.rect(minX, minZ, width, height);
    ctx.fill();

    // ---- Inner highlight (top edge) ----
    const highlightGradient = ctx.createLinearGradient(minX, minZ, maxX, minZ);
    highlightGradient.addColorStop(0, 'transparent');
    highlightGradient.addColorStop(0.2, 'rgba(150, 200, 255, 0.4)');
    highlightGradient.addColorStop(0.8, 'rgba(150, 200, 255, 0.4)');
    highlightGradient.addColorStop(1, 'transparent');

    ctx.strokeStyle = highlightGradient;
    ctx.lineWidth = 1.5 / zoom;
    ctx.beginPath();
    ctx.moveTo(minX + width * 0.1, minZ + 1 / zoom);
    ctx.lineTo(maxX - width * 0.1, minZ + 1 / zoom);
    ctx.stroke();

    // ---- Animated dashed border (marching ants) ----
    ctx.strokeStyle = 'rgba(74, 158, 255, 0.9)';
    ctx.lineWidth = 2 / zoom;
    ctx.setLineDash([dashLength, gapLength]);
    ctx.lineDashOffset = -dashOffset / zoom;

    ctx.beginPath();
    ctx.rect(minX, minZ, width, height);
    ctx.stroke();

    ctx.setLineDash([]);

    // ---- Outer border (subtle) ----
    ctx.strokeStyle = 'rgba(74, 158, 255, 0.3)';
    ctx.lineWidth = 1 / zoom;
    ctx.beginPath();
    ctx.rect(minX - 1 / zoom, minZ - 1 / zoom, width + 2 / zoom, height + 2 / zoom);
    ctx.stroke();

    // ---- Corner markers (L-shaped) ----
    const cornerSize = Math.min(width, height) * 0.15;
    const minCornerSize = 0.3;
    const actualCornerSize = Math.max(cornerSize, minCornerSize);

    ctx.strokeStyle = accentColor;
    ctx.lineWidth = 3 / zoom;
    ctx.lineCap = 'round';

    // Top-left corner
    this.drawSelectionCorner(minX, minZ, actualCornerSize, 'top-left');
    // Top-right corner
    this.drawSelectionCorner(maxX, minZ, actualCornerSize, 'top-right');
    // Bottom-left corner
    this.drawSelectionCorner(minX, maxZ, actualCornerSize, 'bottom-left');
    // Bottom-right corner
    this.drawSelectionCorner(maxX, maxZ, actualCornerSize, 'bottom-right');

    // ---- Corner dots ----
    const dotRadius = 3 / zoom;
    ctx.fillStyle = accentColor;

    // Pulsing glow for corner dots
    const pulseAlpha = 0.6 + Math.sin(this.animationTime * 4) * 0.3;
    ctx.save();
    ctx.shadowColor = `rgba(74, 158, 255, ${pulseAlpha})`;
    ctx.shadowBlur = 6 / zoom;

    const corners = [
      { x: minX, y: minZ },
      { x: maxX, y: minZ },
      { x: minX, y: maxZ },
      { x: maxX, y: maxZ },
    ];

    for (const corner of corners) {
      ctx.beginPath();
      ctx.arc(corner.x, corner.y, dotRadius, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();

    this.camera.restoreTransform(this.ctx);
  }

  /**
   * Draw an L-shaped corner mark for selection box
   */
  private drawSelectionCorner(
    x: number,
    y: number,
    size: number,
    position: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'
  ): void {
    const ctx = this.ctx;
    ctx.beginPath();

    switch (position) {
      case 'top-left':
        ctx.moveTo(x, y + size);
        ctx.lineTo(x, y);
        ctx.lineTo(x + size, y);
        break;
      case 'top-right':
        ctx.moveTo(x - size, y);
        ctx.lineTo(x, y);
        ctx.lineTo(x, y + size);
        break;
      case 'bottom-left':
        ctx.moveTo(x, y - size);
        ctx.lineTo(x, y);
        ctx.lineTo(x + size, y);
        break;
      case 'bottom-right':
        ctx.moveTo(x - size, y);
        ctx.lineTo(x, y);
        ctx.lineTo(x, y - size);
        break;
    }

    ctx.stroke();
  }

  // ============================================
  // Area Drawing Preview
  // ============================================

  drawAreaPreview(
    start: { x: number; z: number },
    end: { x: number; z: number },
    tool: 'rectangle' | 'circle'
  ): void {
    const zoom = this.camera.getZoom();
    const ctx = this.ctx;
    const areaColor = '#4a9eff';

    this.camera.applyTransform(ctx);

    if (tool === 'rectangle') {
      const minX = Math.min(start.x, end.x);
      const maxX = Math.max(start.x, end.x);
      const minZ = Math.min(start.z, end.z);
      const maxZ = Math.max(start.z, end.z);
      const width = maxX - minX;
      const height = maxZ - minZ;

      // Skip if too small
      if (width < 0.1 && height < 0.1) {
        this.camera.restoreTransform(ctx);
        return;
      }

      // Fill
      ctx.fillStyle = 'rgba(74, 158, 255, 0.2)';
      ctx.fillRect(minX, minZ, width, height);

      // Animated dashed border
      const dashOffset = (this.animationTime * 30) % 20;
      ctx.setLineDash([6 / zoom, 4 / zoom]);
      ctx.lineDashOffset = -dashOffset / zoom;
      ctx.strokeStyle = areaColor;
      ctx.lineWidth = 2 / zoom;
      ctx.strokeRect(minX, minZ, width, height);
      ctx.setLineDash([]);
    } else if (tool === 'circle') {
      const dx = end.x - start.x;
      const dz = end.z - start.z;
      const radius = Math.sqrt(dx * dx + dz * dz);

      // Skip if too small
      if (radius < 0.1) {
        this.camera.restoreTransform(ctx);
        return;
      }

      // Fill
      ctx.fillStyle = 'rgba(74, 158, 255, 0.2)';
      ctx.beginPath();
      ctx.arc(start.x, start.z, radius, 0, Math.PI * 2);
      ctx.fill();

      // Animated dashed border
      const dashOffset = (this.animationTime * 30) % 20;
      ctx.setLineDash([6 / zoom, 4 / zoom]);
      ctx.lineDashOffset = -dashOffset / zoom;
      ctx.strokeStyle = areaColor;
      ctx.lineWidth = 2 / zoom;
      ctx.beginPath();
      ctx.arc(start.x, start.z, radius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    this.camera.restoreTransform(ctx);
  }

  // ============================================
  // Utilities
  // ============================================

  private roundedRect(x: number, y: number, width: number, height: number, radius: number): void {
    this.ctx.moveTo(x + radius, y);
    this.ctx.lineTo(x + width - radius, y);
    this.ctx.arcTo(x + width, y, x + width, y + radius, radius);
    this.ctx.lineTo(x + width, y + height - radius);
    this.ctx.arcTo(x + width, y + height, x + width - radius, y + height, radius);
    this.ctx.lineTo(x + radius, y + height);
    this.ctx.arcTo(x, y + height, x, y + height - radius, radius);
    this.ctx.lineTo(x, y + radius);
    this.ctx.arcTo(x, y, x + radius, y, radius);
  }

  private numberToHex(num: number): string {
    return `#${num.toString(16).padStart(6, '0')}`;
  }

  private hexToRgba(hex: string, alpha: number): string {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  private formatIdleTime(seconds: number): string {
    if (seconds < 60) return `${seconds}s`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
    return `${Math.floor(seconds / 3600)}h`;
  }
}
