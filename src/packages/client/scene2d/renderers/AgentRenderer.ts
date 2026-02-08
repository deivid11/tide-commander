import type { Agent2DData } from '../Scene2D';
import type { Scene2DCamera } from '../Scene2DCamera';
import type { EffectRenderer } from './EffectRenderer';
import { AGENT_CLASS_CONFIG } from '../../scene/config';
import type { BuiltInAgentClass } from '../../../shared/types';
import { store } from '../../store';
import { TOOL_ICONS } from '../../utils/outputRendering';
import { BaseRenderer } from './BaseRenderer';

const STATUS_COLORS: Record<string, { color: string; glow: string; darkColor: string }> = {
  idle: { color: '#4aff9e', glow: 'rgba(74, 255, 158, 0.6)', darkColor: '#2a9a5e' },
  working: { color: '#4a9eff', glow: 'rgba(74, 158, 255, 0.6)', darkColor: '#2a5e9a' },
  waiting: { color: '#ffcc00', glow: 'rgba(255, 204, 0, 0.6)', darkColor: '#9a7a00' },
  waiting_permission: { color: '#ffcc00', glow: 'rgba(255, 204, 0, 0.6)', darkColor: '#9a7a00' },
  error: { color: '#ff4a4a', glow: 'rgba(255, 74, 74, 0.6)', darkColor: '#9a2a2a' },
  orphaned: { color: '#ff00ff', glow: 'rgba(255, 0, 255, 0.6)', darkColor: '#9a009a' },
};

export class AgentRenderer extends BaseRenderer {
  private effect: EffectRenderer;

  constructor(ctx: CanvasRenderingContext2D, camera: Scene2DCamera, effect: EffectRenderer) {
    super(ctx, camera);
    this.effect = effect;
  }

  private getAgentClassIcon(agentClass: string): string {
    const builtIn = AGENT_CLASS_CONFIG[agentClass as BuiltInAgentClass];
    if (builtIn) {
      return builtIn.icon;
    }

    const state = store.getState();
    const custom = state.customAgentClasses.get(agentClass);
    if (custom) {
      return custom.icon;
    }

    return '🤖';
  }

