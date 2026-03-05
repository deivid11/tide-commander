import * as THREE from 'three';
import type { Agent, BuiltInAgentClass } from '../../../shared/types';
import { AGENT_CLASS_CONFIG } from '../config';
import type { AnimationConfigurator } from './AnimationConfigurator';

/**
 * Status colors for agent state visualization.
 */
const STATUS_COLORS: Record<string, number> = {
  idle: 0x4aff9e,
  working: 0x4a9eff,
  waiting: 0xff9e4a,
  waiting_permission: 0xffcc00,
  error: 0xff4a4a,
  orphaned: 0xff00ff,
  default: 0x888888,
};

const NAME_LABEL_REFERENCE_FONT_SIZE = 800;
const NAME_LABEL_MAX_FONT_SIZE = 420;
const NAME_LABEL_LAYOUT_VERSION = 5;

/**
 * Calculate remaining context percentage from agent data.
 */
export function getContextRemainingPercent(agent: Agent): number {
  if (agent.contextStats) {
    return 100 - agent.contextStats.usedPercent;
  }
  const used = agent.contextUsed || 0;
  const limit = agent.contextLimit || 200000;
  const remaining = Math.max(0, limit - used);
  return (remaining / limit) * 100;
}

/**
 * All canvas-based visual rendering: status bars, name labels, mana bars,
 * idle timers, selection rings, and sprite creation/updates.
 */
export class VisualConfig {
  // Reusable canvases for updating sprites (avoid creating new canvases per frame)
  private idleTimerCanvas: HTMLCanvasElement | null = null;
  private idleTimerCtx: CanvasRenderingContext2D | null = null;
  private manaBarCanvas: HTMLCanvasElement | null = null;
  private manaBarCtx: CanvasRenderingContext2D | null = null;
  private providerBadgeImages = new Map<string, HTMLImageElement>();
  private providerBadgeVersion = 0;

  constructor(private animConfig: AnimationConfigurator) {}

  private getNameLabelBaseScale(isBoss: boolean, hasTaskLabel: boolean): number {
    void hasTaskLabel;
    return isBoss ? 3.1 : 2.5;
  }

  private fitNameLabelText(
    ctx: CanvasRenderingContext2D,
    name: string,
    fontSize: number,
    maxWidth: number,
    hasProviderDot: boolean
  ): string {
    ctx.font = `bold ${fontSize}px Arial`;
    const availableWidth = maxWidth - (hasProviderDot ? (fontSize * 0.42) + (fontSize * 0.3) : 0);
    if (ctx.measureText(name).width <= availableWidth) {
      return name;
    }

    let displayName = name;
    while (displayName.length > 3 && ctx.measureText(`${displayName}...`).width > availableWidth) {
      displayName = displayName.slice(0, -1);
    }

    return `${displayName}...`;
  }

  private fitTaskLabelText(
    ctx: CanvasRenderingContext2D,
    taskLabel: string,
    fontSize: number,
    maxWidth: number
  ): string {
    ctx.font = `italic ${fontSize}px "Segoe UI", Arial, sans-serif`;
    if (ctx.measureText(taskLabel).width <= maxWidth) {
      return taskLabel;
    }

    let displayLabel = taskLabel;
    while (displayLabel.length > 3 && ctx.measureText(`${displayLabel}...`).width > maxWidth) {
      displayLabel = displayLabel.slice(0, -1);
    }

    return `${displayLabel}...`;
  }

  private getProviderBadgeImage(provider?: string): HTMLImageElement | null {
    if (provider !== 'claude' && provider !== 'codex') {
      return null;
    }

    const cached = this.providerBadgeImages.get(provider);
    if (cached) {
      return cached;
    }

    if (typeof Image === 'undefined') {
      return null;
    }

    const image = new Image();
    image.decoding = 'async';
    image.src = provider === 'codex' ? '/assets/codex.png' : '/assets/claude.png';
    image.onload = () => {
      this.providerBadgeVersion += 1;
    };
    this.providerBadgeImages.set(provider, image);
    return image;
  }

  /**
   * Get color for a status string.
   */
  getStatusColor(status: string): number {
    return STATUS_COLORS[status] ?? STATUS_COLORS.default;
  }

  /**
   * Create the selection ring indicator.
   */
  createSelectionRing(color: number, isBoss: boolean = false): THREE.Mesh {
    const scale = isBoss ? 1.5 : 1.0;
    const geometry = new THREE.RingGeometry(0.8 * scale, 0.95 * scale, 32);
    const material = new THREE.MeshBasicMaterial({
      color,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0,
      depthTest: false,
    });

    const ring = new THREE.Mesh(geometry, material);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.05;
    ring.renderOrder = 999;
    ring.name = 'selectionRing';

    return ring;
  }

  /**
   * Create a status bar sprite containing mana bar, idle timer, and crown.
   * Positioned above the character based on model height.
   */
  createStatusBarSprite(
    remainingPercent: number,
    status: string,
    lastActivity: number,
    isBoss: boolean,
    modelHeight: number = 2.0
  ): THREE.Sprite {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d')!;

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
      depthWrite: false,
    });

    const sprite = new THREE.Sprite(material);
    const padding = isBoss ? 0.8 : 0.5;
    sprite.position.y = modelHeight + padding;
    const baseScale = isBoss ? 2.6 : 2.1;
    const aspectRatio = canvas.height / canvas.width;
    sprite.scale.set(baseScale, baseScale * aspectRatio, 1);
    sprite.name = 'statusBar';
    sprite.renderOrder = 1100;
    sprite.userData.modelHeight = modelHeight;
    sprite.userData.baseIndicatorScale = baseScale;
    sprite.userData.aspectRatio = aspectRatio;

    return sprite;
  }

  /**
   * Create a name label sprite. Positioned below the character.
   */
  createNameLabelSprite(name: string, color: number, isBoss: boolean, provider?: string, taskLabel?: string): THREE.Sprite {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d')!;

    canvas.width = 4096;
    canvas.height = taskLabel ? 2048 : 1024;

    this.drawNameLabel(ctx, canvas.width, canvas.height, name, color, isBoss, provider, taskLabel);

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
      depthWrite: false,
    });

    const sprite = new THREE.Sprite(material);
    // Name-only labels should stay compact; task-label variants need a wider card.
    const baseScale = this.getNameLabelBaseScale(isBoss, !!taskLabel);
    sprite.position.y = taskLabel
      ? (isBoss ? -1.2 : -1.0)
      : (isBoss ? -0.9 : -0.7);
    const aspectRatio = canvas.height / canvas.width;
    sprite.scale.set(baseScale, baseScale * aspectRatio, 1);
    sprite.name = 'nameLabelSprite';
    sprite.renderOrder = 1200;
    sprite.userData.baseIndicatorScale = baseScale;
    sprite.userData.aspectRatio = aspectRatio;
    sprite.userData.nameLabelLayoutVersion = NAME_LABEL_LAYOUT_VERSION;
    sprite.userData.providerBadgeVersion = this.providerBadgeVersion;

    return sprite;
  }

  /**
   * Draw the name label on a canvas.
   */
  drawNameLabel(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    name: string,
    color: number,
    isBoss: boolean,
    provider?: string,
    taskLabel?: string
  ): void {
    ctx.clearRect(0, 0, width, height);

    const colorHex = `#${color.toString(16).padStart(6, '0')}`;

    // When task label is present, shift name up to make room
    const nameY = taskLabel ? height * 0.3 : height / 2;

    const providerBadgeImage = this.getProviderBadgeImage(provider);
    const hasProviderBadge = providerBadgeImage !== null;
    const fontSize = isBoss
      ? Math.max(NAME_LABEL_MAX_FONT_SIZE, NAME_LABEL_REFERENCE_FONT_SIZE - 300)
      : NAME_LABEL_MAX_FONT_SIZE;

    ctx.font = `bold ${fontSize}px Arial`;
    const displayName = this.fitNameLabelText(ctx, name, fontSize, width - 400, hasProviderBadge);
    const textWidth = ctx.measureText(displayName).width;
    const badgeSize = hasProviderBadge ? fontSize * 0.95 : 0;
    const badgeSpacing = hasProviderBadge ? fontSize * 0.32 : 0;
    const providerBlock = badgeSize + badgeSpacing;
    const totalContentWidth = textWidth + providerBlock;
    const textX = width / 2 + providerBlock / 2;

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    ctx.shadowColor = 'rgba(0, 0, 0, 0.9)';
    ctx.shadowBlur = fontSize * 0.12;
    ctx.shadowOffsetX = fontSize * 0.04;
    ctx.shadowOffsetY = fontSize * 0.04;

    ctx.strokeStyle = '#000';
    ctx.lineWidth = fontSize * 0.14;
    ctx.lineJoin = 'round';
    ctx.strokeText(displayName, textX, nameY);

    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;

    if (hasProviderBadge) {
      const badgeX = width / 2 - totalContentWidth / 2;
      const badgeY = nameY - badgeSize / 2;
      if (providerBadgeImage && providerBadgeImage.complete && providerBadgeImage.naturalWidth > 0) {
        ctx.drawImage(providerBadgeImage, badgeX, badgeY, badgeSize, badgeSize);
      } else {
        const fallbackX = badgeX + badgeSize / 2;
        const fallbackY = nameY;
        const providerColor = provider === 'codex' ? '#4a9eff' : '#ff9e4a';
        ctx.beginPath();
        ctx.arc(fallbackX, fallbackY, badgeSize / 2, 0, Math.PI * 2);
        ctx.fillStyle = providerColor;
        ctx.fill();
      }
    }

    ctx.fillStyle = colorHex;
    ctx.fillText(displayName, textX, nameY);

    // Task label (below the name)
    if (taskLabel) {
      const taskFontSize = Math.round(fontSize * 0.85);
      const taskY = height * 0.55;
      const maxLabelWidth = width - 600;
      const actualTaskFontSize = taskFontSize;
      const displayLabel = this.fitTaskLabelText(ctx, taskLabel, actualTaskFontSize, maxLabelWidth);
      ctx.font = `italic ${actualTaskFontSize}px "Segoe UI", Arial, sans-serif`;

      ctx.shadowColor = 'rgba(0, 0, 0, 0.8)';
      ctx.shadowBlur = actualTaskFontSize * 0.1;
      ctx.shadowOffsetX = actualTaskFontSize * 0.03;
      ctx.shadowOffsetY = actualTaskFontSize * 0.03;

      ctx.strokeStyle = '#000';
      ctx.lineWidth = actualTaskFontSize * 0.12;
      ctx.lineJoin = 'round';
      ctx.strokeText(displayLabel, width / 2, taskY);

      ctx.shadowColor = 'transparent';
      ctx.shadowBlur = 0;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 0;

      ctx.fillStyle = 'rgba(190, 205, 225, 0.9)';
      ctx.fillText(displayLabel, width / 2, taskY);
    }
  }

  /**
   * Draw the status bar (mana bar, idle timer, crown) on a canvas.
   */
  drawStatusBar(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    remainingPercent: number,
    status: string,
    lastActivity: number,
    isBoss: boolean
  ): void {
    ctx.clearRect(0, 0, width, height);

    const scale = width / 2048;
    let yOffset = 80 * scale;

    // Crown (for boss agents)
    if (isBoss) {
      ctx.font = `${400 * scale}px serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText('👑', width / 2, yOffset);
      yOffset += 440 * scale;
    }

    // Mana bar with status dot
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
      case 'working': dotColor = '#4a9eff'; break;
      case 'orphaned': dotColor = '#c060e0'; break;
      case 'error': dotColor = '#e05050'; break;
      case 'waiting':
      case 'waiting_permission': dotColor = '#e0a030'; break;
      default: dotColor = '#40c090';
    }

    ctx.beginPath();
    ctx.arc(dotX, dotY, dotSize / 2, 0, Math.PI * 2);
    ctx.fillStyle = dotColor;
    ctx.shadowColor = dotColor;
    ctx.shadowBlur = 20 * scale;
    ctx.fill();
    ctx.shadowBlur = 0;

    ctx.strokeStyle = 'rgba(0, 0, 0, 0.4)';
    ctx.lineWidth = 4 * scale;
    ctx.stroke();

    // Mana bar background
    const barStartX = manaBarX + dotSize + 60 * scale;
    const barWidth = manaBarWidth - dotSize - 90 * scale;
    const barHeight = manaBarHeight - 80 * scale;
    const barY = manaBarY + 40 * scale;
    const borderRadius = 30 * scale;

    ctx.fillStyle = '#0d0d14';
    ctx.beginPath();
    ctx.roundRect(barStartX, barY, barWidth, barHeight, borderRadius);
    ctx.fill();

    ctx.strokeStyle = 'rgba(80, 90, 110, 0.5)';
    ctx.lineWidth = 4 * scale;
    ctx.stroke();

    // Mana fill
    const percentage = Math.max(0, Math.min(100, remainingPercent)) / 100;
    const fillPadding = 8 * scale;
    const fillWidth = Math.max(0, (barWidth - fillPadding * 2) * percentage);
    if (fillWidth > 0) {
      let fillColor: string;
      if (percentage > 0.5) {
        fillColor = '#00c896';
      } else if (percentage > 0.2) {
        fillColor = '#e8a020';
      } else {
        fillColor = '#e84040';
      }

      ctx.fillStyle = fillColor;
      ctx.beginPath();
      ctx.roundRect(barStartX + fillPadding, barY + fillPadding, fillWidth, barHeight - fillPadding * 2, borderRadius - fillPadding);
      ctx.fill();

      ctx.shadowColor = fillColor;
      ctx.shadowBlur = 12 * scale;
      ctx.fill();
      ctx.shadowBlur = 0;
    }

    // Percentage text
    const percentText = `${Math.round(percentage * 100)}%`;
    ctx.font = `bold ${180 * scale}px "Segoe UI", Arial, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const barCenterX = barStartX + barWidth / 2;
    const barCenterY = barY + barHeight / 2;

    ctx.shadowColor = 'rgba(0, 0, 0, 0.8)';
    ctx.shadowBlur = 8 * scale;
    ctx.shadowOffsetX = 2 * scale;
    ctx.shadowOffsetY = 2 * scale;

    ctx.strokeStyle = 'rgba(0, 0, 0, 0.9)';
    ctx.lineWidth = 24 * scale;
    ctx.lineJoin = 'round';
    ctx.strokeText(percentText, barCenterX, barCenterY);

    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;

    ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
    ctx.fillText(percentText, barCenterX, barCenterY);

    yOffset += manaBarHeight + 60 * scale;

    // Idle timer (only for idle agents)
    if (status === 'idle' && lastActivity > 0) {
      const idleSeconds = Math.floor((Date.now() - lastActivity) / 1000);
      const idleText = this.animConfig.formatIdleTimeShort(idleSeconds);
      const colors = this.animConfig.getIdleTimerColor(idleSeconds);

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
  createCombinedUISprite(
    name: string,
    color: number,
    remainingPercent: number,
    status: string,
    lastActivity: number,
    isBoss: boolean
  ): THREE.Sprite {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d')!;

    canvas.width = 4096;
    canvas.height = 2048;

    this.drawCombinedUI(ctx, canvas.width, canvas.height, name, color, remainingPercent, status, lastActivity, isBoss);

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
      depthWrite: false,
    });

    const sprite = new THREE.Sprite(material);
    sprite.position.y = isBoss ? 3.2 : 2.2;
    const baseScale = isBoss ? 3.0 : 2.4;
    const aspectRatio = canvas.height / canvas.width;
    sprite.scale.set(baseScale, baseScale * aspectRatio, 1);
    sprite.name = 'combinedUI';
    sprite.userData.baseIndicatorScale = baseScale;
    sprite.userData.aspectRatio = aspectRatio;

    return sprite;
  }

  /**
   * Draw all UI elements on a single canvas.
   */
  drawCombinedUI(
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
    const scale = width / 2048;
    let yOffset = 80 * scale;

    // Crown (for boss agents)
    if (isBoss) {
      ctx.font = `${288 * scale}px serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText('👑', width / 2, yOffset);
      yOffset += 320 * scale;
    }

    // Name label
    const fontSize = 224 * scale;
    const maxNameWidth = width - 240 * scale;
    ctx.font = `bold ${fontSize}px Arial`;

    let displayName = name;
    let nameWidth = ctx.measureText(displayName).width;
    if (nameWidth > maxNameWidth) {
      while (displayName.length > 3 && ctx.measureText(displayName + '...').width > maxNameWidth) {
        displayName = displayName.slice(0, -1);
      }
      displayName += '...';
    }

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const nameY = yOffset + fontSize / 2;

    ctx.strokeStyle = '#000';
    ctx.lineWidth = 24 * scale;
    ctx.lineJoin = 'round';
    ctx.strokeText(displayName, width / 2, nameY);

    ctx.fillStyle = colorHex;
    ctx.fillText(displayName, width / 2, nameY);

    yOffset += fontSize + 64 * scale;

    // Mana bar with status dot
    const manaBarHeight = 200 * scale;
    const manaBarWidth = 1350 * scale;
    const manaBarX = (width - manaBarWidth) / 2;
    const manaBarY = yOffset;

    const dotSize = 176 * scale;
    const dotX = manaBarX + dotSize / 2 + 24 * scale;
    const dotY = manaBarY + manaBarHeight / 2;

    let dotColor: string;
    switch (status) {
      case 'working': dotColor = '#00a8ff'; break;
      case 'orphaned': dotColor = '#e040ff'; break;
      case 'error': dotColor = '#ff3030'; break;
      case 'waiting':
      case 'waiting_permission': dotColor = '#ffc000'; break;
      default: dotColor = '#00e090';
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

    const percentage = Math.max(0, Math.min(100, remainingPercent)) / 100;
    const fillPadding = 16 * scale;
    const fillWidth = Math.max(0, (barWidth - fillPadding * 2) * percentage);
    if (fillWidth > 0) {
      let fillColor: string;
      if (percentage > 0.5) fillColor = '#00ff88';
      else if (percentage > 0.2) fillColor = '#ffaa00';
      else fillColor = '#ff3366';

      ctx.fillStyle = fillColor;
      ctx.beginPath();
      ctx.roundRect(barStartX + fillPadding, barY + fillPadding, fillWidth, barHeight - fillPadding * 2, 16 * scale);
      ctx.fill();
      ctx.shadowColor = fillColor;
      ctx.shadowBlur = 32 * scale;
      ctx.fill();
      ctx.shadowBlur = 0;
    }

    const percentText = `${Math.round(percentage * 100)}%`;
    ctx.font = `bold ${128 * scale}px Arial`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const barCenterX = barStartX + barWidth / 2;
    const barCenterY = barY + barHeight / 2;

    ctx.strokeStyle = '#000';
    ctx.lineWidth = 28 * scale;
    ctx.lineJoin = 'round';
    ctx.strokeText(percentText, barCenterX, barCenterY);

    ctx.fillStyle = '#fff';
    ctx.shadowColor = '#000';
    ctx.shadowBlur = 8 * scale;
    ctx.fillText(percentText, barCenterX, barCenterY);
    ctx.shadowBlur = 0;

    yOffset += manaBarHeight + 48 * scale;

    // Idle timer (only for idle agents)
    if (status === 'idle' && lastActivity > 0) {
      const idleSeconds = Math.floor((Date.now() - lastActivity) / 1000);
      const idleText = this.animConfig.formatIdleTimeShort(idleSeconds);
      const colors = this.animConfig.getIdleTimerColor(idleSeconds);

      ctx.font = `bold ${160 * scale}px Arial`;
      const idleTextWidth = ctx.measureText(`⏱ ${idleText}`).width;
      const idleBgWidth = idleTextWidth + 160 * scale;
      const idleBgHeight = 216 * scale;
      const idleBgX = (width - idleBgWidth) / 2;
      const idleBgY = yOffset;

      ctx.fillStyle = 'rgba(0, 0, 0, 0.85)';
      ctx.beginPath();
      ctx.roundRect(idleBgX, idleBgY, idleBgWidth, idleBgHeight, 32 * scale);
      ctx.fill();

      ctx.strokeStyle = colors.border;
      ctx.lineWidth = 12 * scale;
      ctx.stroke();

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
   * @deprecated Use createCombinedUISprite instead for better performance
   */
  createNameLabel(name: string, color: number, isBoss: boolean = false): THREE.Sprite {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d')!;

    const fontSize = 72;
    const padding = 32;
    const bgHeight = 100;
    const canvasHeight = 256;

    canvas.width = 2048;
    canvas.height = canvasHeight;
    context.font = `bold ${fontSize}px Arial`;
    const measuredWidth = context.measureText(name).width;

    const minCanvasWidth = 512;
    const requiredWidth = measuredWidth + padding * 2 + 16;
    canvas.width = Math.max(minCanvasWidth, requiredWidth);

    context.clearRect(0, 0, canvas.width, canvas.height);
    context.font = `bold ${fontSize}px Arial`;

    const bgWidth = measuredWidth + padding * 2;
    const bgX = (canvas.width - bgWidth) / 2;
    const bgY = (canvas.height - bgHeight) / 2;

    context.fillStyle = 'rgba(0, 0, 0, 0.8)';
    context.beginPath();
    context.roundRect(bgX, bgY, bgWidth, bgHeight, 12);
    context.fill();

    context.fillStyle = `#${color.toString(16).padStart(6, '0')}`;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(name, canvas.width / 2, canvas.height / 2);

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
    sprite.position.y = isBoss ? -0.2 : -0.3;
    const baseHeight = isBoss ? 0.75 : 0.6;
    const baseWidth = isBoss ? 1.5 : 1.2;
    const widthScale = baseWidth * (canvas.width / 512);
    sprite.scale.set(widthScale, baseHeight, 1);
    sprite.name = 'nameLabel';
    sprite.renderOrder = 1200;
    sprite.userData.aspectRatio = canvas.width / canvas.height;

    return sprite;
  }

  /**
   * @deprecated Use createStatusBarSprite instead
   */
  createManaBar(remainingPercent: number, status: string, isBoss: boolean = false): THREE.Sprite {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d')!;

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
    sprite.position.y = isBoss ? 3.0 : 2.0;
    sprite.scale.set(isBoss ? 1.4 : 1.1, isBoss ? 0.22 : 0.18, 1);
    sprite.name = 'manaBar';

    return sprite;
  }

  /**
   * Draw the mana bar on a canvas context with status indicator.
   */
  drawManaBar(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    remainingPercent: number,
    status: string
  ): void {
    const percentage = Math.max(0, Math.min(100, remainingPercent)) / 100;

    ctx.clearRect(0, 0, width, height);

    const scale = height / 32;
    const dotSize = 20 * scale;
    const dotMargin = 6 * scale;
    const barX = dotSize + dotMargin + 4 * scale;
    const barY = 6 * scale;
    const barWidth = width - barX - 10 * scale;
    const barHeight = height - 12 * scale;
    const borderRadius = 6 * scale;

    let dotColor: string;
    switch (status) {
      case 'working': dotColor = '#4a9eff'; break;
      case 'orphaned': dotColor = '#ff00ff'; break;
      case 'error': dotColor = '#ff4a4a'; break;
      case 'waiting':
      case 'waiting_permission': dotColor = '#ffcc00'; break;
      default: dotColor = '#4aff9e';
    }
    const dotX = dotSize / 2 + 4 * scale;
    const dotY = height / 2;

    ctx.beginPath();
    ctx.arc(dotX, dotY, dotSize / 2, 0, Math.PI * 2);
    ctx.fillStyle = dotColor;
    ctx.fill();

    ctx.shadowColor = dotColor;
    ctx.shadowBlur = 8 * scale;
    ctx.fill();
    ctx.shadowBlur = 0;

    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 2 * scale;
    ctx.stroke();

    ctx.fillStyle = '#000000';
    ctx.beginPath();
    ctx.roundRect(barX, barY, barWidth, barHeight, borderRadius);
    ctx.fill();

    ctx.strokeStyle = '#5a8a8a';
    ctx.lineWidth = 2 * scale;
    ctx.stroke();

    const fillWidth = Math.max(0, (barWidth - 4 * scale) * percentage);
    if (fillWidth > 0) {
      let fillColor: string;
      let glowColor: string;

      if (percentage > 0.5) {
        fillColor = '#00ff88';
        glowColor = '#00ff88';
      } else if (percentage > 0.2) {
        fillColor = '#ffaa00';
        glowColor = '#ffaa00';
      } else {
        fillColor = '#ff3366';
        glowColor = '#ff3366';
      }

      ctx.fillStyle = fillColor;
      ctx.beginPath();
      ctx.roundRect(barX + 2 * scale, barY + 2 * scale, fillWidth, barHeight - 4 * scale, borderRadius - 2);
      ctx.fill();

      ctx.shadowColor = glowColor;
      ctx.shadowBlur = 8 * scale;
      ctx.fill();
      ctx.shadowBlur = 0;
    }

    const percentText = `${Math.round(percentage * 100)}%`;
    ctx.font = `bold ${Math.round(24 * scale)}px Arial`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 4 * scale;
    ctx.strokeText(percentText, width / 2, height / 2);

    ctx.fillStyle = '#ffffff';
    ctx.shadowColor = '#ffffff';
    ctx.shadowBlur = 2 * scale;
    ctx.fillText(percentText, width / 2, height / 2);
    ctx.shadowBlur = 0;
  }

  /**
   * Create an idle timer indicator showing time since last activity.
   */
  createIdleTimer(status: string, lastActivity: number, isBoss: boolean = false): THREE.Sprite {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d')!;

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
    sprite.position.set(0, isBoss ? 3.5 : 2.4, 0);
    sprite.scale.set(isBoss ? 1.4 : 1.1, isBoss ? 0.22 : 0.18, 1);
    sprite.name = 'idleTimer';

    return sprite;
  }

  /**
   * Create a crown indicator for boss agents.
   */
  createBossCrown(): THREE.Sprite {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d')!;

    canvas.width = 128;
    canvas.height = 128;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

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
    sprite.position.set(0, 4.0, 0);
    sprite.scale.set(0.8, 0.8, 1);
    sprite.name = 'bossCrown';

    return sprite;
  }

  /**
   * Draw the idle timer on a canvas context.
   */
  drawIdleTimer(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    status: string,
    lastActivity: number
  ): void {
    ctx.clearRect(0, 0, width, height);

    if (status !== 'idle' || lastActivity <= 0) return;

    const idleSeconds = Math.floor((Date.now() - lastActivity) / 1000);
    const idleText = this.animConfig.formatIdleTimeShort(idleSeconds);
    const colors = this.animConfig.getIdleTimerColor(idleSeconds);

    const scale = height / 80;

    const padding = 24 * scale;
    ctx.font = `bold ${Math.round(44 * scale)}px Arial`;
    const textWidth = ctx.measureText(`⏱ ${idleText}`).width;
    const bgWidth = textWidth + padding * 2;
    const bgHeight = height - 12 * scale;
    const bgX = (width - bgWidth) / 2;
    const bgY = 6 * scale;

    ctx.fillStyle = 'rgba(0, 0, 0, 0.9)';
    ctx.beginPath();
    ctx.roundRect(bgX, bgY, bgWidth, bgHeight, 10 * scale);
    ctx.fill();

    ctx.strokeStyle = colors.border;
    ctx.lineWidth = 3 * scale;
    ctx.stroke();

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 4 * scale;
    ctx.strokeText(`⏱ ${idleText}`, width / 2, height / 2);

    ctx.fillStyle = colors.text;
    ctx.fillText(`⏱ ${idleText}`, width / 2, height / 2);
  }

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

    const existingCanvas = material.map.image as HTMLCanvasElement;
    if (!existingCanvas || !(existingCanvas instanceof HTMLCanvasElement)) return;

    const ctx = existingCanvas.getContext('2d');
    if (!ctx) return;

    this.drawIdleTimer(ctx, existingCanvas.width, existingCanvas.height, status, lastActivity);
    material.map.needsUpdate = true;
  }

  /**
   * Update the mana bar for an agent.
   */
  updateManaBar(group: THREE.Group, remainingPercent: number, status: string): void {
    const manaBar = group.getObjectByName('manaBar') as THREE.Sprite;
    if (!manaBar) return;

    const material = manaBar.material as THREE.SpriteMaterial;
    if (!material.map) return;

    const existingCanvas = material.map.image as HTMLCanvasElement;
    if (!existingCanvas || !(existingCanvas instanceof HTMLCanvasElement)) return;

    const ctx = existingCanvas.getContext('2d');
    if (!ctx) return;

    this.drawManaBar(ctx, existingCanvas.width, existingCanvas.height, remainingPercent, status);
    material.map.needsUpdate = true;
  }

  /**
   * Update the name label for an agent (legacy separate sprite).
   */
  updateNameLabel(group: THREE.Group, name: string, agentClass: string, provider?: string): void {
    const oldLabel = group.getObjectByName('nameLabel') as THREE.Sprite;
    if (oldLabel) {
      oldLabel.material.map?.dispose();
      oldLabel.material.dispose();
      group.remove(oldLabel);
    }

    const classConfig = AGENT_CLASS_CONFIG[agentClass as BuiltInAgentClass];
    const color = classConfig?.color ?? 0xffffff;
    const isBoss = agentClass === 'boss' || group.userData.isBoss;
    const newLabel = this.createNameLabelSprite(name, color, isBoss, provider);
    group.add(newLabel);
  }

  /**
   * Update visual state of an agent mesh.
   */
  updateVisuals(
    group: THREE.Group,
    agent: Agent,
    isSelected: boolean,
    isSubordinateOfSelectedBoss: boolean,
    classColor: number
  ): void {
    const isBoss = agent.isBoss === true || agent.class === 'boss';
    const remainingPercent = Math.round(getContextRemainingPercent(agent));

    // Dirty-check: skip expensive canvas redraws if nothing changed
    const ud = group.userData;
    const statusDirty = ud._cachedStatus !== agent.status
      || ud._cachedPercent !== remainingPercent
      || ud._cachedIsBoss !== isBoss
      || (agent.status === 'idle' && ud._cachedIdleBucket !== Math.floor((Date.now() - agent.lastActivity) / 60000));

    if (statusDirty) {
      ud._cachedStatus = agent.status;
      ud._cachedPercent = remainingPercent;
      ud._cachedIsBoss = isBoss;
      ud._cachedIdleBucket = agent.status === 'idle' ? Math.floor((Date.now() - agent.lastActivity) / 60000) : 0;

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
                classColor,
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
      const statusBarExists = !!group.getObjectByName('statusBar');
      const combinedUIExists = !!group.getObjectByName('combinedUI');
      if (!statusBarExists && !combinedUIExists) {
        this.updateManaBar(group, remainingPercent, agent.status);
        this.updateIdleTimer(group, agent.status, agent.lastActivity);
      }
    }

    // Name label: redraw if name or taskLabel changed
    const taskLabel = agent.taskLabel;
    const nameLabelSprite = group.getObjectByName('nameLabelSprite') as THREE.Sprite;
    const expectedBaseScale = this.getNameLabelBaseScale(isBoss, !!taskLabel);
    const nameLabelLayoutDirty = !!nameLabelSprite && (
      nameLabelSprite.userData.nameLabelLayoutVersion !== NAME_LABEL_LAYOUT_VERSION
      || nameLabelSprite.userData.baseIndicatorScale !== expectedBaseScale
      || nameLabelSprite.userData.providerBadgeVersion !== this.providerBadgeVersion
    );

    if (ud.agentName !== agent.name || ud._cachedTaskLabel !== taskLabel || nameLabelLayoutDirty) {
      if (nameLabelSprite) {
        // If taskLabel presence changed, we need to resize the canvas
        const hadTaskLabel = !!ud._cachedTaskLabel;
        const hasTaskLabel = !!taskLabel;
        if (hadTaskLabel !== hasTaskLabel || nameLabelLayoutDirty) {
          // Recreate sprite with new canvas size
          const material = nameLabelSprite.material as THREE.SpriteMaterial;
          material.map?.dispose();
          material.dispose();
          group.remove(nameLabelSprite);

          const isBoss = agent.isBoss === true || agent.class === 'boss';
          const newSprite = this.createNameLabelSprite(agent.name, classColor, isBoss, agent.provider, taskLabel);
          group.add(newSprite);
        } else {
          // Same canvas size, just redraw
          const material = nameLabelSprite.material as THREE.SpriteMaterial;
          if (material.map) {
            const canvas = material.map.image as HTMLCanvasElement;
            if (canvas instanceof HTMLCanvasElement) {
              const ctx = canvas.getContext('2d');
              if (ctx) {
                this.drawNameLabel(ctx, canvas.width, canvas.height, agent.name, classColor, isBoss, agent.provider, taskLabel);
                material.map.needsUpdate = true;
              }
            }
          }
        }
        ud.agentName = agent.name;
        ud._cachedTaskLabel = taskLabel;
      }

      // Legacy fallback name update
      const statusBarExists = !!group.getObjectByName('statusBar');
      const combinedUIExists = !!group.getObjectByName('combinedUI');
      if (!statusBarExists && !combinedUIExists) {
        this.updateNameLabel(group, agent.name, agent.class, agent.provider);
        ud.agentName = agent.name;
        ud._cachedTaskLabel = taskLabel;
      }
    }

    // Update selection ring visibility and color
    const selectionRing = group.getObjectByName('selectionRing') as THREE.Mesh;
    if (selectionRing) {
      const material = selectionRing.material as THREE.MeshBasicMaterial;
      if (isSelected) {
        const builtInConfig = AGENT_CLASS_CONFIG[agent.class as BuiltInAgentClass];
        material.color.setHex(builtInConfig?.color ?? classColor);
        material.opacity = (agent.isBoss === true || agent.class === 'boss') ? 0.34 : 0.28;
      } else if (isSubordinateOfSelectedBoss) {
        material.color.setHex(0xffd700);
        material.opacity = 0.2;
      } else {
        material.opacity = 0;
      }
    }
  }
}

// HMR
if (import.meta.hot) {
  import.meta.hot.accept(() => {
    console.log('[Tide HMR] VisualConfig updated - pending refresh available');
    window.__tideHmrPendingSceneChanges = true;
  });
}