  drawAgent(agent: Agent2DData, isSelected: boolean, isMoving: boolean, indicatorScale: number): void {
    const { x, z } = agent.position;
    const baseRadius = agent.isBoss ? 0.7 : 0.5;
    const radius = baseRadius;

    const zoom = this.camera.getZoom();
    const zoomScaleFactor = Math.min(1, zoom / 30);

    const walkSpeed = 8;
    const walkPhase = this.animationTime * walkSpeed;
    const pulsePhase = this.animationTime * 3;
    const glowPhase = this.animationTime * 2;

    const isWorking = agent.status === 'working';
    const workBounceSpeed = 6;
    const workBouncePhase = this.animationTime * workBounceSpeed;
    const iconBounceOffset = isWorking ? Math.abs(Math.sin(workBouncePhase)) * 8 * zoomScaleFactor : 0;

    const bobAmount = isMoving ? Math.sin(walkPhase * 2) * 0.05 : 0;
    const squashAmount = isMoving ? 1 + Math.sin(walkPhase * 2) * 0.08 : 1;
    const footOffset = isMoving ? Math.sin(walkPhase) * 0.15 : 0;

    const statusConfig = STATUS_COLORS[agent.status] || STATUS_COLORS.idle;
    const bodyColor = this.numberToHex(agent.color);
    const bodyColorDark = this.darkenColor(bodyColor, 0.4);
    const bodyColorLight = this.lightenColor(bodyColor, 0.3);

    const classEmoji = this.getAgentClassIcon(agent.class);

    const screenPos = this.camera.worldToScreen(x, z + bobAmount);
    const screenRadius = radius * this.camera.getZoom();

    // ========== DROP SHADOW ==========
    this.ctx.save();
    this.ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
    this.ctx.shadowBlur = 8;
    this.ctx.shadowOffsetX = 3;
    this.ctx.shadowOffsetY = 3;

    // ========== STATUS RING ==========
    const statusPulse = 0.7 + Math.sin(pulsePhase) * 0.3;
    const statusRingRadius = screenRadius + 6;

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

    this.ctx.beginPath();
    this.ctx.arc(screenPos.x, screenPos.y, statusRingRadius, 0, Math.PI * 2);
    this.ctx.strokeStyle = this.hexToRgba(statusConfig.color, statusPulse * 0.8);
    this.ctx.lineWidth = 2;
    this.ctx.stroke();

    // ========== WATER WAVE RIPPLE EFFECT ==========
    if (isWorking) {
      const waveCount = 3;
      const waveCycleDuration = 2;
      const maxWaveRadius = screenRadius * 3;
      const waveThickness = 3;

      for (let i = 0; i < waveCount; i++) {
        const wavePhase = ((this.animationTime / waveCycleDuration) + (i / waveCount)) % 1;
        const waveRadius = screenRadius + (wavePhase * (maxWaveRadius - screenRadius));
        const waveOpacity = Math.max(0, 1 - wavePhase) * 0.8;

        if (waveOpacity < 0.05) continue;

        const waveGradient = this.ctx.createRadialGradient(
          screenPos.x, screenPos.y, waveRadius - waveThickness,
          screenPos.x, screenPos.y, waveRadius + waveThickness
        );
        waveGradient.addColorStop(0, 'transparent');
        waveGradient.addColorStop(0.3, this.hexToRgba('#4a9eff', waveOpacity * 0.5));
        waveGradient.addColorStop(0.5, this.hexToRgba('#bd93f9', waveOpacity));
        waveGradient.addColorStop(0.7, this.hexToRgba('#ff79c6', waveOpacity * 0.5));
        waveGradient.addColorStop(1, 'transparent');

        this.ctx.beginPath();
        this.ctx.arc(screenPos.x, screenPos.y, waveRadius, 0, Math.PI * 2);
        this.ctx.strokeStyle = waveGradient;
        this.ctx.lineWidth = waveThickness * 2;
        this.ctx.stroke();

        this.ctx.beginPath();
        this.ctx.arc(screenPos.x, screenPos.y, waveRadius, 0, Math.PI * 2);
        this.ctx.strokeStyle = this.hexToRgba('#bd93f9', waveOpacity * 0.6);
        this.ctx.lineWidth = 1.5;
        this.ctx.stroke();
      }
    }

    // ========== SELECTION GLOW ==========
    if (isSelected) {
      const glowPulse = 0.5 + Math.sin(glowPhase) * 0.5;
      const selectionRadius = screenRadius + 12 + Math.sin(glowPhase * 2) * 2;

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

      this.ctx.beginPath();
      this.ctx.arc(screenPos.x, screenPos.y, selectionRadius, 0, Math.PI * 2);
      this.ctx.strokeStyle = bodyColor;
      this.ctx.lineWidth = 3;
      this.ctx.setLineDash([8, 4]);
      this.ctx.lineDashOffset = -this.animationTime * 20;
      this.ctx.stroke();
      this.ctx.setLineDash([]);
    }

    // ========== FEET ==========
    if (isMoving) {
      const footRadius = screenRadius * 0.25;
      const footY = screenPos.y + screenRadius * 0.7;

      this.ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
      this.ctx.beginPath();
      this.ctx.ellipse(screenPos.x, footY + 4, screenRadius * 0.6, screenRadius * 0.15, 0, 0, Math.PI * 2);
      this.ctx.fill();

      this.ctx.fillStyle = bodyColorDark;
      this.ctx.beginPath();
      this.ctx.arc(screenPos.x - screenRadius * 0.3 + footOffset * this.camera.getZoom(), footY, footRadius, 0, Math.PI * 2);
      this.ctx.fill();

      this.ctx.beginPath();
      this.ctx.arc(screenPos.x + screenRadius * 0.3 - footOffset * this.camera.getZoom(), footY, footRadius, 0, Math.PI * 2);
      this.ctx.fill();
    }

    // ========== AGENT BODY ==========
    const bodyRadiusX = isMoving ? screenRadius / squashAmount : screenRadius;
    const bodyRadiusY = isMoving ? screenRadius * squashAmount : screenRadius;

    const bodyGradient = this.ctx.createRadialGradient(
      screenPos.x - screenRadius * 0.3, screenPos.y - screenRadius * 0.3, 0,
      screenPos.x, screenPos.y, screenRadius
    );
    bodyGradient.addColorStop(0, '#3a3a3a');
    bodyGradient.addColorStop(0.5, '#1a1a1a');
    bodyGradient.addColorStop(1, '#0a0a0a');

    this.ctx.beginPath();
    if (isMoving) {
      this.ctx.ellipse(screenPos.x, screenPos.y, bodyRadiusX, bodyRadiusY, 0, 0, Math.PI * 2);
    } else {
      this.ctx.arc(screenPos.x, screenPos.y, screenRadius, 0, Math.PI * 2);
    }
    this.ctx.fillStyle = bodyGradient;
    this.ctx.fill();

    this.ctx.strokeStyle = this.hexToRgba(bodyColor, 0.6);
    this.ctx.lineWidth = 2;
    this.ctx.stroke();

    this.ctx.beginPath();
    this.ctx.arc(screenPos.x - screenRadius * 0.25, screenPos.y - screenRadius * 0.25, screenRadius * 0.3, 0, Math.PI * 2);
    this.ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
    this.ctx.fill();

    this.ctx.restore();

    // ========== CLASS EMOJI ==========
    const emojiFontSize = Math.max(12 * zoomScaleFactor, screenRadius * 1.1);
    this.ctx.font = `${emojiFontSize}px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif`;
    this.ctx.textAlign = 'center';
    this.ctx.textBaseline = 'middle';
    this.ctx.fillText(classEmoji, screenPos.x, screenPos.y + 1 - iconBounceOffset);

    // ========== BOSS CROWN ==========
    if (agent.isBoss) {
      const crownSize = Math.max(10 * zoomScaleFactor, screenRadius * 0.6);
      this.ctx.font = `${crownSize}px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", serif`;
      this.ctx.textAlign = 'center';
      this.ctx.textBaseline = 'bottom';

      this.ctx.save();
      this.ctx.shadowColor = 'rgba(255, 215, 0, 0.8)';
      this.ctx.shadowBlur = 6;
      this.ctx.fillText('👑', screenPos.x, screenPos.y - screenRadius - 2);
      this.ctx.restore();
    }

    // ========== DUST PARTICLES ==========
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

    // ========== NAME TAG ==========
    const labelScale = indicatorScale * zoomScaleFactor;
    const labelY = screenPos.y + screenRadius + 12 * zoomScaleFactor;
    const labelFontSize = Math.max(5, 9 * labelScale);

    this.ctx.font = `bold ${labelFontSize}px "Segoe UI", Arial, sans-serif`;
    const nameWidth = this.ctx.measureText(agent.name).width;
    const namePadding = 6 * zoomScaleFactor;
    const nameHeight = labelFontSize + 4 * zoomScaleFactor;

    const nameTagGradient = this.ctx.createLinearGradient(
      screenPos.x - nameWidth / 2 - namePadding, labelY - nameHeight / 2,
      screenPos.x - nameWidth / 2 - namePadding, labelY + nameHeight / 2
    );
    nameTagGradient.addColorStop(0, 'rgba(30, 30, 40, 0.95)');
    nameTagGradient.addColorStop(1, 'rgba(20, 20, 30, 0.95)');

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

    this.ctx.strokeStyle = this.hexToRgba(bodyColor, 0.6);
    this.ctx.lineWidth = 1.5;
    this.ctx.stroke();

    this.ctx.fillStyle = bodyColor;
    this.ctx.textAlign = 'center';
    this.ctx.textBaseline = 'middle';
    this.ctx.fillText(agent.name, screenPos.x, labelY);

    // ========== CONTEXT/MANA BAR ==========
    let contextPercent: number;
    if (agent.contextStats) {
      contextPercent = 100 - agent.contextStats.usedPercent;
    } else {
      const used = agent.contextUsed || 0;
      const limit = agent.contextLimit || 200000;
      const remaining = Math.max(0, limit - used);
      contextPercent = (remaining / limit) * 100;
    }
    const manaPercent = Math.max(0, Math.min(100, contextPercent)) / 100;

    const barY = labelY + nameHeight / 2 + 8 * zoomScaleFactor;
    const barWidth = 100 * zoomScaleFactor;
    const barHeight = 14 * zoomScaleFactor;

    this.ctx.beginPath();
    this.roundedRectScreen(screenPos.x - barWidth / 2, barY, barWidth, barHeight, 4);
    this.ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
    this.ctx.fill();

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

    this.ctx.beginPath();
    this.roundedRectScreen(screenPos.x - barWidth / 2, barY, barWidth, barHeight, 4);
    this.ctx.strokeStyle = 'rgba(100, 150, 150, 0.6)';
    this.ctx.lineWidth = 1.5;
    this.ctx.stroke();

    const percentText = `${Math.round(contextPercent)}%`;
    const percentFontSize = Math.max(6, 10 * zoomScaleFactor);
    this.ctx.font = `bold ${percentFontSize}px "Segoe UI", Arial, sans-serif`;
    this.ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
    this.ctx.textAlign = 'center';
    this.ctx.textBaseline = 'middle';
    this.ctx.fillText(percentText, screenPos.x, barY + barHeight / 2);

    // ========== IDLE TIMER BADGE ==========
    if (agent.status === 'idle' && agent.lastActivity > 0) {
      const idleSeconds = Math.floor((Date.now() - agent.lastActivity) / 1000);
      if (idleSeconds >= 5) {
        const idleText = this.formatIdleTime(idleSeconds);
        const timerY = barY + barHeight + 10 * zoomScaleFactor;

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

        const timerFontSize = Math.max(6, 9 * labelScale);
        this.ctx.font = `bold ${timerFontSize}px "Segoe UI Emoji", "Apple Color Emoji", Arial`;
        const timerContent = `${timerIcon} ${idleText}`;
        const timerWidth = this.ctx.measureText(timerContent).width;
        const timerPadding = 5 * zoomScaleFactor;
        const timerHeight = timerFontSize + 3 * zoomScaleFactor;

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

        this.ctx.fillStyle = timerTextColor;
        this.ctx.textAlign = 'center';
        this.ctx.textBaseline = 'middle';
        this.ctx.fillText(timerContent, screenPos.x, timerY);
      }
    }

    // ========== CURRENT TOOL BADGE ==========
    this.effect.updateAgentTool(agent.id, agent.currentTool);
    const toolAnim = this.effect.getToolAnimation(agent.id);

    if (toolAnim && toolAnim.opacity > 0.01) {
      const toolIcon = TOOL_ICONS[toolAnim.tool] || TOOL_ICONS.default;
      const toolY = barY + barHeight + 10 * zoomScaleFactor;
      const opacity = toolAnim.opacity;

      const scaleProgress = toolAnim.fadeIn
        ? this.easeOutCubic(opacity)
        : opacity;
      const scale = 0.8 + 0.2 * scaleProgress;

      const toolFontSize = Math.max(6, 10 * labelScale) * scale;
      this.ctx.font = `bold ${toolFontSize}px "Segoe UI Emoji", "Apple Color Emoji", Arial`;
      const toolContent = `${toolIcon} ${toolAnim.tool}`;
      const toolTextWidth = this.ctx.measureText(toolContent).width;
      const toolPadding = 6 * zoomScaleFactor * scale;
      const toolBadgeHeight = toolFontSize + 4 * zoomScaleFactor * scale;

      const slideOffset = (1 - scaleProgress) * 4 * zoomScaleFactor;
      const animatedToolY = toolY + slideOffset;

      this.ctx.beginPath();
      this.roundedRectScreen(
        screenPos.x - toolTextWidth / 2 - toolPadding,
        animatedToolY - toolBadgeHeight / 2,
        toolTextWidth + toolPadding * 2,
        toolBadgeHeight,
        toolBadgeHeight / 2
      );
      this.ctx.fillStyle = `rgba(74, 118, 158, ${0.9 * opacity})`;
      this.ctx.fill();

      this.ctx.strokeStyle = `rgba(74, 158, 255, ${0.6 * opacity})`;
      this.ctx.lineWidth = 1;
      this.ctx.stroke();

      this.ctx.fillStyle = `rgba(170, 221, 255, ${opacity})`;
      this.ctx.textAlign = 'center';
      this.ctx.textBaseline = 'middle';
      this.ctx.fillText(toolContent, screenPos.x, animatedToolY);
    }
  }

  drawSelectionBox(start: { x: number; z: number }, end: { x: number; z: number }): void {
    const zoom = this.camera.getZoom();
    const minX = Math.min(start.x, end.x);
    const maxX = Math.max(start.x, end.x);
    const minZ = Math.min(start.z, end.z);
    const maxZ = Math.max(start.z, end.z);

    const width = maxX - minX;
    const height = maxZ - minZ;

    if (width < 0.1 && height < 0.1) return;

    this.camera.applyTransform(this.ctx);

    const ctx = this.ctx;
    const accentColor = '#4a9eff';

    const dashOffset = (this.animationTime * 30) % 24;
    const dashLength = 6 / zoom;
    const gapLength = 3 / zoom;

    ctx.save();
    ctx.shadowColor = 'rgba(74, 158, 255, 0.5)';
    ctx.shadowBlur = 10;
    ctx.fillStyle = 'transparent';
    ctx.beginPath();
    ctx.rect(minX, minZ, width, height);
    ctx.fill();
    ctx.restore();

    const gradient = ctx.createLinearGradient(minX, minZ, maxX, maxZ);
    gradient.addColorStop(0, 'rgba(74, 158, 255, 0.15)');
    gradient.addColorStop(0.4, 'rgba(74, 158, 255, 0.08)');
    gradient.addColorStop(0.6, 'rgba(74, 158, 255, 0.12)');
    gradient.addColorStop(1, 'rgba(100, 180, 255, 0.18)');

    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.rect(minX, minZ, width, height);
    ctx.fill();

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

    ctx.strokeStyle = 'rgba(74, 158, 255, 0.9)';
    ctx.lineWidth = 2 / zoom;
    ctx.setLineDash([dashLength, gapLength]);
    ctx.lineDashOffset = -dashOffset / zoom;

    ctx.beginPath();
    ctx.rect(minX, minZ, width, height);
    ctx.stroke();

    ctx.setLineDash([]);

    ctx.strokeStyle = 'rgba(74, 158, 255, 0.3)';
    ctx.lineWidth = 1 / zoom;
    ctx.beginPath();
    ctx.rect(minX - 1 / zoom, minZ - 1 / zoom, width + 2 / zoom, height + 2 / zoom);
    ctx.stroke();

    const cornerSize = Math.min(width, height) * 0.15;
    const minCornerSize = 0.3;
    const actualCornerSize = Math.max(cornerSize, minCornerSize);

    ctx.strokeStyle = accentColor;
    ctx.lineWidth = 3 / zoom;
    ctx.lineCap = 'round';

    this.drawSelectionCorner(minX, minZ, actualCornerSize, 'top-left');
    this.drawSelectionCorner(maxX, minZ, actualCornerSize, 'top-right');
    this.drawSelectionCorner(minX, maxZ, actualCornerSize, 'bottom-left');
    this.drawSelectionCorner(maxX, maxZ, actualCornerSize, 'bottom-right');

    const dotRadius = 3 / zoom;
    ctx.fillStyle = accentColor;

    const pulseAlpha = 0.6 + Math.sin(this.animationTime * 4) * 0.3;
    ctx.save();
    ctx.shadowColor = `rgba(74, 158, 255, ${pulseAlpha})`;
    ctx.shadowBlur = 6;

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
}
